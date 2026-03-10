# Using the Transport

English version · [Русская версия](usage.ru.md)

## Basic integration with Pino

> ℹ️ Use `transport.target` only with serializable options. If you need callbacks such as `formatMessage`, `send`, or `onDeliveryError`, create the transport directly: `const stream = telegramTransport(options); const logger = pino({}, stream);`

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

To route by level per destination:

```ts
const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      minLevel: 'info',
      chatId: [
        { chatId: '@app-info' },
        { chatId: '@app-alerts', minLevel: 'error' },
      ],
    },
  },
});
```

- The global `minLevel` remains the baseline threshold for every chat.
- `target.minLevel` adds stricter filtering only for the selected destination.
- Numeric values and string Pino levels (`'warn'`, `'error'`) work both globally and per target.

## Compact preset

```ts
const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      formatPreset: 'compact',
    },
  },
});
```

- `formatPreset: 'compact'` is declarative and safe to use with `transport.target`.
- The preset shortens the first line and collapses `Context`, `Error`, and `Extras` into compact JSON blocks.
- If `formatMessage` is provided, the custom callback still takes precedence over `formatPreset`.

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

Use direct creation whenever you need callbacks such as `formatMessage`, `send`, or `onDeliveryError`.

> ℹ️ If `botToken` or `chatId` are missing, the transport falls back to a no-op mode and prints a warning.
> ℹ️ Use `failOnInitError: true` when you need strict startup behaviour and want configuration errors to throw immediately.

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

Use the following option to redact sensitive keys:

```ts
redactKeys: ['token', 'password', 'secret', 'authorization', 'cookie', 'apiKey'];
```

An empty list `redactKeys: []` disables the default redaction set. The change only affects the `Context`, `Error`, and `Extras` blocks.

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

## Bounding the delivery queue

```ts
const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      maxQueueSize: 500,
      overflowStrategy: 'block',
    },
  },
});
```

- `maxQueueSize` caps the number of pending tasks in the in-memory queue.
- `overflowStrategy: 'dropOldest'` replaces the oldest pending record.
- `overflowStrategy: 'dropNewest'` discards the new record.
- `overflowStrategy: 'block'` waits for free space and slows intake instead of dropping logs.
- Dropped records are reported through `onDeliveryError` just like delivery failures.

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
Enable `splitLongMessages` for long text logs when you want the full message delivered as multiple parts.
For `Buffer` payloads use `{ type: 'Buffer', data: number[] }` objects produced by Pino. See `examples/media.ts` for a working reference.

## Custom `send` implementation

```ts
async function sendToQueue(payload: TelegramSendPayload, method: TelegramMethod) {
  await queue.push({ method, payload });
}
```

The `send` option lets you integrate your own queue or HTTP client. Handlers with a single argument remain compatible — the second argument is ignored.
Pass `send` only in direct-stream mode. Callback options are not a supported scenario for `transport.target`.

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
- Before Lambda exits, wait for `logger.flush(callback)`, for example via `await new Promise((resolve, reject) => logger.flush?.((error) => (error ? reject(error) : resolve(undefined))));`.

## Error logging

- Without `onDeliveryError` the transport writes errors to `stderr`.
- Provide `(error, payload?, method?)` to forward failures to monitoring or trigger fallback logic.

## Graceful shutdown

Before terminating the process, wait for `logger.flush(callback)`; an artificial delay is no longer required.
