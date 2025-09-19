/**
 * Простой ограничитель частоты, который контролирует минимальный интервал между вызовами по ключу.
 *
 * @remarks Используется транспортом для предотвращения rate limit от Telegram.
 */
export class RateLimiter {
  private lastExecution = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Ждёт необходимую паузу перед выполнением следующей задачи для указанного ключа.
   *
   * @param key Идентификатор последовательности (обычно chatId).
   * @param minDelay Минимальный интервал между вызовами в миллисекундах.
   */
  async wait(key: string, minDelay: number): Promise<void> {
    const current = this.now();
    const last = this.lastExecution.get(key) ?? 0;
    const elapsed = current - last;
    if (elapsed < minDelay) {
      await new Promise((resolve) => setTimeout(resolve, minDelay - elapsed));
    }
    this.lastExecution.set(key, this.now());
  }
}

/**
 * Последовательная очередь промисов, позволяющая ядру транспорта сохранять порядок сообщений.
 */
export class TaskQueue {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Добавляет задачу в очередь и возвращает промис её выполнения.
   *
   * @param task Асинхронная функция, которую нужно исполнить последовательно.
   */
  push(task: () => Promise<void>): Promise<void> {
    const run = this.tail.then(() => task());
    this.tail = run.catch(() => {
      // Сбрасываем ошибку, чтобы последующие задачи выполнялись корректно.
    });
    return run;
  }

  /**
   * Возвращает промис, резолвящийся, когда очередь станет пустой.
   *
   * @returns Промис, сигнализирующий завершение всех поставленных задач.
   */
  onIdle(): Promise<void> {
    return this.tail.catch(() => {
      // Игнорируем ошибку последней задачи, очередь уже пуста.
    });
  }
}
