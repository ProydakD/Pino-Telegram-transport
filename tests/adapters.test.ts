import { describe, expect, it } from 'vitest';
import {
  createNestLoggerOptions,
  createFastifyLoggerOptions,
  createLambdaLoggerOptions,
} from '../src';
import type { TelegramTransportOptions } from '../src/types';

const baseTransportOptions: TelegramTransportOptions = {
  botToken: '123:ABC',
  chatId: 42,
};

describe('адаптеры Telegram-транспорта', () => {
  it('возвращает конфигурацию LoggerModule для NestJS', () => {
    const overrides = { applicationName: 'demo', pinoHttp: { level: 'info' } };
    const result = createNestLoggerOptions(baseTransportOptions, overrides);

    expect(result.applicationName).toBe('demo');
    const nestTransport = (result.pinoHttp as Record<string, unknown> | undefined)?.transport as
      | Record<string, unknown>
      | undefined;

    expect(nestTransport).toBeDefined();
    expect(nestTransport).toMatchObject({
      target: 'pino-telegram-logger-transport',
      options: baseTransportOptions,
    });
    expect(nestTransport?.options).not.toBe(baseTransportOptions);
  });

  it('подготавливает конфигурацию логгера Fastify', () => {
    const baseLogger = { level: 'warn' };
    const result = createFastifyLoggerOptions(baseTransportOptions, baseLogger);

    expect(result.level).toBe('warn');
    const transport = result.transport as Record<string, unknown> | undefined;
    expect(transport).toEqual({
      target: 'pino-telegram-logger-transport',
      options: baseTransportOptions,
    });
    expect(transport?.options as TelegramTransportOptions | undefined).not.toBe(
      baseTransportOptions,
    );
  });

  it('формирует конфигурацию pino для AWS Lambda', () => {
    const baseOptions = { level: 'debug', browser: { asObject: true } };
    const result = createLambdaLoggerOptions(baseTransportOptions, baseOptions);

    expect(result.level).toBe('debug');
    expect(result.browser).toEqual({ asObject: true });
    const transport = result.transport as Record<string, unknown> | undefined;
    expect(transport).toEqual({
      target: 'pino-telegram-logger-transport',
      options: baseTransportOptions,
    });
    expect(transport?.options as TelegramTransportOptions | undefined).not.toBe(
      baseTransportOptions,
    );
  });
});
