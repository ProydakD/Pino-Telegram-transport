import { afterEach, describe, expect, it, vi } from 'vitest';
import telegramTransport, { TelegramDeliveryError, createMediaFormatter } from '../src';
import {
  TelegramDocumentPayload,
  TelegramMessagePayload,
  TelegramMethod,
  TelegramPhotoPayload,
  TelegramSendPayload,
  TelegramInputFile,
  TelegramTransportOptions,
} from '../src/types';

const TOKEN = '123:ABC';

interface RecordedRequest {
  method: TelegramMethod;
  payload: TelegramSendPayload;
}

interface Recorder {
  requests: RecordedRequest[];
  send: (payload: TelegramSendPayload, method: TelegramMethod) => Promise<void>;
  timestamps: number[];
}

function createRecorder(): Recorder {
  const requests: RecordedRequest[] = [];
  const timestamps: number[] = [];
  return {
    requests,
    timestamps,
    async send(payload, method) {
      const clone = (
        typeof structuredClone === 'function'
          ? structuredClone(payload)
          : JSON.parse(JSON.stringify(payload))
      ) as TelegramSendPayload;
      requests.push({ method, payload: clone });
      timestamps.push(Date.now());
    },
  };
}

function createTransport(custom?: Partial<TelegramTransportOptions>, recorder?: Recorder) {
  const rec = recorder ?? createRecorder();
  const stream = telegramTransport({
    botToken: TOKEN,
    chatId: 111,
    send: rec.send,
    ...custom,
  });
  return { stream, recorder: rec };
}

