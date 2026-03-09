import { StringDecoder } from 'node:string_decoder';
import { Writable } from 'node:stream';
import { buildMessage } from './formatter';
import { RateLimiter, TaskQueue } from './rate-limiter';
import { normalizeOptions } from './utils';
import {
  FormatMessageInput,
  FormatMessageResult,
  PinoLog,
  TelegramBasePayload,
  TelegramChatTarget,
  TelegramDocumentPayload,
  TelegramMessagePayload,
  TelegramMethod,
  TelegramPhotoPayload,
  TelegramRequest,
  TelegramSendPayload,
  TelegramInputFile,
  TelegramQueueOverflowStrategy,
  TelegramTransportOptions,
} from './types';
import { TelegramClient, TelegramDeliveryError } from './telegram-client';

export type {
  TelegramTransportOptions,
  FormatMessageInput,
  FormatMessageResult,
  TelegramMessagePayload,
  TelegramRequest,
  TelegramSendPayload,
  TelegramPhotoPayload,
  TelegramDocumentPayload,
  TelegramInputFile,
  TelegramBasePayload,
  TelegramMethod,
  TelegramQueueOverflowStrategy,
};
export { TelegramDeliveryError } from './telegram-client';
export { createMediaFormatter } from './presets';
export {
  createNestLoggerOptions,
  createFastifyLoggerOptions,
  createLambdaLoggerOptions,
} from './adapters';
export type { NestLoggerOptions, NestLoggerOverrides, FastifyLoggerOptions } from './adapters';

interface FlushCallback {
  (error?: Error): void;
}

interface FlushableTransportStream extends Writable {
  flush: (callback?: FlushCallback) => void;
}

const TRANSPORT_HIGH_WATER_MARK = 1;

/**
 * Создаёт потоковый транспорт для Pino и настраивает внутренние зависимости.
 * Транспорт нормализует конфигурацию, инициализирует очередь и ограничитель частоты
 * и пересылает каждое сообщение во все целевые чаты Telegram.
 *
 * @param options Пользовательские настройки транспорта для Telegram Bot API.
 * @returns Поток транспорта pino; при критических ошибках конфигурации возвращается поток-заглушка.
 */
