# Использование Транспорта

Русская версия · [English version](usage.en.md)

## Базовая интеграция с Pino

> ℹ️ Если планируете передавать функции в опции (например, `onDeliveryError`), отключите воркер (`worker: { enabled: false }`), чтобы избежать `DataCloneError`. Альтернатива — создать транспорт напрямую: `const stream = telegramTransport(options); const logger = pino({}, stream);`

```ts
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID!,
      minDelayBetweenMessages: 200,
    },
  },
});

logger.info({ context: { requestId: '42' } }, 'Hello, Telegram!');
```

## Отправка в несколько чатов

```ts
const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId: [
        process.env.TELEGRAM_CHAT_ID!,
        {
          chatId: Number(process.env.TELEGRAM_GROUP_ID),
          threadId: Number(process.env.TELEGRAM_THREAD_ID),
        },
      ],
    },
  },
});
```

## Прямое создание транспорта

```ts
import pino from 'pino';
import telegramTransport from 'pino-telegram-logger-transport';

const stream = telegramTransport({
  botToken,
  chatId,
  formatMessage: customFormatter,
});

const logger = pino({}, stream);
```

Используйте прямое создание, если нужно передать функции `formatMessage` или `send` без отключения воркера.

> ℹ️ Если `botToken` или `chatId` не указаны, транспорт отключается и выводит предупреждение, не прерывая процесс.

## Отключение воркера (Pino ≥ 7)

```ts
const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: { botToken, chatId, formatMessage: customFormatter },
    worker: {
      enabled: false,
    },
  },
});
```

Не все версии Node поддерживают отключение воркера без дополнительных флагов — проверяйте окружение.

## Пользовательский контекст

```ts
logger.info({ context: { userId: 42, requestId: 'req-1' } }, 'Handled request');
```

- Включайте блок `Context` опцией `includeContext` (по умолчанию `true`).
- Настраивайте ключи через `contextKeys: ['ctx', 'metadata']`.
- Отключайте блок `includeContext: false`.

## Управление Extras

```ts
const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      includeExtras: false,
    },
  },
});
```

Или ограничьте набор полей:

```ts
extraKeys: ['requestId', 'origin'];
```

## Повторы отправки

```ts
const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      retryAttempts: 4,
      retryInitialDelay: 500,
      retryBackoffFactor: 2,
      retryMaxDelay: 5000,
    },
  },
});
```

См. `examples/retry.ts` для сценария с явным транспортом.

## Пользовательский форматтер

```ts
function customFormatter({ log }: FormatMessageInput): FormatMessageResult {
  return {
    text: `Level=${log.level}\nMessage=${log.msg}`,
    method: 'sendMessage',
  };
}
```

Возвращайте `text`, опциональный `method` и `extra`. Для медиа указывайте `photo` или `document` в `extra`.

## Отправка медиа

```ts
logger.warn(
  {
    messageType: 'photo',
    mediaUrl: 'https://picsum.photos/seed/pino/600/400',
    caption: 'Снимок инцидента',
  },
  'Снимок инцидента',
);

logger.error(
  {
    messageType: 'document',
    mediaUrl: 'https://picsum.photos/seed/pino/600/400',
    caption: 'Подробный отчёт об ошибке',
  },
  'Подробный отчёт об ошибке',
);
```

Telegram ограничивает подпись медиа 1024 символами — учитывайте это при формировании `text` или `caption`.
Для `Buffer` используйте объекты `{ type: 'Buffer', data: number[] }`, которые Pino создаёт при сериализации. См. `examples/media.ts` для рабочей схемы.

## Пользовательский метод отправки `send`

```ts
async function sendToQueue(payload: TelegramSendPayload, method: TelegramMethod) {
  await queue.push({ method, payload });
}
```

Опция `send` позволяет интегрировать собственную очередь или HTTP-клиент. Функции с одним аргументом остаются совместимыми — второй параметр будет отброшен.

## Интеграция с фреймворками

### NestJS (nestjs-pino)

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { createNestLoggerOptions } from 'pino-telegram-logger-transport';

@Module({
  imports: [
    LoggerModule.forRoot(
      createNestLoggerOptions(
        {
          botToken: process.env.TELEGRAM_BOT_TOKEN!,
          chatId: process.env.TELEGRAM_CHAT_ID!,
        },
        {
          pinoHttp: {
            level: 'info',
          },
        },
      ),
    ),
  ],
})
export class AppModule {}
```

- Передавайте дополнительные опции `LoggerModule` вторым аргументом.
- Отключайте буферизацию HTTP-запросов в `pinoHttp`, если она включена.

### Fastify

```ts
import fastify from 'fastify';
import { createFastifyLoggerOptions } from 'pino-telegram-logger-transport';

const app = fastify({
  logger: createFastifyLoggerOptions(
    {
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID!,
    },
    { level: 'warn' },
  ),
});
```

- Передавайте `baseOptions` для настройки уровня и форматтеров Fastify.
- Отключайте встроенный транспорт Fastify, если передавали его ранее, чтобы не дублировать доставку.

### AWS Lambda

```ts
import pino from 'pino';
import { createLambdaLoggerOptions } from 'pino-telegram-logger-transport';

const logger = pino(
  createLambdaLoggerOptions(
    {
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID!,
    },
    { level: 'info' },
  ),
);

export const handler = async (event: unknown) => {
  logger.info({ event }, 'Lambda вызвана');
  // бизнес-логика
};
```

- Используйте вторым аргументом любые опции `pino`, например `messageKey` или `base`.
- Добавьте `await logger.flush?.()` перед завершением функции, если используете асинхронные обработчики.

## Логирование ошибок

- Без `onDeliveryError` транспорт пишет ошибки в `stderr`.
- Добавьте обработчик `(error, payload?, method?)`, чтобы переслать сбои в мониторинг или предпринять откат.

## Завершение работы

Вызовите `await logger.flush?.()` или добавьте задержку перед остановкой процесса, чтобы дождаться доставки последних сообщений.
