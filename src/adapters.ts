import type { LoggerOptions } from 'pino';
import type { TelegramTransportOptions } from './types';

/**
 * Строит конфигурацию транспорта pino с переданными параметрами Telegram.
 *
 * @param options Опции транспорта Telegram.
 * @returns Конфигурация для использования в pino.
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

export type NestLoggerOverrides = NestLoggerOptions;

/**
 * Создаёт конфигурацию LoggerModule для nestjs-pino с подключённым Telegram-транспортом.
 *
 * @param transportOptions Опции Telegram-транспорта.
 * @param overrides Дополнительные настройки LoggerModule.
 * @returns Конфигурация для передачи в LoggerModule.forRoot().
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
 *
 * @param transportOptions Опции Telegram-транспорта.
 * @param baseOptions Базовые настройки логгера Fastify.
 * @returns Обновлённые опции логгера.
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
 * Формирует конфигурацию pino для AWS Lambda, добавляя Telegram-транспорт.
 *
 * @param transportOptions Опции Telegram-транспорта.
 * @param baseOptions Базовые настройки pino.
 * @returns Конфигурация, готовая к передаче в pino().
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
