const assert = require('node:assert/strict');
const { join } = require('node:path');
const test = require('node:test');
const { run } = require('./run.cjs');
const { startApi, startConnect, startSocks } = require('./servers.cjs');

const sender = join(__dirname, 'send.cjs');
const cli = require.resolve('../../dist/cli');
const now = Date.UTC(2026, 0, 2, 3, 4, 5);
const retryClock = {
  FIXTURE_ATTEMPTS: '2',
  FIXTURE_INITIAL_DELAY: '100',
  FIXTURE_MAX_DELAY: '10000',
  FIXTURE_RETRY_CLOCK: String(now),
};

function refuse(socket, status, ...retryAfter) {
  const headers = retryAfter.map((value) => `Retry-After: ${value}\r\n`).join('');
  socket.end(`HTTP/1.1 ${status} fixture-private-reason\r\n${headers}Content-Length: 0\r\n\r\n`);
}

function plannedWaits(result) {
  return [...result.output.matchAll(/fixture wait: (\d+)/g)].map(([, ms]) => Number(ms));
}

function methods(api) {
  return api.requests.map(({ verb, method }) => `${verb} ${method}`);
}

test('SOCKS5: a stalled destination CONNECT leaves budget for the next IP', async (t) => {
  const api = await startApi(t);
  const proxy = await startSocks(t, api.port, 'socks5', {
    connectReply: ({ type }) => (type === 4 ? 'stall' : 0),
  });
  const result = await run(api, proxy.url, [sender, 'direct'], {
    env: { FIXTURE_DUAL_STACK: '1', FIXTURE_TIMEOUT: '1000', FIXTURE_ATTEMPTS: '1' },
  });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(
    proxy.targets.map(({ type }) => type),
    [4, 1],
  );
  assert.deepEqual(methods(api), ['POST sendMessage']);
});

async function startProxyPair(t, api, protocol, onConnect) {
  const first = await startConnect(t, api.port, protocol, false, { host: '::1', onConnect });
  const { port } = new URL(first.url);
  const second = await startConnect(t, api.port, protocol, false, { port: Number(port) });
  return { first, second, url: `${protocol}://localhost:${port}` };
}

test('CONNECT: Retry-After seconds delay the next CONNECT and only one POST reaches Telegram', async (t) => {
  const api = await startApi(t);
  const connectTimes = [];
  const proxy = await startConnect(t, api.port, 'http', false, {
    onConnect(socket, accept) {
      connectTimes.push(performance.now());
      if (connectTimes.length === 1) refuse(socket, 503, '2');
      else accept();
    },
  });
  const result = await run(api, proxy.url, [sender, 'direct'], {
    env: { FIXTURE_ATTEMPTS: '2' },
  });
  assert.equal(result.code, 0, result.output);
  assert.equal(proxy.connections, 2);
  assert.deepEqual(methods(api), ['POST sendMessage']);
  const elapsed = connectTimes[1] - connectTimes[0];
  assert.ok(elapsed >= 2000, `second CONNECT arrived after ${elapsed}ms`);
});

for (const [name, headers, expected] of [
  ['IMF-fixdate', [new Date(now + 3000).toUTCString()], 3000],
  ['RFC 850 date', ['Friday, 02-Jan-26 03:04:08 GMT'], 3000],
  ['asctime date', ['Fri Jan  2 03:04:08 2026'], 3000],
  ['the exact cap', ['10'], 10000],
  ['a past date', [new Date(now - 1000).toUTCString()], 100],
  ['zero seconds', ['0'], 100],
  ['no header', [], 100],
  ['invalid fractional seconds', ['2.5'], 100],
  ['invalid negative seconds', ['-2'], 100],
  ['invalid date', ['Fri, 31 Apr 2026 03:04:08 GMT'], 100],
  ['a list of seconds', ['2, 3'], 100],
  ['duplicate fields', ['2', new Date(now + 3000).toUTCString()], 100],
]) {
  test(`CONNECT: retry delay for ${name}`, async (t) => {
    const api = await startApi(t);
    let connectCount = 0;
    const proxy = await startConnect(t, api.port, 'http', false, {
      onConnect(socket, accept) {
        if (++connectCount === 1) refuse(socket, 429, ...headers);
        else accept();
      },
    });
    const result = await run(api, proxy.url, [sender, 'direct'], { env: retryClock });
    assert.equal(result.code, 0, result.output);
    assert.equal(proxy.connections, 2);
    assert.deepEqual(methods(api), ['POST sendMessage']);
    assert.deepEqual(plannedWaits(result), [expected]);
  });
}

