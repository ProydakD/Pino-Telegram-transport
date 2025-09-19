import { buildDefaultMessage } from './formatter';
import { FormatMessageInput, FormatMessageResult, TelegramInputFile } from './types';
import { truncate } from './utils';

export interface MediaFormatterOptions {
  /** Ключ, указывающий тип сообщения (text/photo/document). */
  typeKey?: string;
  /** Ключ с URL медиа (photo/document). */
  urlKey?: string;
  /** Ключ с бинарным содержимым медиа (Buffer, Uint8Array, ArrayBuffer или TelegramInputFile). */
  bufferKey?: string;
  /** Ключ с именем файла. */
  filenameKey?: string;
  /** Ключ с MIME-типом. */
  contentTypeKey?: string;
  /** Ключ с подписью. */
  captionKey?: string;
  /** Максимальная длина подписи. */
  captionMaxLength?: number;
}

const DEFAULT_TYPE_KEY = 'messageType';
const DEFAULT_URL_KEY = 'mediaUrl';
const DEFAULT_BUFFER_KEY = 'mediaBuffer';
const DEFAULT_FILENAME_KEY = 'mediaFilename';
const DEFAULT_CONTENT_TYPE_KEY = 'mediaContentType';
const DEFAULT_CAPTION_KEY = 'caption';
const DEFAULT_CAPTION_LIMIT = 1024;

/**
 * Форматтер, который автоматически выбирает метод Telegram Bot API исходя из описания медиа в логе.
 * Ожидается схема вида: `{ messageType: 'photo' | 'document' | 'text', mediaUrl?, mediaBuffer?, caption? }`.
 *
 * @param options Настройки для кастомизации ключей и ограничений.
 * @returns Функция форматтера, совместимая с transport.formatMessage.
 */
export function createMediaFormatter(
  options: MediaFormatterOptions = {},
): (input: FormatMessageInput) => Promise<FormatMessageResult> | FormatMessageResult {
  const typeKey = options.typeKey ?? DEFAULT_TYPE_KEY;
  const urlKey = options.urlKey ?? DEFAULT_URL_KEY;
  const bufferKey = options.bufferKey ?? DEFAULT_BUFFER_KEY;
  const filenameKey = options.filenameKey ?? DEFAULT_FILENAME_KEY;
  const contentTypeKey = options.contentTypeKey ?? DEFAULT_CONTENT_TYPE_KEY;
  const captionKey = options.captionKey ?? DEFAULT_CAPTION_KEY;
  const captionLimit = options.captionMaxLength ?? DEFAULT_CAPTION_LIMIT;

  return (input) => {
    const base = buildDefaultMessage(input, input.options);
    const record = input.log as Record<string, unknown>;

    const typeValue = record[typeKey];
    const messageType = typeof typeValue === 'string' ? typeValue.toLowerCase() : undefined;
    if (messageType !== 'photo' && messageType !== 'document') {
      return base;
    }

    const mediaUrl = readString(record[urlKey]);
    const mediaBuffer = record[bufferKey];
    const filenameFromLog = readString(record[filenameKey]);
    const contentTypeFromLog = readString(record[contentTypeKey]);
    const captionSource = readString(record[captionKey]) ?? base.text;
    const caption = truncateCaption(captionSource, captionLimit);

    const extra = { ...(base.extra ?? {}) } as Record<string, unknown>;

    if (messageType === 'photo') {
      const mediaValue = resolveMediaInput(
        mediaUrl,
        mediaBuffer,
        filenameFromLog ?? 'photo.jpg',
        contentTypeFromLog ?? 'image/jpeg',
      );
      if (!mediaValue) {
        return base;
      }
      extra.photo = mediaValue;
      extra.caption = caption;
      return {
        text: caption,
        method: 'sendPhoto',
        extra,
      };
    }

    const mediaValue = resolveMediaInput(
      mediaUrl,
      mediaBuffer,
      filenameFromLog ?? 'document.bin',
      contentTypeFromLog ?? 'application/octet-stream',
    );
    if (!mediaValue) {
      return base;
    }
    extra.document = mediaValue;
    extra.caption = caption;
    return {
      text: caption,
      method: 'sendDocument',
      extra,
    };
  };
}

/**
 * Приводит медиа-поля к допустимому виду (URL или TelegramInputFile).
 *
 * @param url Строковое значение mediaUrl.
 * @param binary Сырые бинарные данные или объект TelegramInputFile.
 * @param filename Имя файла по умолчанию.
 * @param contentType MIME-тип по умолчанию.
 * @returns Строка или TelegramInputFile либо undefined, если медиа отсутствует.
 */
function resolveMediaInput(
  url: string | undefined,
  binary: unknown,
  filename: string,
  contentType: string,
): string | TelegramInputFile | undefined {
  if (url) {
    return url;
  }

  if (isTelegramInputFile(binary)) {
    return normalizeInputFile(binary);
  }

  if (isBinaryLike(binary)) {
    return {
      data: toUint8Array(binary),
      filename,
      contentType,
    };
  }

  return undefined;
}

/**
 * Проверяет, соответствует ли значение структуре TelegramInputFile.
 *
 * @param value Проверяемое значение.
 * @returns True, если значение содержит поле data.
 */
function isTelegramInputFile(value: unknown): value is TelegramInputFile {
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

/**
 * Распознаёт объект, созданный через JSON.stringify(Buffer.from(...)).
 *
 * @param value Проверяемое значение.
 * @returns True, если объект похож на сериализованный Buffer.
 */
function isSerializedBuffer(value: unknown): value is SerializedBuffer {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  );
}

/**
 * Нормализует объект TelegramInputFile, гарантируя наличие Uint8Array.
 *
 * @param value Исходный TelegramInputFile.
 * @returns Новая структура с нормализованными бинарными данными.
 */
function normalizeInputFile(value: TelegramInputFile): TelegramInputFile {
  const data = value.data;
  return {
    data: toUint8Array(data),
    filename: value.filename,
    contentType: value.contentType,
  };
}

/**
 * Проверяет, можно ли трактовать значение как бинарное содержимое.
 *
 * @param value Проверяемое значение.
 * @returns True, если значение является Buffer, Uint8Array, ArrayBuffer или сериализованным Buffer.
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
 * Приводит различные бинарные представления к Uint8Array.
 *
 * @param data Исходные данные.
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
 * Возвращает строку без ведущих/замыкающих пробелов или undefined.
 *
 * @param value Проверяемое значение.
 */
function readString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
}

/**
 * Усекание подписи с учётом лимита Telegram.
 *
 * @param text Подпись, полученная от пользователя.
 * @param limit Максимально допустимая длина.
 * @returns Усечённая подпись.
 */
function truncateCaption(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const { text: truncated } = truncate(text, limit);
  return truncated;
}
