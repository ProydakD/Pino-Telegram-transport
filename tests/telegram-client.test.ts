import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramClient, TelegramDeliveryError } from '../src/telegram-client';
import { normalizeOptions } from '../src/utils';
import type {
  TelegramDocumentPayload,
  TelegramRequest,
  TelegramTransportOptions,
} from '../src/types';

const TOKEN = '123:ABC';
const originalFetch = globalThis.fetch;

function createClient(custom: Partial<TelegramTransportOptions> = {}): TelegramClient {
  return new TelegramClient(
    normalizeOptions({
      botToken: TOKEN,
      chatId: 111,
      retryAttempts: 1,
      retryInitialDelay: 100,
      retryBackoffFactor: 2,
      retryMaxDelay: 1000,
      requestTimeoutMs: 1000,
      ...custom,
    }),
  );
}

function createTelegramResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function createTimeoutResponse(init?: Parameters<typeof fetch>[1]): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const abort = () => {
      reject(createAbortError());
    };

    if (init?.signal?.aborted) {
      abort();
      return;
    }

    init?.signal?.addEventListener('abort', abort, { once: true });
  });
}

describe('TelegramClient', () => {
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('sends JSON payloads for non-binary requests', async () => {
    const fetchMock = vi.fn(async () => createTelegramResponse({ ok: true, result: true }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createClient();
    const request: TelegramRequest = {
      method: 'sendMessage',
      payload: {
        chat_id: 111,
        text: 'Hello, Telegram!',
        parse_mode: 'HTML',
      },
    };

    await client.send(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json' });
    expect(init.body).toBe(JSON.stringify(request.payload));
    expect(init.signal).toBeDefined();
  });

  it('builds multipart body for TelegramInputFile payloads', async () => {
    const fetchMock = vi.fn(async () => createTelegramResponse({ ok: true, result: true }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createClient();
    const request: TelegramRequest = {
      method: 'sendPhoto',
      payload: {
        chat_id: 111,
        caption: 'Photo caption',
        photo: {
          data: Uint8Array.from([1, 2, 3, 4]),
          filename: 'image.png',
          contentType: 'image/png',
        },
      },
    };

    await client.send(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);

    const form = init.body as FormData;
    expect(form.get('chat_id')).toBe('111');
    expect(form.get('caption')).toBe('Photo caption');

    const file = form.get('photo') as Blob & { name?: string };
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('image.png');
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3, 4]);
  });

  it('normalizes serialized Buffer values for binary document uploads', async () => {
    const fetchMock = vi.fn(async () => createTelegramResponse({ ok: true, result: true }));
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createClient();
    const document: TelegramDocumentPayload['document'] = {
      data: Buffer.from('hello world', 'utf8'),
      filename: 'document.bin',
      contentType: 'application/octet-stream',
    };
    const request: TelegramRequest = {
      method: 'sendDocument',
      payload: {
        chat_id: 111,
        caption: 'Document caption',
        document: JSON.parse(JSON.stringify(document)) as TelegramDocumentPayload['document'],
      },
    };

    await client.send(request);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);

    const form = init.body as FormData;
    const documentFile = form.get('document');
    expect(documentFile).toBeInstanceOf(Blob);

    const file = documentFile as Blob & { name?: string };
    expect(file.type).toBe('application/octet-stream');
    expect(file.name).toBe('document.bin');
    expect(Buffer.from(await file.arrayBuffer()).toString('utf8')).toBe('hello world');
  });

  it('retries 429 responses using retry_after hints', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const attempts: number[] = [];
    const fetchMock = vi.fn(async () => {
      attempts.push(Date.now());

      if (attempts.length < 3) {
        return createTelegramResponse(
          {
            ok: false,
            error_code: 429,
            description: 'Too Many Requests',
            parameters: { retry_after: 1 },
          },
          429,
        );
      }

      return createTelegramResponse({ ok: true, result: true });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createClient({
      retryAttempts: 3,
      retryInitialDelay: 100,
      retryBackoffFactor: 2,
      retryMaxDelay: 5000,
    });

    const sendPromise = client.send({
      method: 'sendMessage',
      payload: {
        chat_id: 111,
        text: 'Retry after',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    await sendPromise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(attempts).toHaveLength(3);
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(1000);
    expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(1000);
  });

  it('applies exponential backoff for 5xx responses', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const attempts: number[] = [];
    const fetchMock = vi.fn(async () => {
      attempts.push(Date.now());

      if (attempts.length < 3) {
        return createTelegramResponse(
          {
            ok: false,
            error_code: 500,
            description: 'Server error',
          },
          500,
        );
      }

      return createTelegramResponse({ ok: true, result: true });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createClient({
      retryAttempts: 3,
      retryInitialDelay: 200,
      retryBackoffFactor: 2,
      retryMaxDelay: 1000,
    });

    const sendPromise = client.send({
      method: 'sendMessage',
      payload: {
        chat_id: 111,
        text: 'Backoff',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(400);
    await sendPromise;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(200);
    expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(400);
  });

  it('converts aborted requests into timeout delivery errors', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(
      (_url: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]) =>
        createTimeoutResponse(init),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = createClient({
      requestTimeoutMs: 50,
      retryAttempts: 1,
    });

    const sendPromise = client.send({
      method: 'sendMessage',
      payload: {
        chat_id: 111,
        text: 'Timeout',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const errorPromise = sendPromise.catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(50);
    const error = await errorPromise;

    expect(error).toBeInstanceOf(TelegramDeliveryError);
    expect(error).toMatchObject({
      isTimeout: true,
    });
  });
});
