import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;

import { runCli } from '../src/cli';

interface MockContext {
  stdoutMessages: string[];
  stderrMessages: string[];
  context: {
    stdout: (message: string) => void;
    stderr: (message: string) => void;
    env: NodeJS.ProcessEnv;
    cwd: () => string;
  };
}

function createContext(env: Record<string, string> = {}): MockContext {
  const stdoutMessages: string[] = [];
  const stderrMessages: string[] = [];
  const context = {
    stdout: (message: string) => {
      stdoutMessages.push(message);
    },
    stderr: (message: string) => {
      stderrMessages.push(message);
    },
    env: { ...env } as NodeJS.ProcessEnv,
    cwd: () => '/workdir',
  };
  return { stdoutMessages, stderrMessages, context };
}

function createResponse(payload: unknown, status = 200): Response {
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

beforeEach(() => {
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => fetchMock(...args)) as typeof fetch;
});

afterEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

describe('CLI утилита', () => {
  it('показывает справку по умолчанию', async () => {
    const { context, stdoutMessages } = createContext();

    const exitCode = await runCli([], context);

    expect(exitCode).toBe(0);
    expect(stdoutMessages[0]).toContain('pino-telegram-cli');
  });

  it('проверяет токен и чат', async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        ok: true,
        result: { id: 1, first_name: 'TestBot', username: 'test_bot' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      createResponse({
        ok: true,
        result: { id: -100, type: 'supergroup', title: 'Logs' },
      }),
    );

    const { context, stdoutMessages } = createContext();

    const exitCode = await runCli(['check', '--token', '123:ABC', '--chat-id', '-100'], context);

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stdoutMessages.some((line) => line.includes('Токен действителен'))).toBe(true);
    expect(stdoutMessages.some((line) => line.includes('Чат доступен'))).toBe(true);
  });

  it('сообщает об ошибке при неверном токене', async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({ ok: false, description: 'Unauthorized', error_code: 401 }, 401),
    );

    const { context, stderrMessages } = createContext();

    const exitCode = await runCli(['check', '--token', 'bad'], context);

    expect(exitCode).toBe(1);
    expect(stderrMessages.join('\n')).toContain('Не удалось проверить токен');
  });

  it('сообщает о таймауте при проверке токена', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce((_input: Parameters<typeof fetch>[0], init) =>
      createTimeoutResponse(init),
    );

    const { context, stderrMessages } = createContext();
    const pending = runCli(['check', '--token', '123:ABC'], context);

    await vi.advanceTimersByTimeAsync(10000);
    await vi.runOnlyPendingTimersAsync();

    const exitCode = await pending;

    expect(exitCode).toBe(1);
    expect(stderrMessages.join('\n')).toContain(
      'Превышено время ожидания ответа Telegram (getMe) после 10000 мс',
    );
  });

  it('генерирует конфигурацию в JSON', async () => {
    const { context, stdoutMessages } = createContext();

    const exitCode = await runCli(
      ['generate-config', '--token', '123:ABC', '--chat-id', '-100'],
      context,
    );

    expect(exitCode).toBe(0);
    expect(stdoutMessages.join('\n')).toContain('pino-telegram-logger-transport');
    expect(stdoutMessages.join('\n')).toContain('"botToken": "123:ABC"');
  });

  it('генерирует env-конфигурацию с несколькими чатами', async () => {
    const { context, stdoutMessages } = createContext();

    const exitCode = await runCli(
      ['generate-config', '--chat-id', '-100,-200', '--format', 'env'],
      context,
    );

    expect(exitCode).toBe(0);
    expect(stdoutMessages.join('\n')).toContain('TELEGRAM_CHAT_ID=-100,-200');
  });

  it('проверяет тему форума', async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        ok: true,
        result: { id: 1, first_name: 'TestBot', username: 'test_bot' },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      createResponse({
        ok: true,
        result: { id: -100, type: 'supergroup', title: 'Logs', is_forum: true },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      createResponse({
        ok: true,
        result: { message_id: 42 },
      }),
    );
    fetchMock.mockResolvedValueOnce(
      createResponse({
        ok: true,
        result: true,
      }),
    );

    const { context, stdoutMessages, stderrMessages } = createContext();

    const exitCode = await runCli(
      ['check', '--token', '123:ABC', '--chat-id', '-100', '--thread-id', '777'],
      context,
    );

    expect(exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(stdoutMessages.some((line) => line.includes('Тема доступна'))).toBe(true);
    expect(stderrMessages.some((line) => line.includes('Не удалось удалить'))).toBe(false);
  });
});
