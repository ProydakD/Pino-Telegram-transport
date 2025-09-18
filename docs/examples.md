# Примеры

## Базовый Поток с несколькими чатами

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

## Кастомные Заголовки и Extras

```ts
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      headings: {
        time: 'Время',
        context: 'Контекст',
        error: 'Ошибка',
        extras: 'Подробности',
      },
      includeExtras: true,
      extraKeys: ['requestId', 'release'],
    },
  },
});

logger.warn({ requestId: 'req-1', release: '1.2.0' }, 'Slow response');
```

## Отправка Медиа по умолчанию

```ts
import telegramTransport from 'pino-telegram-logger-transport';

const stream = telegramTransport({
    botToken: process.env.TELEGRAM_BOT_TOKEN;,
    chatId: process.env.TELEGRAM_CHAT_ID,
    includeContext: true,
});

const logger = pino({}, stream);

logger.warn(
    {
        messageType: 'photo',
        mediaUrl: 'https://picsum.photos/seed/pino/600/400',
        caption: 'Снимок инцидента',
    }
);
```

## Использование createMediaFormatter с кастомными ключами

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
    botToken: process.env.TELEGRAM_BOT_TOKEN;,
    chatId: process.env.TELEGRAM_CHAT_ID,
    formatMessage: mediaFormatter,
});

const logger = pino({}, stream);

logger.info(
    {
        kind: 'photo',
        attachmentBuffer: Buffer.from('sample image data'),
        attachmentName: 'diagram.png',
        attachmentType: 'image/png',
        note: 'Диаграмма состояния сервиса',
    },
    'Диаграмма состояния сервиса',
);
```

## Сценарий с повторами

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
        console.error('Не удалось доставить', method, payload, error);
      },
    },
  },
});
```

Настройте `retryAttempts` и задержки под свои лимиты, а `onDeliveryError` используйте для метрик или алертов.
