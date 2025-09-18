# Examples

English version · [Русская версия](examples.ru.md)

## Basic stream with multiple chats

```ts
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: [process.env.TELEGRAM_CHAT_ID!, { chatId: -1001234567890, threadId: 77 }],
      minDelayBetweenMessages: 150,
    },
  },
});

logger.info({ context: { input: 'demo' } }, 'Transport is ready');
```

## Custom headings and Extras

```ts
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      headings: {
        time: 'Time',
        context: 'Context',
        error: 'Error',
        extras: 'Details',
      },
      includeExtras: true,
      extraKeys: ['requestId', 'release'],
    },
  },
});

logger.warn({ requestId: 'req-1', release: '1.2.0' }, 'Slow response');
```

## Default media delivery

```ts
import pino from 'pino';
import telegramTransport from 'pino-telegram-logger-transport';

const stream = telegramTransport({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: process.env.TELEGRAM_CHAT_ID!,
  includeContext: true,
});

const logger = pino({}, stream);

logger.warn({
  messageType: 'photo',
  mediaUrl: 'https://picsum.photos/seed/pino/600/400',
  caption: 'Incident snapshot',
});
```

## createMediaFormatter with custom keys

```ts
import { Buffer } from 'node:buffer';
import telegramTransport, { createMediaFormatter } from 'pino-telegram-logger-transport';

const mediaFormatter = createMediaFormatter({
  typeKey: 'kind',
  bufferKey: 'attachmentBuffer',
  filenameKey: 'attachmentName',
  contentTypeKey: 'attachmentType',
  captionKey: 'note',
  captionMaxLength: 32,
});

const stream = telegramTransport({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: process.env.TELEGRAM_CHAT_ID!,
  formatMessage: mediaFormatter,
});

const logger = pino({}, stream);

logger.info(
  {
    kind: 'photo',
    attachmentBuffer: Buffer.from('sample image data'),
    attachmentName: 'diagram.png',
    attachmentType: 'image/png',
    note: 'Service state diagram',
  },
  'Service state diagram',
);
```

## Retry scenario

```ts
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      retryAttempts: 5,
      retryInitialDelay: 1000,
      retryBackoffFactor: 1.5,
      retryMaxDelay: 15000,
      onDeliveryError: (error, payload, method) => {
        console.error('Delivery failed', method, payload, error);
      },
    },
  },
});
```

Adjust `retryAttempts` and delays to match your limits, and use `onDeliveryError` to feed metrics or alerts.

## Framework integrations

### NestJS

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { createNestLoggerOptions } from 'pino-telegram-logger-transport';

@Module({
  imports: [
    LoggerModule.forRoot(
      createNestLoggerOptions({
        botToken: process.env.TELEGRAM_BOT_TOKEN!,
        chatId: process.env.TELEGRAM_CHAT_ID!,
      }),
    ),
  ],
})
export class AppModule {}
```

### Fastify

```ts
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

```ts
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
};
```
