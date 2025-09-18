import { fetch, FormData } from 'undici';
import { buildTelegramUrl } from './utils';
import {
  NormalizedOptions,
  TelegramInputFile,
  TelegramRequest,
  TelegramSendPayload,
} from './types';

type FetchBody =
  Exclude<Parameters<typeof fetch>[1], undefined> extends { body?: infer T } ? T : never;

interface SerializedBuffer {
  type: 'Buffer';
  data: number[];
}

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
 * либо делегирует отправку пользовательской функции send.
 */
export class TelegramClient {
  constructor(private readonly options: NormalizedOptions) {}

  async send(request: TelegramRequest): Promise<void> {
    await this.executeWithRetry(async () => {
      if (this.options.send) {
        await this.options.send(request.payload, request.method);
        return;
      }

      const url = buildTelegramUrl(this.options.botToken, request.method);
      let response;
      try {
        const { body, headers } = this.prepareRequestBody(request);
        response = await fetch(url, {
          method: 'POST',
          headers,
          body,
        });
      } catch (error) {
        const reason = (error as Error)?.message ?? 'неизвестная ошибка';
        throw new TelegramDeliveryError(
          'Ошибка сети Telegram (' + request.method + '): ' + reason,
          undefined,
          undefined,
          error,
        );
      }

      const data = (await response.json().catch(() => ({}))) as TelegramErrorResponse;

      if (!response.ok || !data.ok) {
        const description = data?.description ?? response.statusText ?? 'Unknown error';
        throw new TelegramDeliveryError(
          'Ошибка Telegram API (' + request.method + '): ' + description,
          data,
          response.status,
        );
      }
    });
  }

  private prepareRequestBody(request: TelegramRequest): {
    body: FetchBody;
    headers?: Record<string, string>;
  } {
    if (this.containsBinary(request.payload)) {
      return { body: this.buildMultipartBody(request.payload) };
    }

    return {
      body: JSON.stringify(request.payload),
      headers: {
        'content-type': 'application/json',
      },
    };
  }

  private buildMultipartBody(payload: TelegramSendPayload): FormData {
    const form = new FormData();

    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) {
        continue;
      }

      if (this.isBinaryField(key, value)) {
        const file = this.normalizeInputFile(value, key === 'photo' ? 'photo' : 'document');
        const filename = file.filename ?? this.defaultFilename(key as 'photo' | 'document');
        const contentType =
          file.contentType ?? this.defaultContentType(key as 'photo' | 'document');
        const binary = this.toUint8Array(file.data);
        const arrayBuffer = this.toArrayBuffer(binary);
        const blob = new Blob([arrayBuffer], { type: contentType });
        form.append(key, blob, filename);
      } else {
        form.append(key, this.serializeFormValue(value));
      }
    }

    return form;
  }

  private serializeFormValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    return JSON.stringify(value);
  }

  private containsBinary(payload: TelegramSendPayload): boolean {
    if ('photo' in payload && this.isInputFileValue(payload.photo)) {
      return true;
    }
    if (
      'document' in payload &&
      this.isInputFileValue((payload as typeof payload & { document?: unknown }).document)
    ) {
      return true;
    }
    return false;
  }

  private isBinaryField(field: string, value: unknown): boolean {
    if (field === 'photo' || field === 'document') {
      return this.isInputFileValue(value);
    }
    return false;
  }

  private isInputFileValue(value: unknown): boolean {
    if (value === undefined || value === null) {
      return false;
    }
    if (typeof value === 'string') {
      return false;
    }
    if (this.isTelegramInputFile(value)) {
      return true;
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return true;
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return true;
    }
    return this.isSerializedBuffer(value);
  }

  private normalizeInputFile(value: unknown, field: 'photo' | 'document'): TelegramInputFile {
    if (this.isTelegramInputFile(value)) {
      return {
        data: this.toUint8Array(value.data),
        filename: value.filename,
        contentType: value.contentType,
      };
    }
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
      return {
        data: this.toUint8Array(value),
      };
    }
    if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
      return {
        data: this.toUint8Array(value),
      };
    }
    if (this.isSerializedBuffer(value)) {
      return {
        data: this.toUint8Array(value),
      };
    }
    throw new Error(`Значение поля ${field} должно быть URL или двоичным содержимым.`);
  }

  private isTelegramInputFile(value: unknown): value is TelegramInputFile {
    return (
      typeof value === 'object' &&
      value !== null &&
      'data' in value &&
      (value as TelegramInputFile).data !== undefined
    );
  }

  private isSerializedBuffer(value: unknown): value is SerializedBuffer {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { type?: unknown }).type === 'Buffer' &&
      Array.isArray((value as { data?: unknown }).data)
    );
  }

  private toArrayBuffer(view: Uint8Array): ArrayBuffer {
    if (view.buffer instanceof ArrayBuffer) {
      if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) {
        return view.buffer;
      }
      return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    }
    return view.slice().buffer;
  }

  private toUint8Array(data: Buffer | Uint8Array | ArrayBuffer | SerializedBuffer): Uint8Array {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
      return new Uint8Array(data);
    }
    if (data instanceof Uint8Array) {
      return data;
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    if (this.isSerializedBuffer(data)) {
      return Uint8Array.from(data.data);
    }
    throw new TypeError('Unsupported binary payload');
  }

  private defaultFilename(field: 'photo' | 'document'): string {
    return field === 'photo' ? 'photo.jpg' : 'document.bin';
  }

  private defaultContentType(field: 'photo' | 'document'): string {
    return field === 'photo' ? 'image/jpeg' : 'application/octet-stream';
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