test('CONNECT: a hint above the cap fails only that record without a retry or pause', async (t) => {
  const api = await startApi(t);
  let connectCount = 0;
  const proxy = await startProxyPair(t, api, 'http', (socket, accept) => {
    if (++connectCount === 1) refuse(socket, 503, '60');
    else accept();
  });
  const result = await run(api, proxy.url, [sender, 'direct'], {
    env: { ...retryClock, FIXTURE_ATTEMPTS: '3', FIXTURE_MESSAGES: '2', FIXTURE_DUAL_STACK: '1' },
  });
  assert.deepEqual([proxy.first.targets.length, proxy.second.connections], [2, 0]);
  assert.deepEqual(methods(api), ['POST sendMessage']);
  assert.match(JSON.parse(api.requests[0].body).text, /text fixture 1/);
  assert.equal(result.code, 1, result.output);
  assert.deepEqual(plannedWaits(result), []);
  assert.equal((result.stderr.match(/Proxy CONNECT failed \(HTTP 503\)/g) ?? []).length, 1);
  assert.doesNotMatch(result.output, /fixture-private-reason|fixture-token/);
});

test('Telegram: retry_after above retryMaxDelay still controls the next POST', async (t) => {
  const api = await startApi(t, [
    (res) => {
      res.writeHead(429, { 'Retry-After': '99' });
      res.end(JSON.stringify({ ok: false, parameters: { retry_after: 60 } }));
    },
  ]);
  const proxy = await startConnect(t, api.port, 'http', false);
  const result = await run(api, proxy.url, [sender, 'direct'], { env: retryClock });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual(plannedWaits(result), [60000]);
  assert.equal(proxy.targets.length, 1);
  assert.deepEqual(methods(api), ['POST sendMessage', 'POST sendMessage']);
});

for (const [cap, expectedConnects] of [
  [500, 1],
  [1000, 2],
]) {
  test(`CONNECT: configured cap ${cap} stays below the initial backoff`, async (t) => {
    const api = await startApi(t);
    let connects = 0;
    const proxy = await startConnect(t, api.port, 'http', false, {
      onConnect(socket, accept) {
        if (++connects === 1) refuse(socket, 503, '1');
        else accept();
      },
    });
    const result = await run(api, proxy.url, [sender, 'direct'], {
      env: { ...retryClock, FIXTURE_INITIAL_DELAY: '1200', FIXTURE_MAX_DELAY: String(cap) },
    });
    assert.equal(result.code, cap === 500 ? 1 : 0, result.output);
    assert.equal(connects, expectedConnects);
    assert.equal(api.requests.length, expectedConnects - 1);
    assert.deepEqual(plannedWaits(result), cap === 500 ? [] : [1200]);
  });
}

for (const status of [429, 503]) {
  test(`CONNECT: HTTP ${status} advances to the next proxy IP on the allowed retry`, async (t) => {
    const api = await startApi(t);
    const proxy = await startProxyPair(t, api, 'http', (socket) => refuse(socket, status, '2'));
    const kind = status === 503 ? 'document' : 'text';
    const result = await run(api, proxy.url, [sender, 'direct', kind], {
      env: { ...retryClock, FIXTURE_DUAL_STACK: '1' },
    });
    assert.deepEqual([proxy.first.targets.length, proxy.second.targets.length], [1, 1]);
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(plannedWaits(result), [2000]);
    assert.deepEqual(methods(api), [
      kind === 'document' ? 'POST sendDocument' : 'POST sendMessage',
    ]);
  });
}

