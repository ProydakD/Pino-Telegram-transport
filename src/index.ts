import build from 'pino-abstract-transport';
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
};
export { TelegramDeliveryError } from './telegram-client';
export { createMediaFormatter } from './presets';
export {
  createNestLoggerOptions,
  createFastifyLoggerOptions,
  createLambdaLoggerOptions,
} from './adapters';
export type { NestLoggerOptions, NestLoggerOverrides, FastifyLoggerOptions } from './adapters';

/**
 * Создаёт потоковый транспорт для Pino, пересылающий сообщения в Telegram Bot API.
 * Если обязательные параметры не указаны, возвращает no-op поток и выводит предупреждение.
 */
export default function telegramTransport(options: TelegramTransportOptions) {
  let normalized: ReturnType<typeof normalizeOptions>;

  try {
    normalized = normalizeOptions(options);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('botToken') || error.message.includes('целевого чата'))
    ) {
      console.warn(`[pino-telegram] transport disabled: ${error.message}`);
      return createNoopStream();
    }
    throw error;
  }

  const client = new TelegramClient(normalized);
  const rateLimiter = new RateLimiter();
  const queue = new TaskQueue();

  const stream = build((source) => {
    source.on('unknown', (line: string) => {
      handleError(new Error(`Не удалось разобрать строку: ${line}`));
    });

    source.on('data', (chunk: unknown) => {
      const log = parseLog(chunk);
      if (!log) {
        return;
      }

      queue
        .push(async () => {
          await processLog(log);
        })
        .catch((error) => {
          handleError(error);
        });
    });

    const finalize = () => {
      queue.onIdle().catch(() => {
        // Игнорируем ошибки завершения очереди, чтобы не блокировать поток.
      });
    };

    source.on('end', finalize);
    source.on('close', finalize);
  });

  return stream;

  /**
   * Обрабатывает запись лога: форматирует и последовательно отправляет во все целевые чаты.
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

  /**
   * Единая точка логирования ошибок доставки. Вызывает пользовательский обработчик,
   * если он предоставлен, иначе выводит сообщение в stderr.
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

function defaultFilename(field: 'photo' | 'document'): string {
  return field === 'photo' ? 'photo.jpg' : 'document.bin';
}

function defaultContentType(field: 'photo' | 'document'): string {
  return field === 'photo' ? 'image/jpeg' : 'application/octet-stream';
}

/**
 * Возвращает no-op поток, который просто проглатывает входящие данные.
 */
function createNoopStream() {
  return build((source) => {
    source.on('data', () => {});
    source.on('unknown', () => {});
  });
}

/**
 * Преобразует входящие данные Pino в объект лога или возвращает null, если парсинг невозможен.
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
 * Ключ, по которому хранятся временные метки в лимитере частоты.
 */
function getTargetKey(chatId: TelegramMessagePayload['chat_id']): string {
  return String(chatId);
}
