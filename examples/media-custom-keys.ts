import { Buffer } from 'node:buffer';
import pino from 'pino';
import telegramTransport, { createMediaFormatter } from 'pino-telegram-logger-transport';

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('Перед запуском задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID');
  }

  const mediaFormatter = createMediaFormatter({
    typeKey: 'kind',
    bufferKey: 'attachmentBuffer',
    filenameKey: 'attachmentName',
    contentTypeKey: 'attachmentType',
    captionKey: 'note',
    captionMaxLength: 32,
  });

  const stream = telegramTransport({
    botToken,
    chatId,
    formatMessage: mediaFormatter,
  });

  const logger = pino({}, stream);

  logger.info(
    {
      kind: 'photo',
      attachmentBuffer: Buffer.from('sample image data'),
      attachmentName: 'diagram.png',
      attachmentType: 'image/png',
      note: 'Диаграмма состояния сервиса',
    },
    'Диаграмма состояния сервиса',
  );

  await new Promise((resolve) => setTimeout(resolve, 500));
}

main().catch((error) => {
  console.error('Custom media example failed', error);
  process.exit(1);
});
