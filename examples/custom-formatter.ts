import pino from 'pino';
import telegramTransport, {
  FormatMessageInput,
  FormatMessageResult,
} from 'pino-telegram-transport';

function formatAsMarkdownV2({ log }: FormatMessageInput): FormatMessageResult {
  const timestamp = new Date(log.time ?? Date.now()).toISOString();
  const lines = [
    `*${escapeMarkdown(log.msg ?? 'Message is missing')}*`,
    `_Time:_ ${escapeMarkdown(timestamp)}`,
    `_Level:_ ${log.level}`,
  ];

  if (log.context) {
    const contextJson = JSON.stringify(log.context, null, 2);
    lines.push('```json');
    lines.push(escapeMarkdown(contextJson));
    lines.push('```');
  }

  return {
    text: lines.join('\n'),
    extra: {
      parse_mode: 'MarkdownV2',
    },
  };
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\_\-\*\[\]()~`>#+=|{}.!]/g, (symbol) => `\\${symbol}`);
}

async function main() {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    throw new Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID before running the example');
  }

  const transportStream = telegramTransport({
    botToken,
    chatId,
    includeContext: true,
    formatMessage: formatAsMarkdownV2,
  });

  const logger = pino({}, transportStream);

  logger.info({ context: { requestId: 'format-demo' } }, 'MarkdownV2 info');
  logger.error({ err: new Error('Formatting error') }, 'MarkdownV2 error');

  await new Promise((resolve) => setTimeout(resolve, 500));
}

main().catch((error) => {
  console.error('Custom formatter example failed', error);
  process.exit(1);
});
