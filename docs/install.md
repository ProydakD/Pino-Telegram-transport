# Установка и обновление

## Требования

- Node.js 18 и выше (используется встроенный `fetch`).
- Доступ в интернет для установки зависимостей и отправки сообщений Telegram API.
- Токен Telegram-бота и идентификатор чата/темы для проверки.

## Начальная настройка

```bash
npm install
npm run build
```

## Переменные окружения

Задайте переменные удобно для вашего окружения (PowerShell, Bash, `.env`). Минимальный набор:

```bash
export TELEGRAM_BOT_TOKEN=123:ABC
export TELEGRAM_CHAT_ID=-1001234567890
```

Дополнительно:

- `TELEGRAM_GROUP_ID` — идентификатор супергруппы для отправки в темы.
- `TELEGRAM_THREAD_ID` — идентификатор темы (thread) в супергруппе.

## Локальное тестирование без публикации

1. Выполните `npm run build`, чтобы получить артефакты в `dist/`.
2. Используйте self-reference из `package.json` — имя пакета `pino-telegram-transport` уже доступно в текущем проекте.
3. Для внешнего проекта:
   - `npm link` / `npm link pino-telegram-transport`.
   - или `npm pack` и `npm install ../путь/pino-telegram-transport-*.tgz`.

## Обновление зависимостей

- Основная команда: `npm update`.
- Для крупных обновлений выполняйте `npm outdated`, фиксируйте пакет в отдельной ветке, прогоняйте `npm run lint`, `npm test`, `npm run build`.

## Очистка проекта

```bash
npm run clean   # удаляет dist/
rm -rf node_modules package-lock.json
npm install
```

> 💡 Используйте `nvm`, `fnm` или аналогичный менеджер версий Node, чтобы зафиксировать версию движка на 18+.
