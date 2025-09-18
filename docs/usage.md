# Использование транспорта

## Базовая интеграция с Pino

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

## Отправка в темы супергруппы

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

## Прямое создание транспорта (без воркера)

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

Используйте этот подход, если нужно передать функции (`formatMessage`, `send`) и вы не хотите отключать воркер.

## Отключение воркера (Pino >= 7)

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

> Не все версии Node поддерживают отключение воркера без дополнительных флагов. Проверяйте окружение.

## Передача пользовательского контекста

```ts
logger.info({ context: { userId: 42, requestId: 'req-1' } }, 'Handled request');
```

- Контекст выводится блоком `Context`.
- Измените ключи: `contextKeys: ['ctx', 'metadata']`.
- Отключите блок: `includeContext: false`.

## Управление блоком Extras

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

ИЛИ ограничить набор полей:

```ts
extraKeys: ['requestId', 'origin'],
```

## Настройка доставок

- `disableNotification: true` — тихие сообщения.
- `disableWebPagePreview: false` — разрешить предпросмотр ссылок.
- `minDelayBetweenMessages` — увеличьте при работе с несколькими чатами, чтобы не упереться в rate limit.

## Пользовательский форматтер

```ts
function customFormatter({ log }: FormatMessageInput): FormatMessageResult {
  return {
    text: `Level=${log.level}\nMessage=${log.msg}`,
  };
}
```

Возвращайте `text` и опциональный `extra` (объединится с payload `sendMessage`).

## Пользовательский отправитель

```ts
async function sendToQueue(payload: TelegramMessagePayload) {
  await queue.push(payload);
}
```

Полезно для тестов, прокси и интеграции с другими сервисами. См. [примеры](examples.md).

## Логирование ошибок

- Без `onDeliveryError` транспорт пишет ошибки в stderr.
- Добавьте обработчик, чтобы пересылать ошибки в мониторинг или принимать решения об откате.

## Завершение работы

Вызывайте `await logger.flush?.()` или задержку перед остановкой процесса, чтобы гарантировать отправку последних сообщений.
