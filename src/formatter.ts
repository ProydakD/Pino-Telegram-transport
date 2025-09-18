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
  ERROR: '❌',
  FATAL: '💀',
};

const RESERVED_FIELDS = new Set(['level', 'time', 'msg', 'context', 'err']);

/**
 * Формирует текст сообщения для Telegram. При наличии пользовательского форматтера
 * делегирует работу ему, иначе использует встроенный формат.
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

function buildDefaultMessage(
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

function resolveLevel(level?: number): string {
  if (!level) {
    return 'INFO';
  }
  return LEVEL_LABELS[level] ?? `LEVEL ${level}`;
}

function sanitizeMessage(message: string): string {
  return escapeHtml(message).replace(/\r?\n/g, '<br/>');
}

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

function formatContextBlock(title: string, value: unknown): string {
  const rendered = escapeHtml(JSON.stringify(value, null, 2));
  return `<b>${escapeHtml(title)}:</b>\n<pre>${rendered}</pre>`;
}

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

function ensureMaxLength(result: FormatMessageResult, maxLength: number): FormatMessageResult {
  const { text, extra } = result;
  const { text: trimmed, truncated } = truncate(text, maxLength);
  if (!truncated) {
    return { text: trimmed, extra };
  }
  const notice = `\n\n<b>Сообщение обрезано из-за ограничения Telegram</b>`;
  const { text: finalText } = truncate(trimmed + notice, maxLength);
  return { text: finalText, extra };
}