async function flush(ms = 10) {
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.runOnlyPendingTimersAsync();
  } else {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function expectSingleRequest(recorder: Recorder): RecordedRequest {
  expect(recorder.requests).toHaveLength(1);
  return recorder.requests[0];
}

describe('pino-telegram transport', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends log message to Telegram', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport({}, recorder);

    stream.write(`${JSON.stringify({ level: 30, msg: 'Hello', time: 1700000000000 })}\n`);
    stream.end();

    await flush();
    await flush();

    const request = expectSingleRequest(recorder);
    expect(request.method).toBe('sendMessage');
    const payload = request.payload as TelegramMessagePayload;
    expect(payload.chat_id).toBe(111);
    expect(payload.text).toContain('Hello');
    expect(payload.text).toContain('Time:');
  });

  it('includes user context with default heading', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport({}, recorder);

    stream.write(
      `${JSON.stringify({ level: 40, msg: 'Attention', context: { userId: 42 }, time: 1700000000100 })}\n`,
    );
    stream.end();

    await flush();
    await flush();

    const request = expectSingleRequest(recorder);
    expect(request.method).toBe('sendMessage');
    const payload = request.payload as TelegramMessagePayload;
    expect(payload.text).toContain('Context');
    expect(payload.text).toContain('userId');
  });

  it('gracefully disables transport when botToken missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stream = telegramTransport({ chatId: 111 } as unknown as TelegramTransportOptions);
    stream.write(`${JSON.stringify({ level: 30, msg: 'noop' })}\n`);
    stream.end();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('transport disabled'));
    warn.mockRestore();
  });

  it('gracefully disables transport when chat is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const stream = telegramTransport({ botToken: TOKEN } as unknown as TelegramTransportOptions);
    stream.write(`${JSON.stringify({ level: 30, msg: 'noop' })}\n`);
    stream.end();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('transport disabled'));
    warn.mockRestore();
  });

  it('includes extras block when additional fields present', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport({}, recorder);

    stream.write(`${JSON.stringify({ level: 30, msg: 'With extras', foo: 'bar' })}\n`);
    stream.end();

    await flush();
    await flush();

    const payload = expectSingleRequest(recorder).payload as TelegramMessagePayload;
    expect(payload.text).toContain('Extras');
    expect(payload.text).toContain('foo');
  });

  it('allows disabling extras block entirely', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport({ includeExtras: false }, recorder);

    stream.write(`${JSON.stringify({ level: 30, msg: 'No extras', foo: 'bar' })}\n`);
    stream.end();

    await flush();
    await flush();

    const payload = expectSingleRequest(recorder).payload as TelegramMessagePayload;
    expect(payload.text).not.toContain('Extras');
    expect(payload.text).not.toContain('foo');
  });

  it('allows selecting explicit extras keys', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport({ extraKeys: ['foo'] }, recorder);

    stream.write(
      `${JSON.stringify({ level: 30, msg: 'Filtered extras', foo: 'bar', skip: true })}\n`,
    );
    stream.end();

    await flush();
    await flush();

    const payload = expectSingleRequest(recorder).payload as TelegramMessagePayload;
    expect(payload.text).toContain('foo');
    expect(payload.text).not.toContain('skip');
  });

  it('allows overriding default headings', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        headings: {
          context: 'User Data',
          time: 'Timestamp',
        },
      },
      recorder,
    );

    stream.write(
      `${JSON.stringify({ level: 30, msg: 'Custom headings', context: { foo: 'bar' } })}\n`,
    );
    stream.end();

    await flush();
    await flush();

    const payload = expectSingleRequest(recorder).payload as TelegramMessagePayload;
    expect(payload.text).toContain('User Data');
    expect(payload.text).toContain('Timestamp');
    expect(payload.text).not.toContain('Context');
  });

  it('supports sendPhoto via кастомный форматтер', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        formatMessage: async () => ({
          text: 'Фото: ошибка',
          method: 'sendPhoto',
          extra: {
            photo: 'https://example.com/image.png',
          },
        }),
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 50, msg: 'Critical' })}\n`);
    stream.end();

    await flush();
    await flush();

    const request = expectSingleRequest(recorder);
    expect(request.method).toBe('sendPhoto');
    const payload = request.payload as TelegramPhotoPayload;
    expect(payload.photo).toBe('https://example.com/image.png');
    expect(payload.caption).toBe('Фото: ошибка');
    expect(payload.parse_mode).toBe('HTML');
  });

  it('использует createMediaFormatter для выбора метода', async () => {
    const recorder = createRecorder();
    const mediaFormatter = createMediaFormatter();

    const { stream } = createTransport({ formatMessage: mediaFormatter }, recorder);

    stream.write(
      `${JSON.stringify({
        level: 30,
        msg: 'Снимок',
        messageType: 'photo',
        mediaUrl: 'https://example.com/photo.jpg',
      })}\n`,
    );
    stream.write(
      `${JSON.stringify({
        level: 30,
        msg: 'Отчёт',
        messageType: 'document',
        mediaUrl: 'https://example.com/report.pdf',
      })}\n`,
    );
    stream.end();

    await flush();
    await vi.waitFor(() => {
      expect(recorder.requests).toHaveLength(2);
    });

    expect((recorder.requests[0].payload as TelegramPhotoPayload).photo).toBe(
      'https://example.com/photo.jpg',
    );
    expect(recorder.requests[1].method).toBe('sendDocument');
    expect((recorder.requests[1].payload as TelegramDocumentPayload).document).toBe(
      'https://example.com/report.pdf',
    );
  });

  it('обрабатывает mediaBuffer при использовании createMediaFormatter', async () => {
    const recorder = createRecorder();
    const mediaFormatter = createMediaFormatter();

    const { stream } = createTransport({ formatMessage: mediaFormatter }, recorder);

    stream.write(
      `${JSON.stringify({
        level: 30,
        msg: 'Документ из буфера',
        messageType: 'document',
        mediaBuffer: Buffer.from('hello world', 'utf8'),
        mediaFilename: 'report.txt',
        mediaContentType: 'text/plain',
      })}\n`,
    );
    stream.end();

    await flush();
    await vi.waitFor(() => {
      expect(recorder.requests).toHaveLength(1);
    });

    const request = recorder.requests[0];
    expect(request.method).toBe('sendDocument');
    const payload = request.payload as TelegramDocumentPayload;
    expect(payload.document).toMatchObject({
      filename: 'report.txt',
      contentType: 'text/plain',
    });
    const document = payload.document as TelegramInputFile;
    expect(document.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(document.data)).toEqual(Array.from(Buffer.from('hello world', 'utf8')));
  });
  it('использует createMediaFormatter с кастомными ключами', async () => {
    const recorder = createRecorder();
    const mediaFormatter = createMediaFormatter({
      typeKey: 'kind',
      bufferKey: 'attachmentBuffer',
      filenameKey: 'attachmentName',
      contentTypeKey: 'attachmentType',
      captionKey: 'note',
      captionMaxLength: 10,
    });

    const { stream } = createTransport({ formatMessage: mediaFormatter }, recorder);

    stream.write(
      `${JSON.stringify({
        level: 30,
        msg: 'Снимок из буфера',
        kind: 'photo',
        attachmentBuffer: Buffer.from('sample image data'),
        attachmentName: 'custom.png',
        attachmentType: 'image/png',
        note: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      })}\n`,
    );
    stream.end();

    await flush();
    await vi.waitFor(() => {
      expect(recorder.requests).toHaveLength(1);
    });

    const request = recorder.requests[0];
    expect(request.method).toBe('sendPhoto');
    const payload = request.payload as TelegramPhotoPayload;
    expect(payload.photo).toMatchObject({
      filename: 'custom.png',
      contentType: 'image/png',
    });
    const photo = payload.photo as TelegramInputFile;
    expect(photo.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(photo.data)).toEqual(Array.from(Buffer.from('sample image data')));
    expect(payload.caption).toBe('ABCDEFG...');
    expect(payload.caption).toHaveLength(10);
    expect(recorder.requests[0].method).toBe('sendPhoto');
  });
  it('supports sendDocument и переопределение caption', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        formatMessage: async () => ({
          text: 'Будет заменено',
          method: 'sendDocument',
          extra: {
            document: 'https://example.com/report.json',
            caption: 'Отчёт по инциденту',
          },
        }),
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Doc' })}\n`);
    stream.end();

    await flush();
    await flush();

    const request = expectSingleRequest(recorder);
    expect(request.method).toBe('sendDocument');
    const payload = request.payload as TelegramDocumentPayload;
    expect(payload.document).toBe('https://example.com/report.json');
    expect(payload.caption).toBe('Отчёт по инциденту');
  });

  it('передаёт метод в onDeliveryError при ошибке форматтера', async () => {
    const onDeliveryError = vi.fn();
    const { stream } = createTransport({
      formatMessage: async () => ({
        text: 'Фото без ссылки',
        method: 'sendPhoto',
      }),
      onDeliveryError,
    });

    stream.write(`${JSON.stringify({ level: 40, msg: 'Warn' })}\n`);
    stream.end();

    await flush(100);
    await vi.waitFor(() => {
      expect(onDeliveryError).toHaveBeenCalledTimes(1);
    });
    const [, payload, method] = onDeliveryError.mock.calls[0];
    expect(payload).toBeUndefined();
    expect(method).toBeUndefined();
    expect(onDeliveryError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('передаёт метод в onDeliveryError при ошибке доставки', async () => {
    const recorder = createRecorder();
    const originalSend = recorder.send;
    const onDeliveryError = vi.fn();

    recorder.send = vi.fn(async (payload, method) => {
      await originalSend(payload, method);
      throw new TelegramDeliveryError('Fail', { ok: false, error_code: 500 }, 500);
    });

    const { stream } = createTransport(
      {
        formatMessage: async () => ({
          text: 'Фото с ошибкой доставки',
          method: 'sendPhoto',
          extra: {
            photo: 'https://example.com/fail.png',
          },
        }),
        onDeliveryError,
        retryAttempts: 1,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 50, msg: 'Failing photo' })}\n`);
    stream.end();

    await flush(100);
    await vi.waitFor(() => {
      expect(onDeliveryError).toHaveBeenCalledTimes(1);
    });
    expect(recorder.send).toHaveBeenCalledTimes(1);
    const [, payload, method] = onDeliveryError.mock.calls[0];
    expect(method).toBe('sendPhoto');
    expect((payload as TelegramPhotoPayload).photo).toBe('https://example.com/fail.png');
  });
  it('broadcasts message to multiple chats and threads', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        chatId: ['chat_A', { chatId: -222, threadId: 77 }],
        send: recorder.send,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Multi target' })}\n`);
    stream.end();

    await flush();
    await flush();

    expect(recorder.requests).toHaveLength(2);
    const [first, second] = recorder.requests;
    expect(first.method).toBe('sendMessage');
    expect((first.payload as TelegramMessagePayload).chat_id).toBe('chat_A');
    expect(second.method).toBe('sendMessage');
    const secondPayload = second.payload as TelegramMessagePayload;
    expect(secondPayload.chat_id).toBe(-222);
    expect(secondPayload.message_thread_id).toBe(77);
  });

  it('enforces minimal delay between messages', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        minDelayBetweenMessages: 200,
        send: recorder.send,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'First' })}\n`);
    stream.write(`${JSON.stringify({ level: 30, msg: 'Second' })}\n`);

    await vi.advanceTimersByTimeAsync(200);
    await flush();
    await flush();
    vi.useRealTimers();
    stream.end();
    await flush();
    await flush();

    expect(recorder.requests).toHaveLength(2);
    expect(recorder.timestamps[1] - recorder.timestamps[0]).toBeGreaterThanOrEqual(200);
  });

  it('retries on 429 responses with retry_after hint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const recorder = createRecorder();
    const originalSend = recorder.send;
    const attempts: number[] = [];

    recorder.send = vi.fn(async (payload, method) => {
      attempts.push(Date.now());
      if (attempts.length < 3) {
        throw new TelegramDeliveryError(
          'Too many requests',
          { ok: false, error_code: 429, parameters: { retry_after: 1 } },
          429,
        );
      }
      await originalSend(payload, method);
    });

    const { stream } = createTransport(
      {
        minDelayBetweenMessages: 0,
        retryAttempts: 3,
        retryInitialDelay: 200,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Retry me' })}\n`);
    stream.end();

    await flush();
    await flush();
    expect(attempts.length).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runOnlyPendingTimersAsync();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runOnlyPendingTimersAsync();

    await flush();
    await flush();

    expect(recorder.send).toHaveBeenCalledTimes(3);
    expect(recorder.requests).toHaveLength(1);
    expect(attempts).toHaveLength(3);
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(1000);
    expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(1000);
  });

  it('applies exponential backoff for server errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const recorder = createRecorder();
    const originalSend = recorder.send;
    const attempts: number[] = [];

    recorder.send = vi.fn(async (payload, method) => {
      attempts.push(Date.now());
      if (attempts.length < 3) {
        throw new TelegramDeliveryError('Server error', { ok: false, error_code: 500 }, 500);
      }
      await originalSend(payload, method);
    });

    const { stream } = createTransport(
      {
        minDelayBetweenMessages: 0,
        retryAttempts: 3,
        retryInitialDelay: 200,
        retryBackoffFactor: 2,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Backoff' })}\n`);
    stream.end();

    await flush();
    await flush();
    expect(attempts.length).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(200);
    await vi.runOnlyPendingTimersAsync();

    await vi.advanceTimersByTimeAsync(400);
    await vi.runOnlyPendingTimersAsync();

    await flush();
    await flush();

    expect(recorder.send).toHaveBeenCalledTimes(3);
    expect(recorder.requests).toHaveLength(1);
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(200);
    expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(400);
  });

  it('does not retry non-retryable errors', async () => {
    const recorder: Recorder = {
      requests: [],
      timestamps: [],
      send: vi.fn(async () => {
        throw new TelegramDeliveryError('Bad request', { ok: false, error_code: 400 }, 400);
      }),
    };
    const onDeliveryError = vi.fn();

    const { stream } = createTransport(
      {
        onDeliveryError,
        retryAttempts: 3,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Fail fast' })}\n`);
    stream.end();

    await flush();
    await flush();

    expect(recorder.send).toHaveBeenCalledTimes(1);
    expect(onDeliveryError).toHaveBeenCalledTimes(1);
    expect(onDeliveryError.mock.calls[0][0]).toBeInstanceOf(TelegramDeliveryError);
    const [, payload, method] = onDeliveryError.mock.calls[0];
    expect(method).toBe('sendMessage');
    expect((payload as TelegramMessagePayload).text).toContain('Fail fast');
  });
});
