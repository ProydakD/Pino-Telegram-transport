import { afterEach, describe, expect, it, vi } from 'vitest';
import telegramTransport, { TelegramDeliveryError } from '../src';
import { TelegramMessagePayload, TelegramTransportOptions } from '../src/types';

const TOKEN = '123:ABC';

interface Recorder {
  payloads: TelegramMessagePayload[];
  send: (payload: TelegramMessagePayload) => Promise<void>;
  timestamps: number[];
}

function createRecorder(): Recorder {
  const payloads: TelegramMessagePayload[] = [];
  const timestamps: number[] = [];
  return {
    payloads,
    timestamps,
    async send(payload) {
      payloads.push(JSON.parse(JSON.stringify(payload)));
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

    expect(recorder.payloads).toHaveLength(1);
    const payload = recorder.payloads[0];
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

    const payload = recorder.payloads[0];
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

    const payload = recorder.payloads[0];
    expect(payload.text).toContain('Extras');
    expect(payload.text).toContain('foo');
  });

  it('allows disabling extras block entirely', async () => {
    const recorder = createRecorder();
    const { stream } = createTransport({ includeExtras: false }, recorder);

    stream.write(`${JSON.stringify({ level: 30, msg: 'No extras', foo: 'bar' })}\n`);
    stream.end();

    await flush();

    const payload = recorder.payloads[0];
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

    const payload = recorder.payloads[0];
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

    const payload = recorder.payloads[0];
    expect(payload.text).toContain('User Data');
    expect(payload.text).toContain('Timestamp');
    expect(payload.text).not.toContain('Context');
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

    expect(recorder.payloads).toHaveLength(2);
    const [first, second] = recorder.payloads;
    expect(first.chat_id).toBe('chat_A');
    expect(second.chat_id).toBe(-222);
    expect(second.message_thread_id).toBe(77);
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
    vi.useRealTimers();
    stream.end();
    await flush();

    expect(recorder.payloads).toHaveLength(2);
    expect(recorder.timestamps[1] - recorder.timestamps[0]).toBeGreaterThanOrEqual(200);
  });

  it('retries on 429 responses with retry_after hint', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const recorder = createRecorder();
    const originalSend = recorder.send;
    const attempts: number[] = [];

    recorder.send = vi.fn(async (payload) => {
      attempts.push(Date.now());
      if (attempts.length < 3) {
        throw new TelegramDeliveryError(
          'Too many requests',
          { ok: false, error_code: 429, parameters: { retry_after: 1 } },
          429,
        );
      }
      await originalSend(payload);
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
    expect(attempts.length).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runOnlyPendingTimersAsync();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.runOnlyPendingTimersAsync();

    await flush();

    expect(recorder.send).toHaveBeenCalledTimes(3);
    expect(recorder.payloads).toHaveLength(1);
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

    recorder.send = vi.fn(async (payload) => {
      attempts.push(Date.now());
      if (attempts.length < 3) {
        throw new TelegramDeliveryError('Server error', { ok: false, error_code: 500 }, 500);
      }
      await originalSend(payload);
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
    expect(attempts.length).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(200);
    await vi.runOnlyPendingTimersAsync();

    await vi.advanceTimersByTimeAsync(400);
    await vi.runOnlyPendingTimersAsync();

    await flush();

    expect(recorder.send).toHaveBeenCalledTimes(3);
    expect(recorder.payloads).toHaveLength(1);
    expect(attempts[1] - attempts[0]).toBeGreaterThanOrEqual(200);
    expect(attempts[2] - attempts[1]).toBeGreaterThanOrEqual(400);
  });

  it('does not retry non-retryable errors', async () => {
    const recorder: Recorder = {
      payloads: [],
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

    expect(recorder.send).toHaveBeenCalledTimes(1);
    expect(onDeliveryError).toHaveBeenCalledTimes(1);
    expect(onDeliveryError.mock.calls[0][0]).toBeInstanceOf(TelegramDeliveryError);
  });
});
