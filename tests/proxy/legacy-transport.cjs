const assert = require('node:assert/strict');
const { getEventListeners, once } = require('node:events');
const telegramTransport = require('../../dist').default;
const { TelegramClient } = require('../../dist/telegram-client');
const utils = require('../../dist/utils');
const { startApi } = require('./servers.cjs');

const options = {
  botToken: process.env.TELEGRAM_BOT_TOKEN,
  chatId: 42,
  retryAttempts: 1,
  requestTimeoutMs: 0,
};
const log = '{"level":30,"msg":"legacy fixture"}\n';

async function checkJson() {
  assert.equal(typeof fetch, 'undefined');
  assert.equal(typeof FormData, 'undefined');
  assert.equal(typeof Response, 'undefined');
  const failures = [];
  const stream = telegramTransport({
    ...options,
    proxyUrl: process.env.TELEGRAM_PROXY_URL,
    onDeliveryError: (error) => failures.push(error.message),
  });
  const closed = once(stream, 'close');
  stream.end(log);
  await closed;
  assert.deepEqual(failures, []);
}

async function checkCancellation() {
  const cleanups = [];
  const fixture = { after: (cleanup) => cleanups.unshift(cleanup) };
  try {
    let receiveStall;
    const stalled = new Promise((resolve) => (receiveStall = resolve));
    const api = await startApi(fixture, () =>
      api.requests.length <= 50 ? 200 : (res) => receiveStall({ disconnected: once(res, 'close') }),
    );
    // Этот процесс проверяет обычный fetch без прокси, но только к loopback.
    utils.buildTelegramUrl = (_, method) => `https://127.0.0.1:${api.port}/legacy/${method}`;
    const client = new TelegramClient(utils.normalizeOptions(options));
    fixture.after(() => client.close());
    const counts = [];
    for (let index = 0; index < 50; index++) {
      await client.send({ method: 'sendMessage', payload: { chat_id: 42, text: String(index) } });
      counts.push(getEventListeners(client.signal, 'abort').length);
    }

    const failures = [];
    const stream = telegramTransport({
      ...options,
      onDeliveryError: (error) => failures.push(error.message),
    });
    fixture.after(() => stream.destroy());
    stream.write(log);
    // После прихода зависшего запроса сервер не отвечает, пока destroy не закроет сокет.
    const { disconnected } = await stalled;
    const closed = once(stream, 'close');
    stream.destroy();
    await closed;
    await disconnected;
    await new Promise((resolve, reject) => {
      stream.flush((error) => (error ? reject(error) : resolve()));
    });
    assert.deepEqual(failures, []);
    assert.deepEqual(
      api.requests.map(({ verb, method }) => `${verb} ${method}`),
      Array(51).fill('POST sendMessage'),
    );
    assert.equal(Math.max(...counts), 0, 'abort handlers accumulated on the parent signal');
  } finally {
    for (const cleanup of cleanups) await cleanup();
  }
}

const check = process.argv[2] === 'json' ? checkJson : checkCancellation;
check().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
