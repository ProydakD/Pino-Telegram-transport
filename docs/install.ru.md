# Установка и Обновление

Русская версия · [English version](install.en.md)

## Требования

- Установите Node.js 18 или выше (используется встроенный `fetch`).
- Для проектов с `pino@10` используйте Node.js 20 или выше.
- Создайте Telegram-бота и убедитесь, что у него есть доступ к нужным чатам.
- Разрешите исходящие соединения к `https://api.telegram.org`.

## Матрица совместимости

- `pino@^9` на Node.js 18+
- `pino@^10` на Node.js 20+

## Установка

1. Устанавливайте транспорт вместе с совместимой версией `pino`, потому что `pino` объявлен как peer dependency.
2. Используйте одну из поддерживаемых команд:

```bash
npm install pino@^10 pino-telegram-logger-transport
# или
npm install pino@^9 pino-telegram-logger-transport
```

## Обновление

1. Обновляйте оба пакета внутри поддерживаемой матрицы.
2. Например, для линии `pino@10`:

```bash
npm install pino@^10 pino-telegram-logger-transport@latest
```
