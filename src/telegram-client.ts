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
    readonly status?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TelegramDeliveryError';
    this.cause = cause;
  }
}

/**
 * Инкапсулирует работу с Telegram Bot API: либо отправляет HTTP-запрос,
 * либо делегирует отправку пользовательской функции `send`.
 */
export class TelegramClient {
  constructor(private readonly options: NormalizedOptions) {}

  async sendMessage(payload: TelegramMessagePayload): Promise<void> {
    await this.executeWithRetry(async () => {
      if (this.options.send) {
        await this.options.send(payload);
        return;
      }

      const url = buildTelegramUrl(this.options.botToken, 'sendMessage');
      let response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        throw new TelegramDeliveryError(
          `Ошибка сети Telegram: ${(error as Error)?.message ?? 'неизвестная ошибка'}`,
          undefined,
          undefined,
          error,
        );
      }

      const data = (await response.json().catch(() => ({}))) as TelegramErrorResponse;

      if (!response.ok || !data.ok) {
        const description = data?.description ?? response.statusText ?? 'Unknown error';
        throw new TelegramDeliveryError(
          `Ошибка Telegram API: ${description}`,
          data,
          response.status,
        );
      }
    });
  }

  private async executeWithRetry(operation: () => Promise<void>): Promise<void> {
    const { retryAttempts, retryInitialDelay, retryBackoffFactor, retryMaxDelay } = this.options;
    let attempt = 0;
    let delay = retryInitialDelay;

    while (attempt < retryAttempts) {
      try {
        await operation();
        return;
      } catch (error) {
        attempt += 1;
        if (!this.isRetryable(error) || attempt >= retryAttempts) {
          throw error;
        }

        const waitTime = this.resolveRetryDelay(error, delay);
        await sleep(waitTime);
        const multiplied = delay * retryBackoffFactor;
        const nextBase = Math.max(multiplied, waitTime, retryInitialDelay);
        delay = Math.min(nextBase, retryMaxDelay);
      }
    }
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof TelegramDeliveryError) {
      const code = this.resolveStatusCode(error);
      if (code === 429) {
        return true;
      }
      if (code !== undefined) {
        return code >= 500 && code < 600;
      }
      // Код отсутствует — вероятно, сетевая ошибка. Пробуем ещё раз.
      return true;
    }
    return false;
  }

  private resolveRetryDelay(error: unknown, fallback: number): number {
    if (error instanceof TelegramDeliveryError) {
      const retryAfter = this.extractRetryAfter(error);
      if (retryAfter !== undefined) {
        return Math.max(fallback, retryAfter);
      }
    }
    return Math.max(0, fallback);
  }

  private resolveStatusCode(error: TelegramDeliveryError): number | undefined {
    if (typeof error.status === 'number') {
      return error.status;
    }
    const code = error.response?.error_code;
    return typeof code === 'number' ? code : undefined;
  }

  private extractRetryAfter(error: TelegramDeliveryError): number | undefined {
    const parameters = error.response?.parameters as { retry_after?: number | string } | undefined;
    const candidate = parameters?.retry_after;
    if (candidate === undefined) {
      return undefined;
    }
    const numeric = typeof candidate === 'number' ? candidate : Number(candidate);
    if (Number.isNaN(numeric) || numeric < 0) {
      return undefined;
    }
    return Math.round(numeric * 1000);
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
