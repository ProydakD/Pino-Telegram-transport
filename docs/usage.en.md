# Using the Transport

English version · [Русская версия](usage.ru.md)

## Basic integration with Pino

> ℹ️ When you pass functions in the transport options (for example `onDeliveryError`), disable the worker (`worker: { enabled: false }`) to avoid `DataCloneError`. Alternatively create the transport manually: `const stream = telegramTransport(options); const logger = pino({}, stream);`

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

## Sending to multiple chats

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

## Creating the transport directly

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

Use manual creation when you need to pass `formatMessage` or `send` without disabling the worker.

> ℹ️ If `botToken` or `chatId` are missing, the transport falls back to a no-op mode and prints a warning.

## Disabling the worker (Pino ≥ 7)

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

Not every Node.js version allows disabling the worker without extra flags — test your environment.

## Passing custom context

```ts
logger.info({ context: { userId: 42, requestId: 'req-1' } }, 'Handled request');
```

- Enable the `Context` block with `includeContext` (default is `true`).
- Configure keys via `contextKeys: ['ctx', 'metadata']`.
- Disable the block with `includeContext: false` when you do not need it.

## Controlling Extras

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

Or limit the allowed fields:

```ts
extraKeys: ['requestId', 'origin'];
```

## Retry configuration

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

See `examples/retry.ts` for an explicit transport scenario.

## Custom formatter

```ts
function customFormatter({ log }: FormatMessageInput): FormatMessageResult {
  return {
    text: `Level=${log.level}\nMessage=${log.msg}`,
    method: 'sendMessage',
  };
}
```

Return `text`, an optional `method`, and `extra`. For media, place `photo` or `document` inside `extra`.

## Sending media

```ts
logger.warn(
  {
    messageType: 'photo',
    mediaUrl: 'https://picsum.photos/seed/pino/600/400',
    caption: 'Incident snapshot',
  },
  'Incident snapshot',
);

logger.error(
  {
    messageType: 'document',
    mediaUrl: 'https://picsum.photos/seed/pino/600/400',
    caption: 'Detailed error report',
  },
  'Detailed error report',
);
```

Telegram limits media captions to 1024 characters — keep that in mind when building `text` or `caption`.
For `Buffer` payloads use `{ type: 'Buffer', data: number[] }` objects produced by Pino. See `examples/media.ts` for a working reference.

## Custom `send` implementation

```ts
async function sendToQueue(payload: TelegramSendPayload, method: TelegramMethod) {
  await queue.push({ method, payload });
}
```

The `send` option lets you integrate your own queue or HTTP client. Handlers with a single argument remain compatible — the second argument is ignored.

## Framework integrations

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

- Pass extra `LoggerModule` options as the second argument.
- Disable HTTP buffering inside `pinoHttp` if it is enabled.

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

- Provide `baseOptions` to control Fastify log level and formatters.
- Or set the threshold directly with the transport `minLevel` option.
- Turn off the built-in Fastify transport if you already configured one to avoid duplicate deliveries.

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
  logger.info({ event }, 'Lambda invoked');
  // business logic
};
```

- Use the second argument for any `pino` options, such as `messageKey` or `base`.
- Call `await logger.flush?.()` before Lambda exits when you rely on asynchronous handlers.

## Error logging

- Without `onDeliveryError` the transport writes errors to `stderr`.
- Provide `(error, payload?, method?)` to forward failures to monitoring or trigger fallback logic.

## Graceful shutdown

Call `await logger.flush?.()` or add a short delay before terminating the process to ensure the last messages are delivered.
