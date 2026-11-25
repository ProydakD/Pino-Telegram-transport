const assert = require('node:assert/strict');
const https = require('node:https');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { once } = require('node:events');
const { setImmediate: tick } = require('node:timers/promises');
const { TelegramClient } = require('../../dist/telegram-client');
const utils = require('../../dist/utils');

async function main() {
  assert.equal(typeof global.gc, 'function', 'Run with --expose-gc');
  const read = (name) => readFileSync(join(__dirname, name));
  // Не сохраняем запросы: измеряется клиент, а не история тестового сервера.
  const server = https.createServer(
    {
      key: read('localhost-key.pem'),
      cert: read('localhost-cert.pem'),
    },
    (req, res) => {
      req.resume();
      res.end('{"ok":true}');
    },
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  utils.buildTelegramUrl = () => `https://127.0.0.1:${server.address().port}/sendMessage`;
  const client = new TelegramClient(
    utils.normalizeOptions({
      botToken: '0:fixture',
      chatId: 42,
      requestTimeoutMs: 0,
    }),
  );
  const samples = [];
  try {
    for (let index = 1; index <= 4000; index++) {
      await client.send({ method: 'sendMessage', payload: { chat_id: 42, text: 'fixture' } });
      if (index % 500 === 0) {
        await tick();
        global.gc();
        await tick();
        global.gc();
        samples.push(process.memoryUsage().heapUsed);
        console.log(
          `${process.version}: POST ${index}, heapKiB=${Math.round(samples.at(-1) / 1024)}`,
        );
      }
    }
    // Запас для вариаций GC; исходный дефект удерживал свыше 60 MiB после прогрева.
    assert.ok(samples.at(-1) - samples[0] < 8 * 1024 * 1024, 'Successful POSTs retain heap');
  } finally {
    client.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
