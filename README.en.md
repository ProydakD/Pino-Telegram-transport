# Pino Telegram transport

English version · [Русская версия](README.ru.md)

A transport for [Pino](https://github.com/pinojs/pino) that forwards structured logs to the Telegram Bot API, supports media attachments, and ships ready-made adapters for NestJS, Fastify, and AWS Lambda. Private chats, supergroups, topics, and media uploads are supported out of the box.

## Key Features

- Deliver messages to multiple chats and topics while keeping the original order.
- Control delivery delays to stay within Telegram rate limits.
- Format outgoing messages with the built-in HTML formatter or a custom one.
- Send text, photos, or documents with a single transport.
- Configure retries with exponential backoff and `retry_after` handling.
- Override the delivery method with a custom `send` function for tests or alternative clients.

## Requirements

- Node.js 18+
- A Telegram bot with write access to all target chats

## Installation

```bash
npm install pino-telegram-logger-transport
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
Telegram limits media captions to 1024 characters — keep `caption` within that budget.

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

Combine `headings`, `includeExtras`, `extraKeys`, `contextKeys`, and `maxMessageLength` to tailor the message format.

## Custom `send` Function

```typescript
async function sendToQueue(payload: TelegramSendPayload, method: TelegramMethod) {
  console.log('Method:', method);
  console.log('Payload:', JSON.stringify(payload, null, 2));
}
```

The `send` option receives the payload and the selected method. Legacy handlers that expect a single argument remain compatible — the second argument will be ignored.

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

## License

MIT
