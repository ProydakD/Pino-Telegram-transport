import pino from 'pino';

const logger = pino({
  transport: {
    target: 'pino-telegram-logger-transport',
    options: {
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      chatId: process.env.TELEGRAM_CHAT_ID!,
      retryAttempts: 4,
      retryInitialDelay: 500,
      retryBackoffFactor: 2,
      retryMaxDelay: 5000,
    },
  },
});

logger.info('First message goes through immediately');
logger.error(new Error('Retries will kick in for rate limits'));

(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
})();
