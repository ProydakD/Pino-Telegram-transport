import { escapeHtml, formatTimestamp, truncate } from './utils';
import { FormatMessageInput, FormatMessageResult, NormalizedOptions, PinoLog } from './types';

const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

const LEVEL_ICONS: Record<string, string> = {
  TRACE: '🔍',
  DEBUG: '🐛',
  INFO: 'ℹ️',
  WARN: '⚠️',
  ERROR: '❗',
  FATAL: '💀',
};

const RESERVED_FIELDS = new Set(['level', 'time', 'msg', 'context', 'err']);

/**
 * Формирует полезную нагрузку для Telegram-сообщения на основе записи pino.
 * При наличии пользовательского форматтера делегирует работу ему, иначе использует формат по умолчанию.
 *
 * @param input Данные о логе и целевом чате, полученные от транспорта.
 * @param options Нормализованные опции транспорта.
 * @returns Текст сообщения и дополнительные поля для Telegram.
 */
export async function buildMessage(
  input: FormatMessageInput,
  options: NormalizedOptions,
): Promise<FormatMessageResult> {
  const result = options.formatMessage
    ? await options.formatMessage(input)
    : buildDefaultMessage(input, options);
  return ensureMaxLength(result, options.maxMessageLength);
}

/**
 * Формирует сообщение в стандартном HTML-формате, добавляя уровень, время, контекст и ошибки.
 *
 * @param input Данные о логе и назначении сообщения.
 * @param options Нормализованные опции транспорта.
 * @returns Сообщение с текстом и дополнительными параметрами.
 */
export function buildDefaultMessage(
  input: FormatMessageInput,
  options: NormalizedOptions,
): FormatMessageResult {
  const { log } = input;
  const levelLabel = resolveLevel(log.level);
  const levelIcon = LEVEL_ICONS[levelLabel] ?? '';
  const timestamp = formatTimestamp(log.time);
  const message = sanitizeMessage(log.msg ?? 'Message is missing');
  const headings = options.headings;

  const header = `${levelIcon ? `${levelIcon} ` : ''}${levelLabel} — <b>${message}</b>`;
  const parts: string[] = [header, `<b>${escapeHtml(headings.time)}:</b> ${escapeHtml(timestamp)}`];

  const context = extractContext(log, options);
  if (context) {
    parts.push(formatContextBlock(headings.context, context));
  }

  const errorBlock = formatError(log, headings);
  if (errorBlock) {
    parts.push(errorBlock);
  }

  const extras = extractExtras(log, options);
  if (extras) {
    parts.push(formatContextBlock(headings.extras, extras));
  }

  const textContent = parts.join('\n');
  return { text: textContent, extra: {} };
}

/**
 * Преобразует числовой уровень pino в строковый ярлык.
 *
 * @param level Числовой уровень логирования.
 * @returns Название уровня в верхнем регистре.
 */
function resolveLevel(level?: number): string {
  if (!level) {
    return 'INFO';
  }
  return LEVEL_LABELS[level] ?? `LEVEL ${level}`;
}

/**
 * Экранирует HTML и заменяет переводы строк, чтобы текст безопасно отображался в Telegram.
 *
 * @param message Исходное сообщение лога.
 * @returns Подготовленная строка для отправки в Telegram.
 */
function sanitizeMessage(message: string): string {
  return escapeHtml(message).replace(/\r?\n/g, '<br/>');
}

/**
 * Извлекает пользовательский контекст из записи pino согласно настройкам транспорта.
 *
 * @param log Исходный лог pino.
 * @param options Нормализованные опции транспорта.
 * @returns Контекст или undefined, если контекст отключён.
 */
function extractContext(log: PinoLog, options: NormalizedOptions): unknown {
  if (!options.includeContext) {
    return undefined;
  }
  for (const key of options.contextKeys) {
    if (key in log) {
      return (log as Record<string, unknown>)[key];
    }
  }
  return undefined;
}

/**
 * Форматирует объекты для отображения в секциях Context/Extras/Error.
 *
 * @param title Заголовок блока.
 * @param value Значение, которое нужно вывести.
 * @returns HTML-блок с заголовком и содержимым в теге <pre>.
 */
function formatContextBlock(title: string, value: unknown): string {
  const rendered = escapeHtml(JSON.stringify(value, null, 2));
  return `<b>${escapeHtml(title)}:</b>\n<pre>${rendered}</pre>`;
}

/**
 * Собирает информацию об ошибке из поля err записи pino.
 *
 * @param log Исходный лог pino.
 * @param headings Пользовательские заголовки форматтера.
 * @returns Готовый HTML-блок или undefined, если err отсутствует.
 */
function formatError(log: PinoLog, headings: NormalizedOptions['headings']): string | undefined {
  const err = log.err as Record<string, unknown> | undefined;
  if (!err) {
    return undefined;
  }
  const payload = {
    message: err.message,
    stack: err.stack,
  };
  return formatContextBlock(headings.error, payload);
}

/**
 * Формирует секцию Extras на основе настроек includeExtras и списка ключей.
 *
 * @param log Исходный лог pino.
 * @param options Нормализованные опции транспорта.
 * @returns Объект с дополнительными полями или undefined.
 */
function extractExtras(
  log: PinoLog,
  options: NormalizedOptions,
): Record<string, unknown> | undefined {
  if (!options.includeExtras) {
    return undefined;
  }

  const explicitKeys = options.extraKeys?.filter((key) => !RESERVED_FIELDS.has(key));
  if (explicitKeys && explicitKeys.length > 0) {
    const picked = explicitKeys
      .map((key) => [key, (log as Record<string, unknown>)[key]] as const)
      .filter(([, value]) => value !== undefined);
    if (picked.length === 0) {
      return undefined;
    }
    return Object.fromEntries(picked);
  }

  const entries = Object.entries(log).filter(([key, value]) => {
    if (RESERVED_FIELDS.has(key)) {
      return false;
    }
    return value !== undefined;
  });
  if (entries.length === 0) {
    return undefined;
  }
  return Object.fromEntries(entries);
}

/**
 * Контролирует длину текста сообщения и добавляет уведомление при усечении.
 *
 * @param result Результат форматтера.
 * @param maxLength Максимальная длина, допустимая Telegram.
 * @returns Обновлённый результат с учётом ограничений длины.
 */
function ensureMaxLength(result: FormatMessageResult, maxLength: number): FormatMessageResult {
  const { text, extra, method } = result;
  const { text: trimmed, truncated } = truncate(text, maxLength);
  if (!truncated) {
    return { text: trimmed, extra, method };
  }
  const notice = `\n\n<b>Сообщение обрезано из-за ограничения Telegram</b>`;
  const { text: finalText } = truncate(trimmed + notice, maxLength);
  return { text: finalText, extra, method };
}
