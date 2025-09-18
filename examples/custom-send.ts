import pino from 'pino';
import telegramTransport from 'pino-telegram-logger-transport';
import type { TelegramMethod, TelegramSendPayload } from 'pino-telegram-logger-transport';

async function customSend(payload: TelegramSendPayload, method: TelegramMethod): Promise<void> {
  // Forward to any external system (file, queue, monitoring service, etc.).
  console.log(`Custom delivery method: ${method}`);
  console.log('Custom delivery payload:', JSON.stringify(payload, null, 2));
}

async function main() {
  const stream = telegramTransport({
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? 'demo-token',
    chatId: process.env.TELEGRAM_CHAT_ID ?? 'demo-chat',
    send: customSend,
    onDeliveryError(error: unknown, payload?: TelegramSendPayload, method?: TelegramMethod) {
      console.error('Custom sender error', { error, method, payload });
    },
  });

  const logger = pino({}, stream);

  logger.warn({ context: { scenario: 'custom-send' } }, 'Example using custom send option');

  await new Promise((resolve) => setTimeout(resolve, 200));
}

main().catch((error) => {
  console.error('Custom send example failed', error);
  process.exit(1);
});
