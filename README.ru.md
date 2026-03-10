# Pino Telegram transport

Русская версия · [English version](README.en.md)

Транспорт для [Pino](https://github.com/pinojs/pino), пересылающий структурированные логи в Telegram Bot API с поддержкой медиа и адаптерами NestJS, Fastify и AWS Lambda. Поддерживаются личные чаты, супергруппы, темы и медиа-вложения.

## Основные Возможности

- Отправляй сообщения в несколько чатов и тем с сохранением порядка.
- Соблюдай лимиты Telegram, управляя задержками и повторами доставки.
- Ограничивай внутреннюю очередь доставки и выбирай стратегию переполнения.
- Ограничивай отправку по порогу уровня через `minLevel`.
- Редактируй чувствительные ключи в `Context`, `Error` и `Extras`.
- Разбивай длинные текстовые сообщения на несколько частей через `splitLongMessages`.
- Форматируй сообщения встроенным HTML-форматтером или собственным.
- Отправляй текст, фото или документы в рамках одного транспорта.
- Переопределяй метод отправки функцией `send` в direct-stream режиме.
- Проверяй токен и генерируй конфигурацию через встроенную CLI.

## Требования

- Node.js 18+
- Node.js 20+ при использовании `pino@10`
- Поддерживаемые сочетания:
  - `pino@^9` на Node.js 18+
  - `pino@^10` на Node.js 20+
- Telegram-бот с правами записи в целевые чаты

## Установка

```bash
npm install pino@^10 pino-telegram-logger-transport
# или
npm install pino@^9 pino-telegram-logger-transport
```

## Быстрый Старт

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

logger.info({ context: { requestId: '42' } }, 'Привет, Telegram!');
```

## Поведение по Умолчанию

Транспорт формирует HTML-сообщение вида:

```html
ℹ️ INFO — <b>Message</b> <b>Time:</b> 2025-09-17T16:35:00.000Z
<b>Context:</b>
<pre>{"requestId":"42"}</pre>
```

При наличии `err` добавляется блок **Error** с полями `message` и `stack`. Дополнительные свойства записи (кроме `level`, `time`, `msg`, `context`, `err`) попадают в секцию **Extras**.

## Повторы Отправки

- Повторяй доставку при ответах 429 и 5xx.
- Настраивай задержки опциями `retryAttempts`, `retryInitialDelay`, `retryBackoffFactor`, `retryMaxDelay`.
- Прерывай медленные запросы к Telegram через `requestTimeoutMs` (по умолчанию `10000` мс) и повторяй timeout-ошибки.
- Учитывай `retry_after`, если Telegram вернул рекомендацию по ожиданию.
- Отключай повторные попытки значением `retryAttempts: 1`.

## Работа с Медиа

```typescript
logger.warn({
  messageType: 'photo',
  mediaUrl: 'https://example.com/path/to/photo',
  caption: 'Снимок инцидента',
});
```

По умолчанию форматтер ищет в логе поля `messageType` (`text`/`photo`/`document`), `mediaUrl`, `mediaBuffer`, `mediaFilename`, `mediaContentType` и `caption`.
Для двоичных вложений принимает `Buffer`, `Uint8Array`, `ArrayBuffer` или объекты `{ type: 'Buffer', data: number[] }`.
Telegram ограничивает подпись медиа 1024 символами — следи за длиной `caption`.

## Кастомизация Заголовков

```typescript
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

Комбинируй `headings`, `includeExtras`, `extraKeys`, `contextKeys`, `maxMessageLength` и `splitLongMessages`, чтобы адаптировать внешний вид сообщений.

## Пользовательский метод отправки `send`

```typescript
async function sendToQueue(payload: TelegramSendPayload, method: TelegramMethod) {
  console.log('Method:', method);
  console.log('Payload:', JSON.stringify(payload, null, 2));
}
```

Опция `send` получает полезную нагрузку и выбранный метод. Старые обработчики, ожидающие один аргумент, остаются рабочими: второй параметр будет игнорирован.
Передавайте `send`, `formatMessage` и `onDeliveryError` только при прямом создании транспорта (`const stream = telegramTransport(options); const logger = pino({}, stream);`).
Режим `transport.target` сериализует опции и должен использоваться только с сериализуемыми значениями.

## Интеграция с Фреймворками

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
  logger.info({ event }, 'Lambda вызвана');
  // бизнес-логика
};
```

## Документация

- [Установка](docs/install.ru.md)
- [Использование](docs/usage.ru.md)
- [Конфигурация](docs/configuration.ru.md)
- [Примеры](docs/examples.ru.md)
- [FAQ](docs/faq.ru.md)
- [CLI](docs/cli.ru.md)

## Лицензия

MIT
