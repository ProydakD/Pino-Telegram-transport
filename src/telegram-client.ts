import { fetch } from 'undici';
import { buildTelegramUrl } from './utils';
import { NormalizedOptions, TelegramMessagePayload } from './types';

export interface TelegramErrorResponse {
  ok: boolean;
  description?: string;
  error_code?: number;
  parameters?: Record<string, unknown>;
}

/**
 * Ошибка, выбрасываемая при отрицательном ответе Telegram Bot API.
 */
export class TelegramDeliveryError extends Error {
  constructor(
    message: string,
    readonly response?: TelegramErrorResponse,
  ) {
    super(message);
    this.name = 'TelegramDeliveryError';
  }
}

/**
 * Инкапсулирует работу с Telegram Bot API: либо отправляет HTTP-запрос,
 * либо делегирует отправку пользовательской функции `send`.
 */
export class TelegramClient {
  constructor(private readonly options: NormalizedOptions) {}

  async sendMessage(payload: TelegramMessagePayload): Promise<void> {
    if (this.options.send) {
      await this.options.send(payload);
      return;
    }

    const url = buildTelegramUrl(this.options.botToken, 'sendMessage');
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = (await response.json().catch(() => ({}))) as TelegramErrorResponse;

    if (!response.ok || !data.ok) {
      const description = data?.description ?? response.statusText;
      throw new TelegramDeliveryError(`Ошибка Telegram API: ${description}`, data);
    }
  }
}
