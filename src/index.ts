import build from 'pino-abstract-transport';
import { buildMessage } from './formatter';
import { RateLimiter, TaskQueue } from './rate-limiter';
import { normalizeOptions } from './utils';
import {
  PinoLog,
  TelegramMessagePayload,
  TelegramTransportOptions,
  FormatMessageInput,
  FormatMessageResult,
} from './types';
import { TelegramClient, TelegramDeliveryError } from './telegram-client';

export type {
  TelegramTransportOptions,
  FormatMessageInput,
  FormatMessageResult,
  TelegramMessagePayload,
};
export { TelegramDeliveryError } from './telegram-client';

/**
 * Создаёт потоковый транспорт для Pino, пересылающий сообщения в Telegram Bot API.
 *
 * @param options Опции, определяющие способ отправки и форматирования сообщений.
 */
export default function telegramTransport(options: TelegramTransportOptions) {
  const normalized = normalizeOptions(options);
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
      const payload: TelegramMessagePayload = {
        chat_id: target.chatId,
        text: message.text,
        parse_mode: normalized.parseMode,
        disable_notification: normalized.disableNotification,
        disable_web_page_preview: normalized.disableWebPagePreview,
      };

      if (typeof target.threadId === 'number') {
        payload.message_thread_id = target.threadId;
      }

      if (message.extra) {
        Object.assign(payload, message.extra);
      }

      try {
        await client.sendMessage(payload);
      } catch (error) {
        handleError(error, payload);
      }
    }
  }

  /**
   * Единая точка логирования ошибок доставки. Вызывает пользовательский обработчик,
   * если он предоставлен, иначе выводит сообщение в stderr.
   */
  function handleError(error: unknown, payload?: TelegramMessagePayload) {
    if (normalized.onDeliveryError) {
      normalized.onDeliveryError(error, payload);
      return;
    }

    if (error instanceof TelegramDeliveryError) {
      console.error('[pino-telegram-transport] Ошибка доставки:', error.message, error.response);
    } else {
      console.error('[pino-telegram-transport] Необработанная ошибка доставки:', error);
    }
  }
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
      console.error('[pino-telegram-transport] Невозможно распарсить строку лога', error);
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
