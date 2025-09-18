/**
 * Простой ограничитель частоты, используемый для последовательной отправки сообщений.
 */
export class RateLimiter {
  private lastExecution = new Map<string, number>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Ждет необходимую паузу перед следующим вызовом по ключу.
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
 * Очередь промисов, гарантирующая последовательное выполнение задач.
 */
export class TaskQueue {
  private tail: Promise<void> = Promise.resolve();

  /**
   * Добавляет задачу в очередь и возвращает промис её выполнения.
   */
  push(task: () => Promise<void>): Promise<void> {
    const run = this.tail.then(() => task());
    this.tail = run.catch(() => {
      // Сбрасываем ошибку, чтобы последующие задачи выполнялись корректно.
    });
    return run;
  }

  /**
   * Возвращает промис, который резолвится, когда очередь опустеет.
   */
  onIdle(): Promise<void> {
    return this.tail.catch(() => {
      // Игнорируем ошибку последней задачи, очередь уже пуста.
    });
  }
}
