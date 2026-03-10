import { PinoLog, TelegramChatTarget, TelegramMessagePayload, TelegramRequest } from './types';

interface TextMessageDeduperOptions {
  windowMs?: number;
  now?: () => number;
}

/**
 * Подавляет повторную доставку одинаковых текстовых событий в пределах заданного окна.
 * Ключ строится по target, стабильному представлению лога без top-level `time`
 * и метаданным `sendMessage`-запросов без поля `text`.
 */
export class TextMessageDeduper {
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly deliveredAtByKey = new Map<string, number>();

  constructor(options: TextMessageDeduperOptions = {}) {
    this.windowMs = options.windowMs ?? 0;
    this.now = options.now ?? (() => Date.now());
  }

  shouldSuppress(key: string | undefined): boolean {
    if (!key || this.windowMs <= 0) {
      return false;
    }

    const currentTime = this.now();
    this.pruneExpiredEntries(currentTime);

    const deliveredAt = this.deliveredAtByKey.get(key);
    if (deliveredAt === undefined) {
      return false;
    }

    return currentTime - deliveredAt < this.windowMs;
  }

  remember(key: string | undefined): void {
    if (!key || this.windowMs <= 0) {
      return;
    }

    const currentTime = this.now();
    this.pruneExpiredEntries(currentTime);
    this.deliveredAtByKey.set(key, currentTime);
  }

  private pruneExpiredEntries(currentTime: number): void {
    for (const [key, deliveredAt] of this.deliveredAtByKey.entries()) {
      if (currentTime - deliveredAt >= this.windowMs) {
        this.deliveredAtByKey.delete(key);
      }
    }
  }
}

export function createTextMessageDedupKey(
  log: PinoLog,
  target: TelegramChatTarget,
  requests: TelegramRequest[],
): string | undefined {
  const textRequests = requests.filter(
    (request): request is Extract<TelegramRequest, { method: 'sendMessage' }> =>
      request.method === 'sendMessage',
  );

  if (textRequests.length === 0 || textRequests.length !== requests.length) {
    return undefined;
  }

  return JSON.stringify({
    target: {
      chatId: target.chatId,
      threadId: target.threadId,
    },
    log: createStableDedupValue(removeTopLevelTime(log)),
    requestMetadata: textRequests.map((request) => ({
      method: request.method,
      payload: removeMessageText(request.payload),
    })),
  });
}

function removeTopLevelTime(log: PinoLog): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(log).filter((entry): entry is [string, unknown] => entry[0] !== 'time'),
  );
}

function removeMessageText(payload: TelegramMessagePayload): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter((entry): entry is [string, unknown] => entry[0] !== 'text'),
  );
}

function createStableDedupValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return {
      type: 'Buffer',
      data: Array.from(value.values()),
    };
  }

  if (value instanceof Uint8Array) {
    return {
      type: 'Uint8Array',
      data: Array.from(value.values()),
    };
  }

  if (value instanceof ArrayBuffer) {
    return {
      type: 'ArrayBuffer',
      data: Array.from(new Uint8Array(value).values()),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => createStableDedupValue(item));
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => [key, createStableDedupValue(nestedValue)] as const);

    return Object.fromEntries(entries);
  }

  return value;
}
