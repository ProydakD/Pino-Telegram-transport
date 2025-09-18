import {
  NormalizedOptions,
  RawChatTarget,
  TelegramChatTarget,
  TelegramTransportOptions,
} from './types';

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

/**
 * Проверяет и нормализует пользовательские опции транспорта.
 */
export function normalizeOptions(options: TelegramTransportOptions): NormalizedOptions {
  if (!options || typeof options !== 'object') {
    throw new Error('Опции транспорта должны быть объектом');
  }

  const { botToken } = options;
  if (!botToken || typeof botToken !== 'string') {
    throw new Error('Необходимо указать botToken');
  }

  const targets = normalizeTargets(options);
  if (!targets.length) {
    throw new Error('Не найдено ни одного целевого чата');
  }

  const parseMode = options.parseMode ?? 'HTML';
  const includeContext = options.includeContext ?? true;
  const contextKeys = Array.isArray(options.contextKeys)
    ? options.contextKeys
    : options.contextKeys
      ? [options.contextKeys]
      : DEFAULT_CONTEXT_KEYS;

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
    retryAttempts,
    retryInitialDelay,
    retryBackoffFactor,
    retryMaxDelay,
    formatMessage: options.formatMessage,
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

/**
 * Собирает URL вызова метода Telegram Bot API.
 */
export function buildTelegramUrl(token: string, method: string): string {
  return `${TELEGRAM_BASE_URL}/bot${token}/${method}`;
}

/**
 * Экранирует HTML-символы для безопасной вставки в сообщение.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Обрезает строку до заданной длины, добавляя многоточие при необходимости.
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
 */
export function ensureArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
