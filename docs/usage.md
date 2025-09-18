# Использование Транспорта

## Базовая Интеграция С Pino

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

## Отправка В Несколько Чатов

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

## Прямое Создание Транспорта

```ts
import pino from 'pino';
import telegramTransport from 'pino-telegram-logger-transport';

const stream = telegramTransport({
  botToken,
  chatId,
  formatMessage?: customFormatter,
});

const logger = pino({}, stream);
```

Используйте прямое создание, если требуется передать функции `formatMessage` или `send` без отключения воркера.

> ℹ️ Если `botToken` или `chatId` не указаны, транспорт отключается и выводит предупреждение, не прерывая процесс.

## Отключение Воркера (Pino ≥ 7)

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

## Передача Пользовательского Контекста

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

## Повторы Отправки

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

## Настройка Доставок

- Установите `disableNotification: true`, чтобы отправлять тихие сообщения.
- Установите `disableWebPagePreview: true`, если нужно показывать предпросмотр ссылок.
- Увеличьте `minDelayBetweenMessages`, чтобы распределить трафик по чатам.

## Пользовательский Форматтер

```ts
function customFormatter({ log }: FormatMessageInput): FormatMessageResult {
  return {
    text: `Level=${log.level}\nMessage=${log.msg}`,
    method: 'sendMessage',
  };
}
```

Возвращайте `text`, опциональный `method` и `extra`. Для медиа указывайте `photo` или `document` в `extra`.

## Отправка Медиа

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

## Пользовательский метод отпарвки `send`

```ts
async function sendToQueue(payload: TelegramSendPayload, method: TelegramMethod) {
  await queue.push({ method, payload });
}
```

Опция `send` позволяет интегрировать собственную очередь или HTTP-клиент. Функции с одним аргументом остаются совместимыми — второй параметр будет отброшен.

## Логирование Ошибок

- Без `onDeliveryError` транспорт пишет ошибки в `stderr`.
- Добавьте обработчик `(error, payload?, method?)`, чтобы переслать сбои в мониторинг или предпринять откат.

## Завершение Работы

Вызовите `await logger.flush?.()` или добавьте задержку перед остановкой процесса, чтобы дождаться доставки последних сообщений.
