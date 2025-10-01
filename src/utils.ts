import {
  NormalizedOptions,
  RawChatTarget,
  TelegramChatTarget,
  TelegramTransportOptions,
} from './types';
import { createMediaFormatter } from './presets';

const TELEGRAM_BASE_URL = 'https://api.telegram.org';
const DEFAULT_CONTEXT_KEYS = ['context', 'ctx'];
const DEFAULT_MAX_LENGTH = 4096;
const DEFAULT_MIN_DELAY = 100;
const DEFAULT_HEADINGS = Object.freeze({
  time: 'Time',
  context: 'Context',
  error: 'Error',
  extras: 'Extras',
});
const DEFAULT_INCLUDE_EXTRAS = true;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_INITIAL_DELAY = 500;
const DEFAULT_RETRY_BACKOFF = 2;
const DEFAULT_RETRY_MAX_DELAY = 10000;

const PINO_LEVEL_VALUES = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
});

type ConfigurationErrorCode = 'MISSING_BOT_TOKEN' | 'NO_CHAT_TARGET';

function createConfigurationError(message: string, code: ConfigurationErrorCode) {
  const error = new Error(message) as Error & { code: ConfigurationErrorCode };
  error.code = code;
  return error;
}

/**
 * Проверяет и нормализует опции транспорта, заполняя значения по умолчанию.
 *
 * @param options Исходные пользовательские опции.
 * @returns Нормализованный набор опций, готовый к работе транспорта.
 */
export function normalizeOptions(options: TelegramTransportOptions): NormalizedOptions {
  if (!options || typeof options !== 'object') {
    throw new Error('Опции транспорта должны быть объектом');
  }

  const { botToken } = options;
  if (!botToken || typeof botToken !== 'string') {
    throw createConfigurationError('Необходимо указать botToken', 'MISSING_BOT_TOKEN');
  }

  const targets = normalizeTargets(options);
  if (!targets.length) {
    throw createConfigurationError('Не найдено ни одного целевого чата', 'NO_CHAT_TARGET');
  }

  const parseMode = options.parseMode ?? 'HTML';
  const includeContext = options.includeContext ?? true;
  const contextKeys = Array.isArray(options.contextKeys)
    ? options.contextKeys
    : options.contextKeys
      ? [options.contextKeys]
      : DEFAULT_CONTEXT_KEYS;

  const minLevel = resolveMinLevel(options.minLevel);

  const retryAttempts = Math.max(1, Math.floor(options.retryAttempts ?? DEFAULT_RETRY_ATTEMPTS));
  const retryInitialDelay = Math.max(0, options.retryInitialDelay ?? DEFAULT_RETRY_INITIAL_DELAY);
  const retryBackoffFactor = Math.max(1, options.retryBackoffFactor ?? DEFAULT_RETRY_BACKOFF);
  const retryMaxDelay = Math.max(
    retryInitialDelay,
    options.retryMaxDelay ?? DEFAULT_RETRY_MAX_DELAY,
  );

  return {
    botToken,
    targets,
    parseMode,
    disableNotification: options.disableNotification ?? false,
    disableWebPagePreview: options.disableWebPagePreview ?? true,
    includeContext,
    contextKeys,
    includeExtras: options.includeExtras ?? DEFAULT_INCLUDE_EXTRAS,
    extraKeys: options.extraKeys,
    maxMessageLength: options.maxMessageLength ?? DEFAULT_MAX_LENGTH,
    minDelayBetweenMessages: options.minDelayBetweenMessages ?? DEFAULT_MIN_DELAY,
    minLevel,
    retryAttempts,
    retryInitialDelay,
    retryBackoffFactor,
    retryMaxDelay,
    formatMessage: options.formatMessage || createMediaFormatter(),
    onDeliveryError: options.onDeliveryError,
    send: options.send,
    headings: {
      ...DEFAULT_HEADINGS,
      ...(options.headings ?? {}),
    },
  };
}

/**
 * Преобразует описание целевых чатов в унифицированный массив.
 *
 * @param options Опции транспорта с произвольным описанием chatId.
 * @returns Массив целевых чатов.
 */
function normalizeTargets(options: TelegramTransportOptions): TelegramChatTarget[] {
  const raw = Array.isArray(options.chatId) ? options.chatId : [options.chatId];
  const threadId = options.threadId;

  return raw
    .map((entry) => normalizeTarget(entry, threadId))
    .filter((target): target is TelegramChatTarget => Boolean(target));
}

/**
 * Нормализует единичное описание чата.
 *
 * @param entry Исходное описание чата или строки с chatId.
 * @param defaultThread Общая тема по умолчанию.
 * @returns Структура целевого чата или null, если найти chatId не удалось.
 */
function normalizeTarget(entry: RawChatTarget, defaultThread?: number): TelegramChatTarget | null {
  if (typeof entry === 'number' || typeof entry === 'string') {
    return {
      chatId: entry,
      threadId: defaultThread,
    };
  }

  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const { chatId, threadId } = entry as TelegramChatTarget;
  if (chatId === undefined || chatId === null) {
    return null;
  }

  return {
    chatId,
    threadId: threadId ?? defaultThread,
  };
}

function resolveMinLevel(level: TelegramTransportOptions['minLevel']): number {
  if (level === undefined || level === null) {
    return 0;
  }

  if (typeof level === 'number') {
    if (Number.isNaN(level)) {
      throw new Error('Уровень логирования не может быть NaN');
    }
    if (!Number.isFinite(level)) {
      return level > 0 ? Number.POSITIVE_INFINITY : 0;
    }
    return Math.max(0, level);
  }

  if (typeof level === 'string') {
    const normalized = level.trim().toLowerCase();
    if (!normalized) {
      throw new Error('Уровень логирования не может быть пустой строкой');
    }
    if (Object.prototype.hasOwnProperty.call(PINO_LEVEL_VALUES, normalized)) {
      return PINO_LEVEL_VALUES[normalized as keyof typeof PINO_LEVEL_VALUES];
    }
    const parsed = Number(normalized);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, parsed);
    }
  }

  throw new Error('Неизвестный уровень логирования: ' + String(level));
}

/**
 * Собирает URL вызова метода Telegram Bot API.
 *
 * @param token Токен бота.
 * @param method Имя метода Bot API.
 * @returns Полный URL запроса.
 */
export function buildTelegramUrl(token: string, method: string): string {
  return `${TELEGRAM_BASE_URL}/bot${token}/${method}`;
}

/**
 * Экранирует HTML-символы для безопасной вставки в сообщение.
 *
 * @param value Строка, подлежащая экранированию.
 * @returns Экранированная строка.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Обрезает строку до заданной длины, добавляя многоточие при необходимости.
 *
 * @param text Исходная строка.
 * @param maxLength Максимальный размер строки.
 * @returns Усечённая строка и флаг сокращения.
 */
export function truncate(text: string, maxLength: number): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  const sliced = text.slice(0, maxLength - 3);
  return { text: `${sliced}...`, truncated: true };
}

/**
 * Форматирует временную метку в ISO-строку.
 *
 * @param time Временная отметка или строка с датой.
 * @returns Строка в формате ISO 8601.
 */
export function formatTimestamp(time?: number | string): string {
  if (!time) {
    return new Date().toISOString();
  }
  if (typeof time === 'string') {
    return new Date(time).toISOString();
  }
  return new Date(time).toISOString();
}

/**
 * Гарантирует, что значение представлено массивом.
 *
 * @param value Значение или массив значений.
 * @returns Массив значений.
 */
export function ensureArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
