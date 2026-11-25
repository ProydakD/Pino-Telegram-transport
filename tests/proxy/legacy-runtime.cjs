const assert = require('node:assert/strict');
const { join } = require('node:path');
const { run } = require('./run.cjs');
const { startApi, startConnect, startSocks } = require('./servers.cjs');

const cli = require.resolve('../../dist/cli');

function checkDebug(result, marker, action) {
  // При провале сообщаем только факт, не копируя потенциально чувствительный stderr.
  assert.ok(!result.stderr.includes(marker), `${action}: unexpected test token in HTTP debug`);
  assert.ok(/HTTP \d+:/.test(result.stderr), `${action}: HTTP debug was not enabled`);
  assert.equal(result.code, 0, `${action} failed`);
}

async function main() {
  // node:test на 18.12.1 ещё не предоставляет t.after.
  const cleanups = [];
  const fixture = { after: (cleanup) => cleanups.unshift(cleanup) };
  try {
    const api = await startApi(fixture);
    const http = await startConnect(fixture, api.port, 'http', false);
    const debug = { env: { NODE_DEBUG: 'http' } };
    checkDebug(await run(api, http.url, [cli, 'check'], debug), 'fixture-token', 'CLI check');
    assert.deepEqual(
      api.requests.map(({ method }) => method),
      ['getMe', 'getChat'],
    );
    checkDebug(
      await run(api, http.url, [join(__dirname, 'legacy-multipart.cjs')], debug),
      'bot0:fixture',
      'photo and document upload',
    );
    console.log(
      `${process.version}: CLI check, photo and document passed without tokens in HTTP debug`,
    );

    const https = await startConnect(fixture, api.port, 'https', false);
    const socks = await startSocks(fixture, api.port, 'socks5h');
    for (const proxy of [http, https, socks]) {
      const url = new URL(proxy.url);
      url.hostname = 'localhost';
      const result = await run(api, url.href, [cli, 'check'], {
        env: { FIXTURE_DUAL_STACK: '1', FIXTURE_API_HOST: '127.0.0.1' },
      });
      assert.equal(result.code, 0, `${url.protocol} check failed: ${result.output}`);
      console.log(`${url.protocol} IPv4 proxy reachable after IPv6 refusal`);
    }
    assert.deepEqual(https.serverNames, ['localhost']);
    assert.equal(api.requests.length, 8);
    assert.deepEqual([http.targets.length, https.targets.length, socks.targets.length], [2, 1, 1]);
  } finally {
    for (const cleanup of cleanups) await cleanup();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