export default function telegramTransport(options: TelegramTransportOptions) {
  let normalized: ReturnType<typeof normalizeOptions>;

  try {
    normalized = normalizeOptions(options);
  } catch (error) {
    const code = (error as { code?: string } | undefined)?.code;
    if (
      error instanceof Error &&
      (code === 'MISSING_BOT_TOKEN' ||
        code === 'NO_CHAT_TARGET' ||
        error.message.includes('botToken') ||
        error.message.includes('целевого чата') ||
        error.message.includes('Не найдено'))
    ) {
      console.warn(`[pino-telegram] transport disabled: ${error.message}`);
      return createNoopStream();
    }
    throw error;
  }

  const client = new TelegramClient(normalized);
  const rateLimiter = new RateLimiter();
  const queue = new TaskQueue({
    maxSize: normalized.maxQueueSize,
    overflowStrategy: normalized.overflowStrategy,
  });

  const decoder = new StringDecoder('utf8');
  let pendingText = '';
  let activeWrites = 0;

  const stream = new Writable({
    highWaterMark: TRANSPORT_HIGH_WATER_MARK,
    write(chunk, _encoding, callback) {
      activeWrites += 1;
      void consumeChunk(chunk, false)
        .then(() => {
          activeWrites -= 1;
          callback();
        })
        .catch((error) => {
          activeWrites -= 1;
          handleError(error);
          callback();
        });
    },
    final(callback) {
      activeWrites += 1;
      void consumeChunk(Buffer.alloc(0), true)
        .then(() => queue.onIdle())
        .then(() => {
          activeWrites -= 1;
          callback();
        })
        .catch((error) => {
          activeWrites -= 1;
          handleError(error);
          callback();
        });
    },
  }) as FlushableTransportStream;

  stream.flush = (callback?: FlushCallback) => {
    void waitForTransportIdle()
      .then(() => {
        if (callback) {
          process.nextTick(callback);
        }
      })
      .catch((error) => {
        if (callback) {
          process.nextTick(callback, error as Error);
        }
      });
  };

  return stream;

  async function consumeChunk(chunk: string | Buffer, flushRemainder: boolean): Promise<void> {
    pendingText += typeof chunk === 'string' ? chunk : decoder.write(chunk);

    if (flushRemainder) {
      pendingText += decoder.end();
    }

    const lines = extractLines(flushRemainder);
    for (const line of lines) {
      await processLine(line);
    }
  }

  function extractLines(flushRemainder: boolean): string[] {
    const lines: string[] = [];
    let newlineIndex = pendingText.indexOf('\n');

    while (newlineIndex >= 0) {
      lines.push(trimTrailingCarriageReturn(pendingText.slice(0, newlineIndex)));
      pendingText = pendingText.slice(newlineIndex + 1);
      newlineIndex = pendingText.indexOf('\n');
    }

    if (flushRemainder && pendingText.length > 0) {
      lines.push(trimTrailingCarriageReturn(pendingText));
      pendingText = '';
    }

    return lines;
  }

  async function processLine(line: string): Promise<void> {
    if (line.length === 0) {
      return;
    }

    const log = parseLog(line);
    if (!log) {
      return;
    }
    if (!shouldProcessLog(log)) {
      return;
    }

    const queuedTask = queue.push(async () => {
      await processLog(log);
    });

    void queuedTask.done.catch((error) => {
      handleError(error);
    });

    await queuedTask.ready;
  }

  async function waitForTransportIdle(): Promise<void> {
    while (activeWrites > 0 || stream.writableLength > 0 || stream.writableNeedDrain) {
      await waitForNextTurn();
    }

    await queue.onIdle();

    if (activeWrites > 0 || stream.writableLength > 0 || stream.writableNeedDrain) {
      await waitForTransportIdle();
    }
  }

  /**
   * Формирует Telegram-запрос из записи Pino и отправляет его всем настроенным чатам.
   *
   * @param log Структурированная запись журнала, полученная от pino.
   */
  async function processLog(log: PinoLog): Promise<void> {
    for (const target of normalized.targets) {
      await rateLimiter.wait(getTargetKey(target.chatId), normalized.minDelayBetweenMessages);
      const message = await buildMessage({ log, target, options: normalized }, normalized);
      let request: TelegramRequest;

      try {
        request = buildRequest(target, message);
      } catch (error) {
        handleError(error);
        continue;
      }

      try {
        await client.send(request);
      } catch (error) {
        handleError(error, request);
      }
    }
  }
  function shouldProcessLog(log: PinoLog): boolean {
    if (!Number.isFinite(log.level)) {
      return true;
    }
    return log.level >= normalized.minLevel;
  }

  /**
   * Централизованно обрабатывает ошибки доставки сообщений в Telegram.
   * Сначала проксирует ошибку в пользовательский обработчик, а затем логирует её в stderr при его отсутствии.
   *
   * @param error Первоначальная ошибка доставки или обработки лога.
   * @param request Исходный Telegram-запрос, если он уже был сформирован.
   */
  function handleError(error: unknown, request?: TelegramRequest) {
    if (normalized.onDeliveryError) {
      normalized.onDeliveryError(error, request?.payload, request?.method);
      return;
    }

    if (error instanceof TelegramDeliveryError) {
      console.error('[pino-telegram] Ошибка доставки:', error.message, error.response);
    } else {
      console.error('[pino-telegram] Необработанная ошибка доставки:', error);
    }
  }

  /**
   * Преобразует форматированное сообщение в конкретный Telegram-запрос.
   *
   * @param target Описание чата и темы, куда следует отправить сообщение.
   * @param message Результат работы форматтера, содержащий текст и дополнительные поля.
   * @returns Готовый Telegram-запрос с выбранным методом и полезной нагрузкой.
   */
  function buildRequest(target: TelegramChatTarget, message: FormatMessageResult): TelegramRequest {
    const method: TelegramMethod = message.method ?? 'sendMessage';
    const base = createBasePayload(target);
    const extra = { ...(message.extra ?? {}) } as Record<string, unknown>;

    switch (method) {
      case 'sendMessage': {
        const payload: TelegramMessagePayload = {
          ...base,
          text: message.text,
          disable_web_page_preview: normalized.disableWebPagePreview,
        };
        Object.assign(payload, extra);
        return { method, payload };
      }
      case 'sendPhoto': {
        const media = normalizeMediaValue(extra.photo, 'photo');
        if (!media) {
          throw new Error('Форматтер должен вернуть поле photo для метода sendPhoto.');
        }
        const caption = typeof extra.caption === 'string' ? extra.caption : message.text;
        delete extra.photo;
        delete extra.caption;
        const payload: TelegramPhotoPayload = {
          ...base,
          photo: media,
          caption,
        };
        Object.assign(payload, extra);
        return { method, payload };
      }
      case 'sendDocument': {
        const media = normalizeMediaValue(extra.document, 'document');
        if (!media) {
          throw new Error('Форматтер должен вернуть поле document для метода sendDocument.');
        }
        const caption = typeof extra.caption === 'string' ? extra.caption : message.text;
        delete extra.document;
        delete extra.caption;
        const payload: TelegramDocumentPayload = {
          ...base,
          document: media,
          caption,
        };
        Object.assign(payload, extra);
        return { method, payload };
      }
      default:
        throw new Error(`Неизвестный метод Telegram: ${String(method)}`);
    }
  }

  /**
   * Формирует базовые поля запроса с учётом настроек транспорта.
   *
   * @param target Целевой чат и опциональная тема из настроек.
   * @returns Базовая полезная нагрузка Telegram без медиа-специфичных полей.
   */
  function createBasePayload(target: TelegramChatTarget): TelegramBasePayload {
    const base: TelegramBasePayload = {
      chat_id: target.chatId,
      parse_mode: normalized.parseMode,
      disable_notification: normalized.disableNotification,
    };
    if (typeof target.threadId === 'number') {
      base.message_thread_id = target.threadId;
    }
    return base;
  }
}

