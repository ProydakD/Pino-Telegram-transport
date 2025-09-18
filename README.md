# Pino Telegram transport

Транспорт для [Pino](https://github.com/pinojs/pino), отправляющий логи в Telegram Bot API. Поддерживает личные чаты, группы и темы в супергруппах, а также выводит пользовательский контекст в сообщении.

## Требования

- Node.js 18+
- Активированный Telegram-бот с правами на запись в указанные чаты

## Установка

```bash
npm install pino-telegram-logger-transport
```

## Быстрый старт

```typescript
import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: [process.env.TELEGRAM_CHAT_ID!, { chatId: -1001234567890, threadId: 42 }],
      minDelayBetweenMessages: 200,
    },
  },
});

logger.info({ context: { requestId: '42' } }, 'Привет, Telegram!');
```

## Формат сообщения

По умолчанию транспорт формирует текст вида:

```
ℹ️ INFO — <b>Message</b>
<b>Time:</b> 2025-09-17T16:35:00.000Z
<b>Context:</b>
<pre>{"requestId":"42"}</pre>
```

При наличии `err` в логе добавляется блок <b>Error</b> с полями `message` и `stack`. Дополнительные свойства записи (кроме `level`, `time`, `msg`, `context`, `err`) попадают в секцию <b>Extras</b>.

### Кастомизация заголовков

Для замены подписей по умолчанию (Time, Context, Error, Extras) используйте опцию `headings`:

```ts
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
    },
  },
});
```

Пара ключей можно задавать выборочно — остальные останутся английскими по умолчанию.

### Кастомизация секции Extras

По умолчанию Extras содержит все поля лог-записи, кроме зарезервированных (`level`, `time`, `msg`, `context`, `err`).\nИспользуйте опции `includeExtras` и `extraKeys`, чтобы отключить блок или ограничить набор полей.

```ts
pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      includeExtras: false,
    },
  },
});

// или ограниченный набор полей
pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken,
      chatId,
      extraKeys: ['requestId', 'userId'],
    },
  },
});
```

## Документация

Расширенные материалы находятся в каталоге `docs/`:

- [Использование](docs/usage.md)
- [Конфигурация](docs/configuration.md)
- [Примеры](docs/examples.md)
- [FAQ](docs/faq.md)

## Лицензия

MIT
