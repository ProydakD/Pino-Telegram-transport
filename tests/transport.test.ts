import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
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
const originalFetch = globalThis.fetch;

interface RecordedRequest {
  method: TelegramMethod;
  payload: TelegramSendPayload;
}

interface Recorder {
  requests: RecordedRequest[];
  send: (payload: TelegramSendPayload, method: TelegramMethod) => Promise<void>;
  timestamps: number[];
}

interface FlushableLogger {
  flush: (callback?: (error?: Error) => void) => void;
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

function createControlledSend(recorder: Recorder) {
  const pendingSends: Array<() => Promise<void>> = [];
  const send = vi.fn(
    (payload: TelegramSendPayload, method: TelegramMethod) =>
      new Promise<void>((resolve) => {
        pendingSends.push(async () => {
          await recorder.send(payload, method);
          resolve();
        });
      }),
  );

  return {
    send,
    async releaseNext(): Promise<void> {
      const nextSend = pendingSends.shift();
      await nextSend?.();
    },
  };
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

async function flush(ms = 10) {
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(ms);
    await vi.runOnlyPendingTimersAsync();
  } else {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

async function flushMicrotasks(iterations = 5): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

async function flushLogger(logger: FlushableLogger): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    logger.flush((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function expectSingleRequest(recorder: Recorder): RecordedRequest {
  expect(recorder.requests).toHaveLength(1);
  return recorder.requests[0];
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, '');
}

describe('pino-telegram transport', () => {
  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
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

  it('skips logs below configured minLevel', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport({ minLevel: 'error' }, recorder);

    stream.write(`${JSON.stringify({ level: 30, msg: 'Too low' })}\n`);
    stream.write(`${JSON.stringify({ level: 50, msg: 'Escalated' })}\n`);
    stream.end();

    await flush();
    await flush();

    expect(recorder.requests).toHaveLength(1);
    const payload = recorder.requests[0].payload as TelegramMessagePayload;
    expect(payload.text).toContain('Escalated');
  });

  it('routes logs to targets with string minLevel thresholds', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        minDelayBetweenMessages: 0,
        chatId: [
          { chatId: 'info-chat' },
          { chatId: 'warn-chat', minLevel: 'warn' },
          { chatId: 'error-chat', minLevel: 'error' },
        ],
        send: recorder.send,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Info routed' })}\n`);
    stream.write(`${JSON.stringify({ level: 50, msg: 'Error routed' })}\n`);
    stream.end();

    await flush();
    await flush();

    const delivered = recorder.requests.map((request) => ({
      chatId: (request.payload as TelegramMessagePayload).chat_id,
      text: stripHtmlTags((request.payload as TelegramMessagePayload).text),
    }));

    expect(delivered).toEqual([
      expect.objectContaining({
        chatId: 'info-chat',
        text: expect.stringContaining('Info routed'),
      }),
      expect.objectContaining({
        chatId: 'info-chat',
        text: expect.stringContaining('Error routed'),
      }),
      expect.objectContaining({
        chatId: 'warn-chat',
        text: expect.stringContaining('Error routed'),
      }),
      expect.objectContaining({
        chatId: 'error-chat',
        text: expect.stringContaining('Error routed'),
      }),
    ]);
  });

  it('supports numeric minLevel thresholds per target', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        minDelayBetweenMessages: 0,
        chatId: [{ chatId: 'all-chat' }, { chatId: 'warn-chat', minLevel: 40 }],
        send: recorder.send,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Info only' })}\n`);
    stream.write(`${JSON.stringify({ level: 40, msg: 'Warn fanout' })}\n`);
    stream.end();

    await flush();
    await flush();

    const delivered = recorder.requests.map((request) => ({
      chatId: (request.payload as TelegramMessagePayload).chat_id,
      text: stripHtmlTags((request.payload as TelegramMessagePayload).text),
    }));

    expect(delivered).toEqual([
      expect.objectContaining({
        chatId: 'all-chat',
        text: expect.stringContaining('Info only'),
      }),
      expect.objectContaining({
        chatId: 'all-chat',
        text: expect.stringContaining('Warn fanout'),
      }),
      expect.objectContaining({
        chatId: 'warn-chat',
        text: expect.stringContaining('Warn fanout'),
      }),
    ]);
  });

  it('keeps global minLevel as a baseline for per-target routing', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        minLevel: 'warn',
        minDelayBetweenMessages: 0,
        chatId: [{ chatId: 'warn-chat' }, { chatId: 'error-chat', minLevel: 'error' }],
        send: recorder.send,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Ignored info' })}\n`);
    stream.write(`${JSON.stringify({ level: 40, msg: 'Warn routed' })}\n`);
    stream.write(`${JSON.stringify({ level: 50, msg: 'Error routed' })}\n`);
    stream.end();

    await flush();
    await flush();

    const delivered = recorder.requests.map((request) => ({
      chatId: (request.payload as TelegramMessagePayload).chat_id,
      text: stripHtmlTags((request.payload as TelegramMessagePayload).text),
    }));

    expect(delivered).toEqual([
      expect.objectContaining({
        chatId: 'warn-chat',
        text: expect.stringContaining('Warn routed'),
      }),
      expect.objectContaining({
        chatId: 'warn-chat',
        text: expect.stringContaining('Error routed'),
      }),
      expect.objectContaining({
        chatId: 'error-chat',
        text: expect.stringContaining('Error routed'),
      }),
    ]);
  });

  it('renders compact preset with compact context, error, and extras blocks', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport({ formatPreset: 'compact' }, recorder);

    stream.write(
      `${JSON.stringify({
        level: 50,
        msg: 'Compact event',
        time: 1700000000000,
        context: { requestId: 'req-1' },
        err: { message: 'Boom', stack: 'stack trace' },
        foo: 'bar',
      })}\n`,
    );
    stream.end();

    await flush();
    await flush();

    const payload = expectSingleRequest(recorder).payload as TelegramMessagePayload;
    const text = payload.text;

    expect(stripHtmlTags(text)).toContain('ERROR 2023-11-14T22:13:20.000Z Compact event');
    expect(text).not.toContain('<b>Time:</b>');
    expect(text).toContain('<pre>Context={&quot;requestId&quot;:&quot;req-1&quot;}</pre>');
    expect(text).toContain(
      '<pre>Error={&quot;message&quot;:&quot;Boom&quot;,&quot;stack&quot;:&quot;stack trace&quot;}</pre>',
    );
    expect(text).toContain('<pre>Extras={&quot;foo&quot;:&quot;bar&quot;}</pre>');
  });

