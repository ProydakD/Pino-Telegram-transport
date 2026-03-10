# Pino Telegram transport

[![npm version](https://img.shields.io/npm/v/pino-telegram-logger-transport?logo=npm)](https://www.npmjs.com/package/pino-telegram-logger-transport)
[![npm downloads](https://img.shields.io/npm/dm/pino-telegram-logger-transport?logo=npm)](https://www.npmjs.com/package/pino-telegram-logger-transport)
[![Node.js >=18](https://img.shields.io/node/v/pino-telegram-logger-transport)](https://www.npmjs.com/package/pino-telegram-logger-transport)
[![License: MIT](https://img.shields.io/npm/l/pino-telegram-logger-transport)](https://www.npmjs.com/package/pino-telegram-logger-transport)

English version · [Русская версия](README.ru.md)

A transport for [Pino](https://github.com/pinojs/pino) that forwards structured logs to the Telegram Bot API, supports media attachments, and ships ready-made adapters for NestJS, Fastify, and AWS Lambda. Private chats, supergroups, topics, and media uploads are supported out of the box.

## What's New

Recent releases focused on three areas: safer delivery, safer formatting, and lower-noise operations.

### Delivery and runtime hardening

- Node.js 18 support now matches the actual runtime behavior, without a direct runtime dependency on `undici`.
- Slow Bot API calls are bounded with `requestTimeoutMs`, and timeout failures can be retried.
- `logger.flush(callback)` now waits for the real delivery pipeline, including retries and split text messages.
- `maxQueueSize` and `overflowStrategy` keep the in-memory queue bounded when Telegram slows down.
- `failOnInitError` adds a fail-fast startup mode for production deployments.

### Safer formatting and message delivery

- `redactKeys` masks sensitive values inside the built-in `Context`, `Error`, and `Extras` blocks.
- Invalid `time` values no longer crash the formatter.
- HTML truncation is Telegram-safe and no longer breaks tags or entities.
- `splitLongMessages` can send long text logs as ordered parts instead of cutting them off.
- HTML escaping now matches Telegram Bot API constraints more closely.

### Better routing, CLI, and signal-to-noise ratio

- Each target can define its own `minLevel`, so errors and warnings can go to different chats.
- Built-in `formatPreset: 'compact' | 'verbose'` makes it easier to switch between dense operational logs and more detailed output.
- `dedupWindowMs` suppresses repeated text events inside a configurable time window.
- `pino-telegram-cli check --probe-message` verifies real send permissions, not just chat visibility.
- `pino-telegram-cli generate-config --include-token` keeps generated configs safe by default.
- CI and prerelease checks now cover Node.js `18/20/24` and `pino@9/10`.

### Example: production-friendly transport config

```typescript
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: [
        { chatId: process.env.TELEGRAM_ALERTS_CHAT_ID!, minLevel: 'error' },
        { chatId: process.env.TELEGRAM_WARNINGS_CHAT_ID!, minLevel: 'warn' },
      ],
      requestTimeoutMs: 10_000,
      maxQueueSize: 1_000,
      overflowStrategy: 'dropOldest',
      failOnInitError: true,
      splitLongMessages: true,
      formatPreset: 'compact',
      dedupWindowMs: 30_000,
    },
  },
});
```

## Key Features

- Deliver messages to multiple chats and topics while keeping the original order.
- Route different severity levels to different chats with global and per-target `minLevel`.
- Stay within Telegram limits with configurable delays and retry policies.
- Bound the in-memory delivery queue and choose an overflow strategy.
- Suppress repeated text events with `dedupWindowMs`.
- Redact sensitive keys in the `Context`, `Error`, and `Extras` sections.
- Split long text messages into multiple parts with `splitLongMessages`.
- Choose between built-in `compact` and `verbose` presets or provide a custom formatter.
- Send text, photos, or documents with a single transport.
- Override the delivery method with a custom `send` function in direct-stream mode.
- Validate credentials and scaffold configs with the built-in CLI.

## Requirements

- Node.js 18+
- Node.js 20+ when used with `pino@10`
- Supported combinations:
  - `pino@^9` on Node.js 18+
  - `pino@^10` on Node.js 20+
- A Telegram bot with write access to all target chats

## Installation

```bash
npm install pino@^10 pino-telegram-logger-transport
# or
npm install pino@^9 pino-telegram-logger-transport
```

## Quick Start

```typescript
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID,
      threadId: process.env.TELEGRAM_THREAD_ID,
      minLevel: 'warn',
      minDelayBetweenMessages: 200,
      retryAttempts: 3,
    },
  },
});

logger.info({ context: { requestId: '42' } }, 'Hello, Telegram!');
```

## Default Output

The transport renders an HTML message similar to:

```html
ℹ️ INFO — <b>Message</b> <b>Time:</b> 2025-09-17T16:35:00.000Z
<b>Context:</b>
<pre>{"requestId":"42"}</pre>
```

When the log contains `err`, an **Error** section with `message` and `stack` is added. Additional properties (besides `level`, `time`, `msg`, `context`, `err`) are rendered inside the **Extras** block.

## Retry Policy

- Retry delivery on 429 and 5xx responses.
- Tune delays with `retryAttempts`, `retryInitialDelay`, `retryBackoffFactor`, `retryMaxDelay`.
- Abort slow Telegram requests with `requestTimeoutMs` (`10000` ms by default) and retry timeout failures.
- Respect `retry_after` hints returned by Telegram.
- Set `retryAttempts: 1` to disable retries entirely.

## Working with Media

```typescript
logger.warn({
  messageType: 'photo',
  mediaUrl: 'https://example.com/path/to/photo',
  caption: 'Incident snapshot',
});
```

By default the formatter looks for `messageType` (`text`/`photo`/`document`), `mediaUrl`, `mediaBuffer`, `mediaFilename`, `mediaContentType`, and `caption`.
Binary payloads can be provided as `Buffer`, `Uint8Array`, `ArrayBuffer`, or `{ type: 'Buffer', data: number[] }` objects.
Telegram limits media captions to 1024 characters, so keep `caption` within that budget.

## Custom Headings

```typescript
pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      headings: {
        time: 'Time',
        context: 'Context',
        error: 'Error',
        extras: 'Extras',
      },
      includeExtras: false,
      extraKeys: ['requestId', 'userId'],
    },
  },
});
```

Combine `headings`, `includeExtras`, `extraKeys`, `contextKeys`, `maxMessageLength`, and `splitLongMessages` to tailor the message format.

## Custom `send` Function

```typescript
async function sendToQueue(payload: TelegramSendPayload, method: TelegramMethod) {
  console.log('Method:', method);
  console.log('Payload:', JSON.stringify(payload, null, 2));
}
```

The `send` option receives the payload and the selected method. Legacy handlers that expect a single argument remain compatible: the second argument will be ignored.
Pass `send`, `formatMessage`, and `onDeliveryError` only through direct transport creation (`const stream = telegramTransport(options); const logger = pino({}, stream);`).
The `transport.target` mode serializes options and should be treated as serializable-only.

## Framework Integrations

### NestJS

```typescript
import { LoggerModule } from 'nestjs-pino';
import { createNestLoggerOptions } from 'pino-telegram-logger-transport';

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
);
```

### Fastify

```typescript
import fastify from 'fastify';
import { createFastifyLoggerOptions } from 'pino-telegram-logger-transport';

const app = fastify({
  logger: createFastifyLoggerOptions({
    botToken: process.env.TELEGRAM_BOT_TOKEN!,
    chatId: process.env.TELEGRAM_CHAT_ID!,
  }),
});
```

### AWS Lambda

```typescript
import pino from 'pino';
import { createLambdaLoggerOptions } from 'pino-telegram-logger-transport';

const logger = pino(
  createLambdaLoggerOptions({
    botToken: process.env.TELEGRAM_BOT_TOKEN!,
    chatId: process.env.TELEGRAM_CHAT_ID!,
  }),
);

export const handler = async (event: unknown) => {
  logger.info({ event }, 'Lambda invoked');
  // business logic
};
```

## Documentation

- [Installation](docs/install.en.md)
- [Usage](docs/usage.en.md)
- [Configuration](docs/configuration.en.md)
- [Examples](docs/examples.en.md)
- [FAQ](docs/faq.en.md)
- [CLI reference](docs/cli.en.md)

## License

MIT
