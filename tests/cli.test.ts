import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

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

afterEach(() => {
  fetchMock.mockReset();
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
});
