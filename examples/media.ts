import pino from 'pino';
import telegramTransport from 'pino-telegram-logger-transport';

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('Перед запуском задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID');
  }

  const stream = telegramTransport({
    botToken,
    chatId,
    // formatMessage: mediaFormatter,
    includeContext: true,
  });

  const logger = pino({}, stream);

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

  await new Promise((resolve) => setTimeout(resolve, 500));
}

main().catch((error) => {
  console.error('Media example failed', error);
  process.exit(1);
});