test('CONNECT: the rotated starting IP is not saved for the next delivery', async (t) => {
  const api = await startApi(t, [
    (res) => {
      res.writeHead(200, { Connection: 'close' });
      res.end('{"ok":true}');
    },
  ]);
  let primaryConnects = 0;
  const proxy = await startProxyPair(t, api, 'http', (socket, accept) => {
    if (++primaryConnects === 1) refuse(socket, 503);
    else accept();
  });
  const result = await run(api, proxy.url, [sender, 'direct'], {
    env: { ...retryClock, FIXTURE_DUAL_STACK: '1', FIXTURE_MESSAGES: '2' },
  });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual([proxy.first.targets.length, proxy.second.targets.length], [2, 1]);
  assert.deepEqual(plannedWaits(result), [100]);
  assert.deepEqual(methods(api), ['POST sendMessage', 'POST sendMessage']);
});

for (const [status, attempts, command] of [
  [503, '1', [sender, 'direct']],
  [403, '3', [sender, 'direct']],
  [407, '3', [sender, 'direct']],
  [503, '3', [cli, 'check']],
]) {
  test(`CONNECT: HTTP ${status} does not rotate in ${command[1]} with ${attempts} allowed attempts`, async (t) => {
    const api = await startApi(t);
    const proxy = await startProxyPair(t, api, 'http', (socket) => refuse(socket, status, '2'));
    const result = await run(api, proxy.url, command, {
      env: { ...retryClock, FIXTURE_DUAL_STACK: '1', FIXTURE_ATTEMPTS: attempts },
    });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(result.output, /fixture-private-reason/);
    assert.deepEqual(plannedWaits(result), []);
    assert.deepEqual([proxy.first.targets.length, proxy.second.connections], [1, 0]);
    assert.deepEqual(methods(api), []);
  });
}

test('HTTPS CONNECT: TLS trust failure does not open the second proxy IP', async (t) => {
  const api = await startApi(t);
  const proxy = await startProxyPair(t, api, 'https');
  const result = await run(api, proxy.url, [sender, 'direct'], {
    env: { ...retryClock, FIXTURE_DUAL_STACK: '1', NODE_EXTRA_CA_CERTS: '' },
  });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /DEPTH_ZERO_SELF_SIGNED_CERT/);
  assert.deepEqual([proxy.first.connections, proxy.second.connections], [1, 0]);
  assert.equal(proxy.first.targets.length, 0);
  assert.deepEqual(methods(api), []);
});

test('HTTPS CONNECT: the Bot API certificate is checked against the Bot API host', async (t) => {
  const api = await startApi(t);
  const proxy = await startProxyPair(t, api, 'https');
  const result = await run(api, proxy.url, [sender, 'direct'], {
    env: { ...retryClock, FIXTURE_DUAL_STACK: '1', FIXTURE_API_HOST: '127.0.0.2' },
  });
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /ERR_TLS_CERT_ALTNAME_INVALID/);
  assert.deepEqual(proxy.first.serverNames, ['localhost']);
  assert.deepEqual(proxy.first.targets, [`127.0.0.2:${api.port}`]);
  assert.equal(proxy.second.connections, 0);
  assert.deepEqual(methods(api), []);
});

test('Telegram: an API 503 on a closing tunnel does not rotate the proxy IP', async (t) => {
  const api = await startApi(t, [
    (res) => {
      res.writeHead(503, { Connection: 'close' });
      res.end('{"ok":false}');
    },
  ]);
  const proxy = await startProxyPair(t, api, 'http');
  const result = await run(api, proxy.url, [sender, 'direct'], {
    env: { ...retryClock, FIXTURE_DUAL_STACK: '1' },
  });
  assert.equal(result.code, 0, result.output);
  assert.deepEqual([proxy.first.targets.length, proxy.second.connections], [2, 0]);
  assert.deepEqual(methods(api), ['POST sendMessage', 'POST sendMessage']);
});
