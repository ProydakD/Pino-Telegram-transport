# Pino Telegram transport

Транспорт для [Pino](https://github.com/pinojs/pino), пересылающий структурированные логи в Telegram Bot API с поддержкой медиа и адаптерами NestJS, Fastify и AWS Lambda. Поддерживаются личные чаты, супергруппы, темы и медиа-вложения.

## Основные Возможности

- Отправка сообщения в несколько чатов и темы с сохранением порядка.
- Управление задержками между отправками, чтобы укладываться в лимиты Telegram.
- Форматирование отправляемых сообщений.
- Отправка текста, фото или документов.
- Настройка повторных попыток с экспоненциальным `backoff` и обработкой `retry_after`.
- Переопределение метода отправки пользовательской функцией send для тестов или собственных клиентов.

## Требования

- Node.js 18+
- Telegram-бот с правами записи в целевые чаты

## Установка

```Bash
  npm install pino-telegram-logger-transport
```

## Быстрый Старт

```Typescript
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID,
      threadId?: process.env.TELEGRAM_THREAD_ID
      minDelayBetweenMessages: 200,
      retryAttempts: 3,
    },
  },
});

logger.info({ context: { requestId: '42' } }, 'Привет, Telegram!');
```

## Поведение по Умолчанию

Транспорт формирует HTML-сообщение вида:

```Html
ℹ️ INFO — <b>Message</b>
<b>Time:</b> 2025-09-17T16:35:00.000Z
<b>Context:</b>
<pre>{"requestId":"42"}</pre>
```

При наличии err добавляется блок **Error** с полями `message` и `stack`. Дополнительные свойства записи (кроме `level`, `time`, `msg`, `context`, `err`) попадают в секцию **Extras**.

## Повторы Отправки

- Повторяй доставку при ответах 429 и 5xx.
- Настраивай задержки опциями
  `retryAttempts`,
  `retryInitialDelay`,
  `retryBackoffFactor`,
  `retryMaxDelay`.
- Учитывай
  `retry_after`, если Telegram вернул рекомендацию по ожиданию.
- Отключай повторные попытки значением
  `retryAttempts: 1`.

## Работа с Медиa

```Typescript
logger.warn(
  {
    messageType: 'photo',
    mediaUrl: 'https://example.com/path/to/photo',
    caption: 'Снимок инцидента',
  }
);
```

По умолчанию форматтер ищет в логе поля messageType `(ext/photo/document)`, `mediaUrl`, `mediaBuffer`, `mediaFilename`, `mediaContentType` и `caption`.
Для двоичных вложений принимает `Buffer`, `Uint8Array`, `ArrayBuffer` или объекты `{ type: 'Buffer', data: number[] }`.
Telegram ограничивает подпись медиа 1024 символами — следи за длиной caption.

## Кастомизация Заголовки

```Typescript
pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      headings: {
        time: 'Время',
        context: 'Контекст',
        error: 'Ошибка',
        extras: 'Дополнительно',
      },
      includeExtras: false,
      extraKeys: ['requestId', 'userId'],
    },
  },
});
```

Комбинируй `headings`, `includeExtras`, `extraKeys`, `contextKeys` и `maxMessageLength`, чтобы адаптировать внешний вид сообщений.

## Пользовательский метод отправки `send`

```Typescript
async function sendToQueue(payload: TelegramSendPayload, method: TelegramMethod) {
  console.log('Method:', method);
  console.log('Payload:', JSON.stringify(payload, null, 2));
}
```

Опция `send` получает полезную нагрузку и выбранный метод. Старые обработчики, ожидающие один аргумент, остаются рабочими: второй параметр будет игнорирован.

## Интеграция с Фреймворками

### NestJS

```Typescript
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

```Typescript
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

```Typescript
import pino from 'pino';
import { createLambdaLoggerOptions } from 'pino-telegram-logger-transport';

const logger = pino(
  createLambdaLoggerOptions({
    botToken: process.env.TELEGRAM_BOT_TOKEN!,
    chatId: process.env.TELEGRAM_CHAT_ID!,
  }),
);

export const handler = async (event: unknown) => {
  logger.info({ event }, 'Lambda вызвана');
  // бизнес-логика
};
```

## Документация

- [Установка](docs/install.md)
- [Использование](docs/usage.md)
- [Конфигурация](docs/configuration.md)
- [Примеры](docs/examples.md)
- [FAQ](docs/faq.md)

## Лицензия

MIT