/**
 * Приводит медиаполя форматтера к форме, совместимой с Telegram API.
 * Строки интерпретируются как готовые file_id или URL, бинарные данные превращаются в TelegramInputFile.
 *
 * @param value Исходное значение из форматтера.
 * @param field Тип медиаполя, определяющий значения по умолчанию.
 * @returns Значение, подходящее для вставки в запрос Telegram, либо undefined.
 */
function normalizeMediaValue(
  value: unknown,
  field: 'photo' | 'document',
): string | TelegramInputFile | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (isTelegramInputFileValue(value)) {
    return {
      data: toUint8Array(value.data),
      filename: value.filename,
      contentType: value.contentType,
    };
  }
  if (isBinaryLike(value)) {
    return {
      data: toUint8Array(value),
      filename: defaultFilename(field),
      contentType: defaultContentType(field),
    };
  }
  return undefined;
}

/**
 * Проверяет, соответствует ли значение ожиданиям TelegramInputFile.
 *
 * @param value Произвольное значение из форматтера.
 * @returns True, если значение похоже на объект TelegramInputFile.
 */
function isTelegramInputFileValue(value: unknown): value is TelegramInputFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    isBinaryLike((value as TelegramInputFile).data)
  );
}

interface SerializedBuffer {
  type: 'Buffer';
  data: number[];
}

function isSerializedBuffer(value: unknown): value is SerializedBuffer {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  );
}

/**
 * Определяет, можно ли трактовать значение как бинарное содержимое.
 *
 * @param value Проверяемое значение.
 * @returns True, если значение представляет Buffer, Uint8Array, ArrayBuffer или сериализованный Buffer.
 */
function isBinaryLike(
  value: unknown,
): value is Buffer | Uint8Array | ArrayBuffer | SerializedBuffer {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return true;
  }
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
    return true;
  }
  return isSerializedBuffer(value);
}

/**
 * Приводит разные бинарные контейнеры к Uint8Array.
 *
 * @param data Исходные бинарные данные.
 * @returns Uint8Array с содержимым исходного значения.
 */
function toUint8Array(data: Buffer | Uint8Array | ArrayBuffer | SerializedBuffer): Uint8Array {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (isSerializedBuffer(data)) {
    return Uint8Array.from(data.data);
  }
  throw new TypeError('Unsupported binary payload');
}

/**
 * Возвращает имя файла по умолчанию для загрузки медиа.
 *
 * @param field Тип медиаполя (photo или document).
 */
function defaultFilename(field: 'photo' | 'document'): string {
  return field === 'photo' ? 'photo.jpg' : 'document.bin';
}

/**
 * Возвращает content-type по умолчанию для выбранного типа медиа.
 *
 * @param field Тип медиаполя (photo или document).
 */
function defaultContentType(field: 'photo' | 'document'): string {
  return field === 'photo' ? 'image/jpeg' : 'application/octet-stream';
}

/**
 * Создаёт поток-заглушку, который игнорирует все входящие сообщения Pino.
 * Используется, когда транспорт невозможно инициализировать из-за ошибок конфигурации.
 *
 * @returns Поток, совместимый с pino, который не выполняет никаких действий.
 */
function createNoopStream() {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  }) as FlushableTransportStream;

  stream.flush = (callback?: FlushCallback) => {
    if (callback) {
      process.nextTick(callback);
    }
  };

  return stream;
}

/**
 * Преобразует произвольный chunk из pino в объект лога.
 *
 * @param chunk Входящее значение из потока pino.
 * @returns Распарсенный лог или null, если данные нельзя распознать.
 */
function parseLog(chunk: unknown): PinoLog | null {
  if (!chunk) {
    return null;
  }

  if (typeof chunk === 'string') {
    try {
      return JSON.parse(chunk) as PinoLog;
    } catch (error) {
      console.error('[pino-telegram] Невозможно распарсить строку лога', error);
      return null;
    }
  }

  if (typeof chunk === 'object') {
    return chunk as PinoLog;
  }

  return null;
}

/**
 * Преобразует идентификатор чата в строковый ключ для rate limiter.
 *
 * @param chatId Идентификатор Telegram-чата.
 * @returns Строковый ключ для карты задержек.
 */
function getTargetKey(chatId: TelegramMessagePayload['chat_id']): string {
  return String(chatId);
}

function trimTrailingCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function waitForNextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}
