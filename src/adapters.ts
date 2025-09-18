import type { LoggerOptions } from 'pino';
import type { TelegramTransportOptions } from './types';

/**
 * Общий конфиг транспорта для pino. Используется адаптерами популярных фреймворков.
 */
function createTransportConfig(options: TelegramTransportOptions) {
  return {
    target: 'pino-telegram-logger-transport',
    options: { ...options },
  };
}

export interface NestLoggerOptions {
  /**
   * Конфигурация pino-http, которую использует LoggerModule из nestjs-pino.
   */
  pinoHttp?: Record<string, unknown>;
  /**
   * Прочие опции LoggerModule.
   */
  [key: string]: unknown;
}

export interface NestLoggerOverrides extends NestLoggerOptions {}

/**
 * Создаёт конфигурацию LoggerModule для nestjs-pino с подключённым Telegram-транспортом.
 */
export function createNestLoggerOptions(
  transportOptions: TelegramTransportOptions,
  overrides: NestLoggerOverrides = {},
): NestLoggerOptions {
  const { pinoHttp, ...rest } = overrides;

  return {
    ...rest,
    pinoHttp: {
      ...(pinoHttp ?? {}),
      transport: createTransportConfig(transportOptions),
    },
  };
}

export type FastifyLoggerOptions = Record<string, unknown>;

/**
 * Подготавливает опции логгера Fastify с активированным Telegram-транспортом.
 */
export function createFastifyLoggerOptions(
  transportOptions: TelegramTransportOptions,
  baseOptions: FastifyLoggerOptions = {},
): FastifyLoggerOptions {
  return {
    ...baseOptions,
    transport: createTransportConfig(transportOptions),
  };
}

/**
 * Формирует конфигурацию pino для AWS Lambda.
 * Не навязывает pino в зависимостях — пользователь вызывает pino самостоятельно.
 */
export function createLambdaLoggerOptions(
  transportOptions: TelegramTransportOptions,
  baseOptions: LoggerOptions = {},
): LoggerOptions {
  return {
    ...baseOptions,
    transport: createTransportConfig(transportOptions),
  };
}