  it('truncates compact preset output when splitLongMessages disabled', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        formatPreset: 'compact',
        maxMessageLength: 160,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'A'.repeat(600) })}\n`);
    stream.end();

    await flush();
    await flush();

    const payload = expectSingleRequest(recorder).payload as TelegramMessagePayload;
    expect(payload.text).not.toContain('<b>Time:</b>');
    expect(payload.text).toContain('Сообщение обрезано из-за ограничения Telegram');
  });

  it('splits long compact preset messages without truncation notice', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        formatPreset: 'compact',
        splitLongMessages: true,
        minDelayBetweenMessages: 0,
        maxMessageLength: 180,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Compact split '.repeat(120) })}\n`);
    stream.end();

    await flush();
    await flush();

    expect(recorder.requests.length).toBeGreaterThan(1);
    for (const request of recorder.requests) {
      const payload = request.payload as TelegramMessagePayload;
      expect(payload.text).not.toContain('<b>Time:</b>');
      expect(payload.text).not.toContain('Сообщение обрезано из-за ограничения Telegram');
    }
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

  it('throws on missing botToken when failOnInitError enabled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() =>
      telegramTransport({
        chatId: 111,
        failOnInitError: true,
      } as unknown as TelegramTransportOptions),
    ).toThrow('botToken');

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws on missing chat when failOnInitError enabled', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() =>
      telegramTransport({
        botToken: TOKEN,
        failOnInitError: true,
      } as unknown as TelegramTransportOptions),
    ).toThrow('целевого чата');

    expect(warn).not.toHaveBeenCalled();
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

  it('redacts default sensitive keys in context and extras without mutating the source log', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport({}, recorder);
    const log = {
      level: 30,
      msg: 'Header token=visible',
      context: {
        token: 'ctx-token',
        nested: {
          password: 'ctx-password',
          keep: 'context-visible',
        },
        list: [{ authorization: 'Bearer ctx-secret' }],
      },
      apiKey: 'extra-api-key',
      metadata: {
        cookie: 'session-cookie',
        keep: true,
      },
    };
    const originalLog = structuredClone(log);

    stream.write(`${JSON.stringify(log)}\n`);
    stream.end();

    await flush();
    await flush();

    const payload = expectSingleRequest(recorder).payload as TelegramMessagePayload;
    expect(payload.text).toContain('Header token=visible');
    expect(payload.text).toContain('&quot;token&quot;: &quot;[REDACTED]&quot;');
    expect(payload.text).toContain('&quot;password&quot;: &quot;[REDACTED]&quot;');
    expect(payload.text).toContain('&quot;authorization&quot;: &quot;[REDACTED]&quot;');
    expect(payload.text).toContain('&quot;apiKey&quot;: &quot;[REDACTED]&quot;');
    expect(payload.text).toContain('&quot;cookie&quot;: &quot;[REDACTED]&quot;');
    expect(payload.text).toContain('&quot;keep&quot;: &quot;context-visible&quot;');
    expect(payload.text).toContain('&quot;keep&quot;: true');
    expect(log).toEqual(originalLog);
  });

  it('uses custom redactKeys for context, error, and extras', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        redactKeys: ['sessionId', 'message'],
      },
      recorder,
    );
    const log = {
      level: 50,
      msg: 'Custom redact config',
      context: {
        token: 'ctx-token',
        sessionId: 'ctx-session',
      },
      err: {
        message: 'error message should be hidden',
        stack: 'stack trace should stay visible',
      },
      sessionId: 'extra-session',
    };

    stream.write(`${JSON.stringify(log)}\n`);
    stream.end();

    await flush();
    await flush();

    const payload = expectSingleRequest(recorder).payload as TelegramMessagePayload;
    expect(payload.text).toContain('&quot;token&quot;: &quot;ctx-token&quot;');
    expect(payload.text).toContain('&quot;sessionId&quot;: &quot;[REDACTED]&quot;');
    expect(payload.text).toContain('&quot;message&quot;: &quot;[REDACTED]&quot;');
    expect(payload.text).toContain(
      '&quot;stack&quot;: &quot;stack trace should stay visible&quot;',
    );
    expect(log.context.sessionId).toBe('ctx-session');
    expect(log.err.message).toBe('error message should be hidden');
  });

  it('allows disabling default redaction with an empty redactKeys list', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        redactKeys: [],
      },
      recorder,
    );

    stream.write(
      `${JSON.stringify({
        level: 30,
        msg: 'No redaction',
        context: { token: 'ctx-token' },
        apiKey: 'extra-api-key',
      })}\n`,
    );
    stream.end();

    await flush();
    await flush();

    const payload = expectSingleRequest(recorder).payload as TelegramMessagePayload;
    expect(payload.text).toContain('&quot;token&quot;: &quot;ctx-token&quot;');
    expect(payload.text).toContain('&quot;apiKey&quot;: &quot;extra-api-key&quot;');
    expect(payload.text).not.toContain('[REDACTED]');
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

  it('truncates default HTML output without breaking entities, pre blocks, or notice markup', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        maxMessageLength: 220,
      },
      recorder,
    );

    stream.write(
      `${JSON.stringify({
        level: 30,
        msg: 'Header <tag>\nSecond line',
        context: {
          payload:
            'line 1\n' +
            'line 2 with <escaped> content\n' +
            'line 3 with <escaped> content\n' +
            'line 4 with <escaped> content\n' +
            'line 5 with <escaped> content',
        },
        time: 1700000000000,
      })}\n`,
    );
    stream.end();

    await flush();
    await flush();

    const payload = expectSingleRequest(recorder).payload as TelegramMessagePayload;
    expect(payload.text.length).toBeLessThanOrEqual(220);
    expect(payload.text).toContain('Header &lt;tag&gt;\nSecond line');
    expect(payload.text).toContain('<pre>');
    expect(payload.text).toContain('</pre>');
    expect(payload.text).toContain('<b>Сообщение обрезано из-за ограничения Telegram</b>');
    expect(payload.text).not.toContain('&lt...');
    expect(payload.text).not.toContain('<pr...');
    expect(payload.text).not.toContain('</b...</pre>');
  });

  it('splits a long text message into ordered HTML-safe parts when splitLongMessages enabled', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        splitLongMessages: true,
        maxMessageLength: 18,
        formatMessage: async () => ({
          text: '<b>ABCDEFGHIJKLMNOPQRSTUVWXYZ</b>',
        }),
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Split me' })}\n`);
    stream.end();

    await flush();
    await vi.waitFor(() => {
      expect(recorder.requests).toHaveLength(3);
    });

    const parts = recorder.requests.map(
      (request) => (request.payload as TelegramMessagePayload).text,
    );
    expect(parts).toEqual(['<b>ABCDEFGHIJK</b>', '<b>LMNOPQRSTUV</b>', '<b>WXYZ</b>']);
    expect(parts.every((part) => part.length <= 18)).toBe(true);
    expect(parts.join('')).not.toContain('...');
    expect(parts.map(stripHtmlTags).join('')).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
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
    const documentData =
      document.data instanceof Uint8Array ? document.data : new Uint8Array(document.data);
    expect(Array.from(documentData)).toEqual(Array.from(Buffer.from('hello world', 'utf8')));
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
    const photoData = photo.data instanceof Uint8Array ? photo.data : new Uint8Array(photo.data);
    expect(Array.from(photoData)).toEqual(Array.from(Buffer.from('sample image data')));
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

  it('accepts threadId passed as a string (options and per-target)', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        // threadId provided as string in options
        threadId: '555' as unknown as number,
        // mix target forms, second with its own string threadId overriding default
        chatId: [12345, { chatId: -999, threadId: '777' as unknown as number }],
        send: recorder.send,
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'String threadIds' })}\n`);
    stream.end();

    await flush();
    await flush();

    expect(recorder.requests).toHaveLength(2);
    const [first, second] = recorder.requests;
    const p1 = first.payload as TelegramMessagePayload;
    const p2 = second.payload as TelegramMessagePayload;
    expect(p1.chat_id).toBe(12345);
    expect(p1.message_thread_id).toBe(555);
    expect(p2.chat_id).toBe(-999);
    expect(p2.message_thread_id).toBe(777);
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

  it('applies rate limit between split message parts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        splitLongMessages: true,
        maxMessageLength: 18,
        minDelayBetweenMessages: 200,
        formatMessage: async () => ({
          text: '<b>ABCDEFGHIJKLMNOPQRSTUVWXYZ</b>',
        }),
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Split with delay' })}\n`);
    stream.end();

    await vi.advanceTimersByTimeAsync(400);
    await flush();
    await flush();
    vi.useRealTimers();

    expect(recorder.requests).toHaveLength(3);
    expect(recorder.timestamps[1] - recorder.timestamps[0]).toBeGreaterThanOrEqual(200);
    expect(recorder.timestamps[2] - recorder.timestamps[1]).toBeGreaterThanOrEqual(200);
  });

  it('does not split media captions when splitLongMessages enabled', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport(
      {
        splitLongMessages: true,
        maxMessageLength: 25,
        formatMessage: async () => ({
          text: '<b>ABCDEFGHIJKLMNOPQRSTUVWXYZ</b>',
          method: 'sendPhoto',
          extra: {
            photo: 'https://example.com/image.png',
          },
        }),
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'Photo caption' })}\n`);
    stream.end();

    await flush();
    await flush();

    const request = expectSingleRequest(recorder);
    expect(request.method).toBe('sendPhoto');
    const payload = request.payload as TelegramPhotoPayload;
    expect(payload.caption).toContain('...');
    expect(payload.caption?.length).toBeLessThanOrEqual(25);
  });

  it('drops the oldest queued log when overflowStrategy=dropOldest', async () => {
    const recorder = createRecorder();
    const controlledSend = createControlledSend(recorder);
    const onDeliveryError = vi.fn();
    const { stream } = createTransport(
      {
        send: controlledSend.send,
        onDeliveryError,
        minDelayBetweenMessages: 0,
        maxQueueSize: 1,
        overflowStrategy: 'dropOldest',
      },
      recorder,
    );

    stream.write(
      [
        JSON.stringify({ level: 30, msg: 'First queued' }),
        JSON.stringify({ level: 30, msg: 'Second queued' }),
        JSON.stringify({ level: 30, msg: 'Third queued' }),
      ].join('\n') + '\n',
    );
    stream.end();

    await vi.waitFor(() => {
      expect(controlledSend.send).toHaveBeenCalledTimes(1);
      expect(onDeliveryError).toHaveBeenCalledTimes(1);
    });

    expect(onDeliveryError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((onDeliveryError.mock.calls[0][0] as Error).message).toContain(
      'overflowStrategy=dropOldest',
    );

    await controlledSend.releaseNext();
    await vi.waitFor(() => {
      expect(controlledSend.send).toHaveBeenCalledTimes(2);
    });
    await controlledSend.releaseNext();
    await flush();

    expect(recorder.requests).toHaveLength(2);
    const deliveredTexts = recorder.requests.map(
      (request) => (request.payload as TelegramMessagePayload).text,
    );
    expect(deliveredTexts[0]).toContain('First queued');
    expect(deliveredTexts[1]).toContain('Third queued');
    expect(deliveredTexts.join('\n')).not.toContain('Second queued');
  });

  it('drops the newest log when overflowStrategy=dropNewest', async () => {
    const recorder = createRecorder();
    const controlledSend = createControlledSend(recorder);
    const onDeliveryError = vi.fn();
    const { stream } = createTransport(
      {
        send: controlledSend.send,
        onDeliveryError,
        minDelayBetweenMessages: 0,
        maxQueueSize: 1,
        overflowStrategy: 'dropNewest',
      },
      recorder,
    );

    stream.write(
      [
        JSON.stringify({ level: 30, msg: 'First queued' }),
        JSON.stringify({ level: 30, msg: 'Second queued' }),
        JSON.stringify({ level: 30, msg: 'Third queued' }),
      ].join('\n') + '\n',
    );
    stream.end();

    await vi.waitFor(() => {
      expect(controlledSend.send).toHaveBeenCalledTimes(1);
      expect(onDeliveryError).toHaveBeenCalledTimes(1);
    });

    expect((onDeliveryError.mock.calls[0][0] as Error).message).toContain(
      'overflowStrategy=dropNewest',
    );

    await controlledSend.releaseNext();
    await vi.waitFor(() => {
      expect(controlledSend.send).toHaveBeenCalledTimes(2);
    });
    await controlledSend.releaseNext();
    await flush();

    expect(recorder.requests).toHaveLength(2);
    const deliveredTexts = recorder.requests.map(
      (request) => (request.payload as TelegramMessagePayload).text,
    );
    expect(deliveredTexts[0]).toContain('First queued');
    expect(deliveredTexts[1]).toContain('Second queued');
    expect(deliveredTexts.join('\n')).not.toContain('Third queued');
  });

  it('waits for free queue space when overflowStrategy=block', async () => {
    const recorder = createRecorder();
    const controlledSend = createControlledSend(recorder);
    const onDeliveryError = vi.fn();
    const { stream } = createTransport(
      {
        send: controlledSend.send,
        onDeliveryError,
        minDelayBetweenMessages: 0,
        maxQueueSize: 1,
        overflowStrategy: 'block',
      },
      recorder,
    );

    stream.write(`${JSON.stringify({ level: 30, msg: 'First queued' })}\n`);
    stream.write(`${JSON.stringify({ level: 30, msg: 'Second queued' })}\n`);
    stream.write(`${JSON.stringify({ level: 30, msg: 'Third queued' })}\n`);
    stream.end();

    await vi.waitFor(() => {
      expect(controlledSend.send).toHaveBeenCalledTimes(1);
    });

    await controlledSend.releaseNext();
    await vi.waitFor(() => {
      expect(controlledSend.send).toHaveBeenCalledTimes(2);
    });
    expect(controlledSend.send).not.toHaveBeenCalledTimes(3);

    await controlledSend.releaseNext();
    await vi.waitFor(() => {
      expect(controlledSend.send).toHaveBeenCalledTimes(3);
    });
    await controlledSend.releaseNext();
    await flush();

    expect(onDeliveryError).not.toHaveBeenCalled();
    expect(recorder.requests).toHaveLength(3);
    const deliveredTexts = recorder.requests.map(
      (request) => (request.payload as TelegramMessagePayload).text,
    );
    expect(deliveredTexts[0]).toContain('First queued');
    expect(deliveredTexts[1]).toContain('Second queued');
    expect(deliveredTexts[2]).toContain('Third queued');
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

  it('прерывает запрос по requestTimeoutMs и передаёт timeout в onDeliveryError', async () => {
    vi.useFakeTimers();

    const onDeliveryError = vi.fn();
    const fetchMock = vi.fn((_input: Parameters<typeof fetch>[0], init) =>
      createTimeoutResponse(init),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const { stream } = createTransport({
      send: undefined,
      onDeliveryError,
      minDelayBetweenMessages: 0,
      requestTimeoutMs: 50,
      retryAttempts: 1,
    });

    stream.write(`${JSON.stringify({ level: 30, msg: 'Timeout once' })}\n`);
    stream.end();

    await flush();
    await vi.advanceTimersByTimeAsync(50);
    await vi.runOnlyPendingTimersAsync();
    await flush();

    await vi.waitFor(() => {
      expect(onDeliveryError).toHaveBeenCalledTimes(1);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onDeliveryError.mock.calls[0][0]).toBeInstanceOf(TelegramDeliveryError);
    expect((onDeliveryError.mock.calls[0][0] as TelegramDeliveryError).message).toContain(
      'Таймаут запроса к Telegram (sendMessage) после 50 мс',
    );
  });

  it('повторяет запрос после timeout встроенного клиента', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const attempts: number[] = [];
    const onDeliveryError = vi.fn();
    const fetchMock = vi.fn((_input: Parameters<typeof fetch>[0], init) => {
      attempts.push(Date.now());
      if (attempts.length < 3) {
        return createTimeoutResponse(init);
      }
      return Promise.resolve(createTelegramResponse({ ok: true, result: true }));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const { stream } = createTransport({
      send: undefined,
      onDeliveryError,
      minDelayBetweenMessages: 0,
      requestTimeoutMs: 50,
      retryAttempts: 3,
      retryInitialDelay: 100,
      retryBackoffFactor: 1,
      retryMaxDelay: 100,
    });

    stream.write(`${JSON.stringify({ level: 30, msg: 'Retry after timeout' })}\n`);
    stream.end();

    await flush();
    await vi.advanceTimersByTimeAsync(500);
    await vi.runOnlyPendingTimersAsync();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onDeliveryError).not.toHaveBeenCalled();
    expect(attempts).toHaveLength(3);
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(150);
    expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(150);
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

  it('flush дожидается отправки одного сообщения в direct-stream', async () => {
    let releaseSend: (() => void) | undefined;
    const recorder = createRecorder();
    const send = vi.fn(
      (payload: TelegramSendPayload, method: TelegramMethod) =>
        new Promise<void>((resolve) => {
          releaseSend = async () => {
            await recorder.send(payload, method);
            resolve();
          };
        }),
    );
    const stream = telegramTransport({
      botToken: TOKEN,
      chatId: 111,
      send,
    });
    const logger = pino({}, stream);

    logger.info('Flush one');

    let flushed = false;
    const flushPromise = flushLogger(logger).then(() => {
      flushed = true;
    });

    await flushMicrotasks();
    expect(flushed).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);

    await releaseSend?.();
    await flushPromise;

    expect(flushed).toBe(true);
    expect(recorder.requests).toHaveLength(1);
    stream.end();
  });

  it('flush дожидается нескольких сообщений в direct-stream', async () => {
    const pendingSends: Array<() => Promise<void>> = [];
    const recorder = createRecorder();
    const send = vi.fn(
      (payload: TelegramSendPayload, method: TelegramMethod) =>
        new Promise<void>((resolve) => {
          pendingSends.push(async () => {
            await recorder.send(payload, method);
            resolve();
          });
        }),
    );
    const stream = telegramTransport({
      botToken: TOKEN,
      chatId: 111,
      send,
    });
    const logger = pino({}, stream);

    logger.info('Flush first');
    logger.info('Flush second');

    let flushed = false;
    const flushPromise = flushLogger(logger).then(() => {
      flushed = true;
    });

    await flushMicrotasks();
    expect(flushed).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);

    await pendingSends.shift()?.();
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2);
    });

    expect(flushed).toBe(false);
    expect(send).toHaveBeenCalledTimes(2);

    await pendingSends.shift()?.();
    await flushPromise;

    expect(flushed).toBe(true);
    expect(recorder.requests).toHaveLength(2);
    stream.end();
  });

  it('flush дожидается обработки ошибки доставки в direct-stream', async () => {
    let rejectSend: ((error: Error) => void) | undefined;
    const onDeliveryError = vi.fn();
    const send = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    const stream = telegramTransport({
      botToken: TOKEN,
      chatId: 111,
      onDeliveryError,
      retryAttempts: 1,
      send,
    });
    const logger = pino({}, stream);

    logger.info('Flush error');

    let flushed = false;
    const flushPromise = flushLogger(logger).then(() => {
      flushed = true;
    });

    await flushMicrotasks();
    expect(flushed).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);

    rejectSend?.(new TelegramDeliveryError('Delivery failed', { ok: false, error_code: 400 }, 400));
    await flushPromise;

    expect(flushed).toBe(true);
    expect(onDeliveryError).toHaveBeenCalledTimes(1);
    stream.end();
  });

  it('flush дожидается retry-сценария в direct-stream', async () => {
    const recorder = createRecorder();
    const originalSend = recorder.send;
    let attempts = 0;

    const stream = telegramTransport({
      botToken: TOKEN,
      chatId: 111,
      minDelayBetweenMessages: 0,
      retryAttempts: 3,
      retryInitialDelay: 20,
      retryBackoffFactor: 2,
      send: vi.fn(async (payload, method) => {
        attempts += 1;
        if (attempts < 3) {
          throw new TelegramDeliveryError('Retry later', { ok: false, error_code: 500 }, 500);
        }
        await originalSend(payload, method);
      }),
    });
    const logger = pino({}, stream);

    logger.info('Flush retry');

    let flushed = false;
    const flushPromise = flushLogger(logger).then(() => {
      flushed = true;
    });

    await flushMicrotasks();
    expect(attempts).toBe(1);
    expect(flushed).toBe(false);

    await flush(25);
    expect(attempts).toBe(2);
    expect(flushed).toBe(false);

    await flush(45);
    await flushPromise;

    expect(flushed).toBe(true);
    expect(attempts).toBe(3);
    expect(recorder.requests).toHaveLength(1);
    stream.end();
  });
});
