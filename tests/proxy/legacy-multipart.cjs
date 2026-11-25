const assert = require('node:assert/strict');
const { TelegramClient } = require('../../dist/telegram-client');
const utils = require('../../dist/utils');
const { startApi, startConnect } = require('./servers.cjs');

async function main() {
  // node:test на 18.12.1 ещё не предоставляет t.after.
  const cleanups = [];
  const fixture = { after: (cleanup) => cleanups.unshift(cleanup) };
  try {
    const api = await startApi(fixture);
    const proxy = await startConnect(fixture, api.port, 'http', false);
    utils.buildTelegramUrl = (_, method) => `https://localhost:${api.port}/bot0:fixture/${method}`;
    const client = new TelegramClient(
      utils.normalizeOptions({
        botToken: '0:fixture',
        chatId: 42,
        proxyUrl: proxy.url,
        retryAttempts: 1,
      }),
    );

    const bytes = Buffer.from([0, 255, 13, 10, 128]);
    for (const [kind, method] of [
      ['photo', 'sendPhoto'],
      ['document', 'sendDocument'],
    ]) {
      await client.send({ method, payload: { chat_id: 42, [kind]: bytes } });
      const request = api.requests.at(-1);
      assert.equal(request.method, method);
      const form = await new Response(request.body, {
        headers: { 'content-type': request.headers['content-type'] },
      }).formData();
      assert.deepEqual(Buffer.from(await form.get(kind).arrayBuffer()), bytes);
    }
    assert.equal(api.requests.length, 2);
    console.log(`${process.version}: sendPhoto and sendDocument delivered with intact bytes`);
  } finally {
    for (const cleanup of cleanups) await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
