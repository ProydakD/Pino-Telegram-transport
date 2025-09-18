import pino from 'pino';

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const personalChat = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !personalChat) {
    throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID before running the example');
  }

  const targets: Array<string | number | { chatId: number; threadId?: number }> = [personalChat];

  if (process.env.TELEGRAM_GROUP_ID) {
    const chatId = Number(process.env.TELEGRAM_GROUP_ID);
    const threadId = process.env.TELEGRAM_THREAD_ID
      ? Number(process.env.TELEGRAM_THREAD_ID)
      : undefined;
    targets.push({ chatId, threadId });
  }

  const logger = pino({
    transport: {
      target: 'pino-telegram-transport',
      options: {
        botToken,
        chatId: targets,
        minDelayBetweenMessages: 100,
        includeContext: true,
        includeExtras: false,
      },
    },
    level: 'trace',
  });

  logger.info({ context: { requestId: 'demo-info' } }, 'Info example');
  logger.debug({ context: { requestId: 'demo-debug' } }, 'Debug example');
  logger.error({ err: new Error('Something went wrong') }, 'Error example');

  await new Promise((resolve) => setTimeout(resolve, 500));
}

main().catch((error) => {
  console.error('Example failed', error);
  process.exit(1);
});
