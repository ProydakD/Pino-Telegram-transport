const { once } = require('node:events');
const pino = require('pino');
const telegramTransport = require('../../dist').default;
const utils = require('../../dist/utils');

async function main() {
  const [mode, kind] = process.argv.slice(2);
  if (process.env.FIXTURE_RETRY_CLOCK) {
    // Подменяем только часы и планирование паузы; HTTP и CONNECT остаются настоящими.
    let now = Number(process.env.FIXTURE_RETRY_CLOCK);
    Date.now = () => now;
    utils.waitForDelay = async (ms, signal) => {
      signal.throwIfAborted();
      console.log(`fixture wait: ${ms}`);
      now += ms;
    };
  }
  const options = {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    proxyUrl: process.env.TELEGRAM_PROXY_URL,
    chatId: 42,
    threadId: 7,
    retryAttempts: Number(process.env.FIXTURE_ATTEMPTS || 1),
    retryInitialDelay: Number(process.env.FIXTURE_INITIAL_DELAY ?? 1),
    retryMaxDelay: process.env.FIXTURE_MAX_DELAY
      ? Number(process.env.FIXTURE_MAX_DELAY)
      : undefined,
    minDelayBetweenMessages: 0,
    requestTimeoutMs: Number(process.env.FIXTURE_TIMEOUT || 2000),
  };
  if (mode === 'direct') {
    options.onDeliveryError = (error) => {
      console.error(error.message, { status: error.status, isTimeout: error.isTimeout });
      process.exitCode = 1;
    };
  }
  const stream =
    mode === 'worker'
      ? pino.transport({ target: require.resolve('../../dist'), options })
      : telegramTransport(options);
  if (mode === 'worker') await once(stream, 'ready');
  const logger = pino({}, stream);
  if (kind === 'photo' || kind === 'document') {
    logger.info(
      {
        messageType: kind,
        mediaFilename: 'fixture.bin',
        mediaBuffer: Buffer.from([0, 255, 13, 10, 128]),
      },
      'binary fixture',
    );
  } else {
    for (let index = 0; index < Number(process.env.FIXTURE_MESSAGES || 1); index++) {
      logger.info(`text fixture ${index}`);
    }
  }
  const closed = once(stream, 'close');
  stream.end();
  await closed;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
