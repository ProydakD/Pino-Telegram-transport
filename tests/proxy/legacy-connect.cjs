const assert = require('node:assert/strict');
const { run } = require('./run.cjs');
const { startApi, startConnect } = require('./servers.cjs');

async function main() {
  const cleanups = [];
  const fixture = { after: (cleanup) => cleanups.unshift(cleanup) };
  try {
    const api = await startApi(fixture);
    for (const [status, headers, attempts, wait] of [
      [407, [], 1, undefined],
      [503, ['1'], 2, 1000],
      [503, ['1', '2'], 2, 100],
    ]) {
      const before = api.requests.length;
      let connects = 0;
      const proxy = await startConnect(fixture, api.port, 'http', false, {
        onConnect(socket, accept) {
          if (++connects > 1) return accept();
          socket.end(`HTTP/1.1 ${status} Fixture\r\n${headers.map((value) => `Retry-After: ${value}\r\n`).join('')}Content-Length: 0\r\n\r\n`);
        },
      });
      // Прямой транспорт не зависит от Pino 10, которому нужна более новая Node.
      const result = await run(api, proxy.url, ['-e', `
        const utils = require('./dist/utils');
        utils.waitForDelay = async (ms) => console.log('fixture wait: ' + ms);
        const stream = require('./dist').default({
          botToken: '0:fixture', chatId: 42, proxyUrl: process.env.TELEGRAM_PROXY_URL,
          retryAttempts: 2, retryInitialDelay: 100,
          onDeliveryError: (error) => { console.error(error.message); process.exitCode = 1; }
        });
        stream.end(JSON.stringify({level: 30, msg: 'fixture'}) + '\\n');
      `]);
      assert.equal(result.code, status === 407 ? 1 : 0, result.output);
      assert.doesNotMatch(result.output, /TypeError/);
      if (status === 407) assert.match(result.output, /HTTP 407/);
      assert.equal(connects, attempts);
      assert.equal(api.requests.length - before, attempts - 1);
      const waits = [...result.output.matchAll(/fixture wait: (\d+)/g)].map(([, ms]) => Number(ms));
      assert.deepEqual(waits, wait === undefined ? [] : [wait]);
      console.log(`${process.version}: CONNECT ${status}, headers=${headers.length}, attempts=${connects}, waits=${waits}`);
    }
  } finally {
    for (const cleanup of cleanups) await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
