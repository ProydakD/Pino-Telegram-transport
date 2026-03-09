import { TelegramQueueOverflowStrategy } from './types';

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
interface TaskQueueOptions {
  maxSize?: number;
  overflowStrategy?: TelegramQueueOverflowStrategy;
}

interface TaskHandle {
  ready: Promise<void>;
  done: Promise<void>;
}

interface TaskQueueEntry {
  task: () => Promise<void>;
  resolveReady: () => void;
  resolveDone: () => void;
  rejectDone: (error: unknown) => void;
}

class TaskQueueOverflowError extends Error {
  readonly code = 'QUEUE_OVERFLOW';

  constructor(
    readonly maxSize: number,
    readonly overflowStrategy: TelegramQueueOverflowStrategy,
  ) {
    super(
      `Очередь транспорта переполнена (maxQueueSize=${maxSize}, overflowStrategy=${overflowStrategy}). Сообщение отброшено.`,
    );
    this.name = 'TaskQueueOverflowError';
  }
}

export class TaskQueue {
  private readonly maxSize: number;
  private readonly overflowStrategy: TelegramQueueOverflowStrategy;
  private readonly entries: TaskQueueEntry[] = [];
  private readonly idleResolvers: Array<() => void> = [];
  private readonly spaceResolvers: Array<() => void> = [];
  private isRunning = false;

  constructor(options: TaskQueueOptions = {}) {
    this.maxSize = options.maxSize ?? Number.POSITIVE_INFINITY;
    this.overflowStrategy = options.overflowStrategy ?? 'block';
  }

  /**
   * Добавляет задачу в очередь.
   *
   * @param task Асинхронная функция, которую нужно исполнить последовательно.
   * @returns Набор промисов для ожидания постановки в очередь и финального завершения задачи.
   */
  push(task: () => Promise<void>): TaskHandle {
    let resolveReady = () => {};
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });

    let resolveDone = () => {};
    let rejectDone = () => {};
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const entry: TaskQueueEntry = {
      task,
      resolveReady,
      resolveDone,
      rejectDone,
    };

    void this.enqueue(entry);

    return { ready, done };
  }

  /**
   * Возвращает промис, резолвящийся, когда очередь станет пустой.
   *
   * @returns Промис, сигнализирующий завершение всех поставленных задач.
   */
  onIdle(): Promise<void> {
    if (!this.isRunning && this.entries.length === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private async enqueue(entry: TaskQueueEntry): Promise<void> {
    if (this.overflowStrategy === 'block') {
      await this.waitForSpace();
      this.entries.push(entry);
      entry.resolveReady();
      this.start();
      return;
    }

    if (this.isFull()) {
      if (this.overflowStrategy === 'dropNewest') {
        entry.resolveReady();
        queueMicrotask(() => {
          entry.rejectDone(new TaskQueueOverflowError(this.maxSize, this.overflowStrategy));
        });
        return;
      }

      const droppedEntry = this.entries.shift();
      droppedEntry?.rejectDone(new TaskQueueOverflowError(this.maxSize, this.overflowStrategy));
    }

    this.entries.push(entry);
    entry.resolveReady();
    this.start();
  }

  private start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    void this.processEntries();
  }

  private async processEntries(): Promise<void> {
    while (this.entries.length > 0) {
      const entry = this.entries.shift();
      if (!entry) {
        continue;
      }

      this.notifySpaceResolvers();

      try {
        await entry.task();
        entry.resolveDone();
      } catch (error) {
        entry.rejectDone(error);
      }
    }

    this.isRunning = false;
    this.resolveIdle();

    if (this.entries.length > 0) {
      this.start();
    }
  }

  private isFull(): boolean {
    return Number.isFinite(this.maxSize) && this.entries.length >= this.maxSize;
  }

  private async waitForSpace(): Promise<void> {
    while (this.isFull()) {
      await new Promise<void>((resolve) => {
        this.spaceResolvers.push(resolve);
      });
    }
  }

  private notifySpaceResolvers(): void {
    while (this.spaceResolvers.length > 0 && !this.isFull()) {
      const resolve = this.spaceResolvers.shift();
      resolve?.();
    }
  }

  private resolveIdle(): void {
    if (this.isRunning || this.entries.length > 0) {
      return;
    }

    while (this.idleResolvers.length > 0) {
      const resolve = this.idleResolvers.shift();
      resolve?.();
    }
  }
}
