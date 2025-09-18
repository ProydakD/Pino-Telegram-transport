# Документация pino-telegram-transport

Добро пожаловать! Здесь собраны материалы, которые помогут быстро познакомиться с транспортом, настроить его в проекте и поддерживать рабочий процесс.

## Навигация

- [Установка](install.md)
- [Использование](usage.md)
- [Конфигурация](configuration.md)
- [Примеры и сценарии](examples.md)
- [Тестирование и качество](testing.md)
- [FAQ и устранение неполадок](faq.md)

## Быстрый старт

1. Установите зависимости: `npm install`.
2. Соберите проект: `npm run build`.
3. Заполните переменные окружения `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID`.
4. Подключите транспорт в Pino:

   ```ts
   import pino from 'pino';

   const logger = pino({
     transport: {
       target: 'pino-telegram-transport',
       options: {
         botToken: process.env.TELEGRAM_BOT_TOKEN!,
         chatId: process.env.TELEGRAM_CHAT_ID!,
       },
     },
   });

   logger.info('Hello, Telegram!');
   ```

5. Для опций с функциями (например, `formatMessage`) используйте прямое создание транспорта или отключите воркер (подробнее в [FAQ](faq.md)).
