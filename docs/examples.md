# Примеры и сценарии

Каталог `examples/` содержит готовые сценарии, которые можно запускать через `ts-node`.

## Подготовка

```bash
npm install
npm run build
export TELEGRAM_BOT_TOKEN=123:ABC
export TELEGRAM_CHAT_ID=-1001234567890
```

## basic.ts — базовый запуск

- Отправка в личный чат и тему супергруппы.
- Примеры сообщений разных уровней (`info`, `debug`, `error`).
- Показывает использование контекста и rate limit.

Запуск:

```bash
npx ts-node examples/basic.ts
```

## custom-formatter.ts — MarkdownV2

- Прямое создание транспорта (без воркера) для кастомного `formatMessage`.
- Пример экранирования MarkdownV2.
- Демонстрирует работу `includeContext` и пользовательских заголовков.

```bash
npx ts-node examples/custom-formatter.ts
```

## retry.ts — экспоненциальные повторы

- Демонстрирует опции retryAttempts, retryInitialDelay, retryBackoffFactor и retryMaxDelay.
- Логирует ошибки доставки через onDeliveryError.
- Полезен для проверки поведения при 429/5xx и нестабильной сети.

```bash
npx ts-node examples/retry.ts
```

## custom-send.ts — кастомный отправитель

- Использует опцию `send` для подмены HTTP-запросов.
- Удобно для тестов, интеграции с очередями, прокси.
- Выводит payload в консоль и демонстрирует обработку ошибок через `onDeliveryError`.

```bash
npx ts-node examples/custom-send.ts
```

## Переиспользование шаблонов

- Копируйте пример и модифицируйте блок `options` под нужный сценарий.
- Если необходимо работать с воркером, избегайте функций в опциях (`send`, `formatMessage`).
- Для TypeScript-проектов можно импортировать типы `FormatMessageInput`, `FormatMessageResult`, `TelegramMessagePayload`.

## Работа без реального Telegram

Используйте `custom-send.ts` как основу для гибких тестов: подмените `send` и `onDeliveryError`, чтобы писать логи в файл или мок-сервис. Это особенно полезно в CI.
