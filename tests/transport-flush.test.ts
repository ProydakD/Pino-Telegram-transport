import { describe, expect, it, vi } from 'vitest';
import telegramTransport from '../src';
import { TelegramMethod, TelegramSendPayload } from '../src/types';

const TOKEN = '123:ABC';

interface RecordedRequest {
  method: TelegramMethod;
  payload: TelegramSendPayload;
}

function createRecorder() {
  const requests: RecordedRequest[] = [];

  return {
    requests,
    async send(payload: TelegramSendPayload, method: TelegramMethod) {
      const clone = (
        typeof structuredClone === 'function'
          ? structuredClone(payload)
          : JSON.parse(JSON.stringify(payload))
      ) as TelegramSendPayload;

      requests.push({ method, payload: clone });
    },
  };
}

function createControlledSend(recorder: ReturnType<typeof createRecorder>): {
  send: (payload: TelegramSendPayload, method: TelegramMethod) => Promise<void>;
  releaseNext: () => Promise<void>;
  getPendingCount: () => number;
} {
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
    getPendingCount() {
      return pendingSends.length;
    },
    async releaseNext() {
      const nextSend = pendingSends.shift();
      await nextSend?.();
    },
  };
}

async function flushMicrotasks(iterations = 5): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

describe('transport write callback', () => {
  it('waits for all split parts before completing the write callback', async () => {
    const recorder = createRecorder();
    const controlledSend = createControlledSend(recorder);
    const stream = telegramTransport({
      botToken: TOKEN,
      chatId: 111,
      send: controlledSend.send,
      splitLongMessages: true,
      maxMessageLength: 18,
      formatMessage: async () => ({
        text: '<b>ABCDEFGHIJKLMNOPQRSTUVWXYZ</b>',
      }),
    });

    let isWriteCallbackCalled = false;

    stream.write(`${JSON.stringify({ level: 30, msg: 'Split me' })}\n`, () => {
      isWriteCallbackCalled = true;
    });

    await flushMicrotasks();
    expect(isWriteCallbackCalled).toBe(false);

    await controlledSend.releaseNext();
    await vi.waitFor(() => {
      expect(recorder.requests).toHaveLength(1);
    });
    expect(isWriteCallbackCalled).toBe(false);

    await vi.waitFor(() => {
      expect(controlledSend.getPendingCount()).toBe(1);
    });
    await controlledSend.releaseNext();
    await vi.waitFor(() => {
      expect(recorder.requests).toHaveLength(2);
    });
    expect(isWriteCallbackCalled).toBe(false);

    await vi.waitFor(() => {
      expect(controlledSend.getPendingCount()).toBe(1);
    });
    await controlledSend.releaseNext();
    await vi.waitFor(() => {
      expect(recorder.requests).toHaveLength(3);
      expect(isWriteCallbackCalled).toBe(true);
    });
  });
});
