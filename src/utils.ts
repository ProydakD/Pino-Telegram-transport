import {
  NormalizedOptions,
  RawChatTarget,
  TelegramChatTarget,
  TelegramQueueOverflowStrategy,
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
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;
const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_OVERFLOW_STRATEGY: TelegramQueueOverflowStrategy = 'dropOldest';
const TRUNCATION_SUFFIX = '...';
const HTML_VOID_TAGS = new Set(['br']);
const HTML_ENTITY_PATTERN = /^&(?:#\d+|#x[\da-f]+|[a-z][a-z0-9]+);$/i;
const DEFAULT_REDACT_KEYS = Object.freeze([
  'token',
  'password',
  'secret',
  'authorization',
  'cookie',
  'apikey',
]);
const REDACTED_VALUE = '[REDACTED]';

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
  const requestTimeoutMs = normalizeRequestTimeoutMs(options.requestTimeoutMs);
  const maxQueueSize = normalizeMaxQueueSize(options.maxQueueSize);
  const overflowStrategy = normalizeOverflowStrategy(options.overflowStrategy);
  const redactKeys = normalizeRedactKeys(options.redactKeys);

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
    redactKeys,
    maxMessageLength: options.maxMessageLength ?? DEFAULT_MAX_LENGTH,
    splitLongMessages: options.splitLongMessages ?? false,
    minDelayBetweenMessages: options.minDelayBetweenMessages ?? DEFAULT_MIN_DELAY,
    minLevel,
    maxQueueSize,
    overflowStrategy,
    retryAttempts,
    retryInitialDelay,
    retryBackoffFactor,
    retryMaxDelay,
    requestTimeoutMs,
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
  const threadId = coerceThreadId((options as unknown as { threadId?: unknown }).threadId);

  return raw
    .map((entry) => normalizeTarget(entry as RawChatTarget, threadId))
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

  const { chatId, threadId } = entry as TelegramChatTarget & { threadId?: unknown };
  if (chatId === undefined || chatId === null) {
    return null;
  }

  return {
    chatId,
    threadId: coerceThreadId(threadId) ?? defaultThread,
  };
}

/**
 * Приводит значение идентификатора темы к числу, если возможно.
 * Принимает number, numeric string, игнорирует пустые строки и NaN.
 */
function coerceThreadId(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.trunc(parsed);
  }
  return undefined;
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

function normalizeRequestTimeoutMs(value: TelegramTransportOptions['requestTimeoutMs']): number {
  if (value === undefined || value === null) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error('requestTimeoutMs должен быть числом');
  }
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeMaxQueueSize(value: TelegramTransportOptions['maxQueueSize']): number {
  if (value === undefined || value === null) {
    return DEFAULT_MAX_QUEUE_SIZE;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error('maxQueueSize должен быть числом');
  }
  if (!Number.isFinite(value)) {
    throw new Error('maxQueueSize должен быть конечным числом');
  }
  return Math.max(1, Math.trunc(value));
}

function normalizeOverflowStrategy(
  value: TelegramTransportOptions['overflowStrategy'],
): TelegramQueueOverflowStrategy {
  if (value === undefined || value === null) {
    return DEFAULT_OVERFLOW_STRATEGY;
  }
  if (value === 'dropOldest' || value === 'dropNewest' || value === 'block') {
    return value;
  }
  throw new Error('Неизвестная стратегия переполнения очереди: ' + String(value));
}

function normalizeRedactKeys(value: TelegramTransportOptions['redactKeys']): string[] {
  if (value === undefined || value === null) {
    return [...DEFAULT_REDACT_KEYS];
  }
  if (!Array.isArray(value)) {
    throw new Error('redactKeys должен быть массивом строк');
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);

  return Array.from(new Set(normalized));
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
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Обрезает plain-text строку до заданной длины, добавляя многоточие при необходимости.
 *
 * @param text Исходная строка.
 * @param maxLength Максимальный размер строки.
 * @returns Усечённая строка и флаг сокращения.
 */
export function truncateText(
  text: string,
  maxLength: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  if (maxLength <= 0) {
    return { text: '', truncated: text.length > 0 };
  }
  if (maxLength <= TRUNCATION_SUFFIX.length) {
    return { text: TRUNCATION_SUFFIX.slice(0, maxLength), truncated: true };
  }
  const sliced = text.slice(0, maxLength - TRUNCATION_SUFFIX.length);
  return { text: `${sliced}${TRUNCATION_SUFFIX}`, truncated: true };
}

/**
 * Обрезает HTML-текст, не разрывая теги и HTML entities и закрывая открытые теги.
 *
 * @param text Исходная строка с HTML-разметкой.
 * @param maxLength Максимальный размер строки.
 * @returns Усечённая безопасная HTML-строка и флаг сокращения.
 */
export function truncateHtml(
  text: string,
  maxLength: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  if (maxLength <= 0) {
    return { text: '', truncated: text.length > 0 };
  }
  if (maxLength <= TRUNCATION_SUFFIX.length) {
    return { text: TRUNCATION_SUFFIX.slice(0, maxLength), truncated: true };
  }

  const tokens = tokenizeHtml(text);
  let prefix = '';
  let currentLength = 0;
  let openTags: HtmlOpenTag[] = [];

  for (const token of tokens) {
    const nextLength = currentLength + token.value.length;
    const nextOpenTags = updateOpenTags(openTags, token);
    const closingTags = buildClosingTags(nextOpenTags);

    if (nextLength + TRUNCATION_SUFFIX.length + closingTags.length > maxLength) {
      break;
    }

    prefix += token.value;
    currentLength = nextLength;
    openTags = nextOpenTags;
  }

  if (!prefix) {
    return { text: TRUNCATION_SUFFIX.slice(0, maxLength), truncated: true };
  }

  return {
    text: `${prefix}${TRUNCATION_SUFFIX}${buildClosingTags(openTags)}`,
    truncated: true,
  };
}

/**
 * Разбивает plain-text строку на части заданной длины без потери содержимого.
 *
 * @param text Исходная строка.
 * @param maxLength Максимальная длина одной части.
 * @returns Последовательность частей в исходном порядке.
 */
export function splitText(text: string, maxLength: number): string[] {
  if (maxLength <= 0) {
    return [truncateText(text, maxLength).text];
  }
  if (text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  let index = 0;

  while (index < text.length) {
    parts.push(text.slice(index, index + maxLength));
    index += maxLength;
  }

  return parts;
}

/**
 * Разбивает HTML-текст на несколько валидных частей, не разрывая теги и entities.
 *
 * @param text Исходная строка с HTML-разметкой.
 * @param maxLength Максимальная длина одной части.
 * @returns Последовательность HTML-safe частей.
 */
export function splitHtml(text: string, maxLength: number): string[] {
  if (maxLength <= 0) {
    return [truncateHtml(text, maxLength).text];
  }
  if (text.length <= maxLength) {
    return [text];
  }

  const tokens = tokenizeHtml(text);
  const parts: string[] = [];
  let openTags: HtmlOpenTag[] = [];
  let currentPart = '';
  let currentPartHasTokens = false;
  let index = 0;

  while (index < tokens.length) {
    if (!currentPart) {
      currentPart = buildOpeningTags(openTags);
      currentPartHasTokens = false;
    }

    const token = tokens[index];
    const nextOpenTags = updateOpenTags(openTags, token);
    const candidate = `${currentPart}${token.value}${buildClosingTags(nextOpenTags)}`;

    if (candidate.length <= maxLength) {
      currentPart += token.value;
      currentPartHasTokens = true;
      openTags = nextOpenTags;
      index += 1;
      continue;
    }

    if (currentPartHasTokens) {
      parts.push(`${currentPart}${buildClosingTags(openTags)}`);
      currentPart = '';
      currentPartHasTokens = false;
      continue;
    }

    const remainingHtml = `${buildOpeningTags(openTags)}${tokens
      .slice(index)
      .map((item) => item.value)
      .join('')}`;
    parts.push(truncateHtml(remainingHtml, maxLength).text);
    return parts;
  }

  if (currentPartHasTokens || parts.length === 0) {
    parts.push(`${currentPart}${buildClosingTags(openTags)}`);
  }

  return parts;
}

/**
 * Форматирует временную метку в ISO-строку.
 *
 * @param time Временная отметка или строка с датой.
 * @returns Строка в формате ISO 8601.
 */
export function formatTimestamp(time?: number | string): string {
  if (time === undefined) {
    return new Date().toISOString();
  }

  const date = new Date(time);
  if (Number.isNaN(date.getTime())) {
    return typeof time === 'string' ? time : String(time);
  }

  return date.toISOString();
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

/**
 * Создаёт копию значения с редактированием чувствительных ключей.
 *
 * @param value Исходное значение для форматирования.
 * @param redactKeys Ключи, значения которых заменяются маркером.
 * @returns Новая структура данных без мутации исходного значения.
 */
export function redactSensitiveData(value: unknown, redactKeys: string[]): unknown {
  if (redactKeys.length === 0) {
    return cloneUnknownValue(value);
  }

  const redactSet = new Set(redactKeys.map((item) => item.toLowerCase()));
  return cloneUnknownValue(value, redactSet);
}

function cloneUnknownValue(value: unknown, redactSet?: ReadonlySet<string>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneUnknownValue(item, redactSet));
  }

  if (value instanceof Date) {
    return new Date(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value);
  const clone = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>;

  for (const [key, entryValue] of entries) {
    clone[key] = redactSet?.has(key.toLowerCase())
      ? REDACTED_VALUE
      : cloneUnknownValue(entryValue, redactSet);
  }

  return clone;
}

type HtmlTokenKind = 'text' | 'entity' | 'tag';
type HtmlTagKind = 'open' | 'close' | 'self';

interface HtmlToken {
  kind: HtmlTokenKind;
  value: string;
  tagKind?: HtmlTagKind;
  tagName?: string;
}

interface HtmlOpenTag {
  name: string;
  value: string;
}

function tokenizeHtml(text: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let index = 0;

  while (index < text.length) {
    const tagToken = readHtmlTagToken(text, index);
    if (tagToken) {
      tokens.push(tagToken);
      index += tagToken.value.length;
      continue;
    }

    const entityToken = readHtmlEntityToken(text, index);
    if (entityToken) {
      tokens.push(entityToken);
      index += entityToken.value.length;
      continue;
    }

    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) {
      break;
    }

    const value = String.fromCodePoint(codePoint);
    tokens.push({
      kind: 'text',
      value,
    });
    index += value.length;
  }

  return tokens;
}

function readHtmlTagToken(text: string, index: number): HtmlToken | undefined {
  if (text[index] !== '<') {
    return undefined;
  }

  const closingIndex = text.indexOf('>', index + 1);
  if (closingIndex === -1) {
    return undefined;
  }

  const value = text.slice(index, closingIndex + 1);
  const content = value.slice(1, -1).trim();
  if (!content || content.startsWith('!') || content.startsWith('?')) {
    return { kind: 'tag', value, tagKind: 'self' };
  }

  if (content.startsWith('/')) {
    const tagName = extractHtmlTagName(content.slice(1));
    return {
      kind: 'tag',
      value,
      tagKind: tagName ? 'close' : 'self',
      tagName,
    };
  }

  const normalizedContent = content.replace(/\/\s*$/, '').trim();
  const tagName = extractHtmlTagName(normalizedContent);
  if (!tagName) {
    return { kind: 'tag', value, tagKind: 'self' };
  }

  return {
    kind: 'tag',
    value,
    tagKind: /\/\s*$/.test(content) || HTML_VOID_TAGS.has(tagName) ? 'self' : 'open',
    tagName,
  };
}

function readHtmlEntityToken(text: string, index: number): HtmlToken | undefined {
  if (text[index] !== '&') {
    return undefined;
  }

  const closingIndex = text.indexOf(';', index + 1);
  if (closingIndex === -1) {
    return undefined;
  }

  const value = text.slice(index, closingIndex + 1);
  if (value.length > 32 || !HTML_ENTITY_PATTERN.test(value)) {
    return undefined;
  }

  return {
    kind: 'entity',
    value,
  };
}

function extractHtmlTagName(value: string): string | undefined {
  const match = /^([a-z][a-z0-9-]*)/i.exec(value.trim());
  return match?.[1].toLowerCase();
}

function updateOpenTags(openTags: HtmlOpenTag[], token: HtmlToken): HtmlOpenTag[] {
  if (token.kind !== 'tag' || !token.tagName) {
    return openTags;
  }

  if (token.tagKind === 'open') {
    return [
      ...openTags,
      {
        name: token.tagName,
        value: token.value,
      },
    ];
  }

  if (token.tagKind === 'close' && openTags[openTags.length - 1]?.name === token.tagName) {
    return openTags.slice(0, -1);
  }

  return openTags;
}

function buildOpeningTags(openTags: HtmlOpenTag[]): string {
  return openTags.map((tag) => tag.value).join('');
}

function buildClosingTags(openTags: HtmlOpenTag[]): string {
  return [...openTags]
    .reverse()
    .map((tag) => `</${tag.name}>`)
    .join('');
}

interface RequestTimeoutContext {
  signal?: AbortSignal;
  dispose: () => void;
  didTimeout: () => boolean;
}

/**
 * Создаёт AbortSignal с ограничением по времени для HTTP-запросов.
 *
 * @param timeoutMs Максимальное время ожидания в миллисекундах. 0 отключает таймаут.
 * @returns Контекст с сигналом, функцией очистки таймера и флагом срабатывания.
 */
export function createRequestTimeout(timeoutMs: number): RequestTimeoutContext {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return {
      signal: undefined,
      dispose: () => {},
      didTimeout: () => false,
    };
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  timer.unref?.();

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
    },
    didTimeout: () => timedOut,
  };
}
