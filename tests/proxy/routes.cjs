const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const net = require('node:net');
const { join } = require('node:path');
const test = require('node:test');
const { cert, listen, startApi, startConnect, startSocks } = require('./servers.cjs');

const token = '123:fixture-token';
const sender = join(__dirname, 'send.cjs');
const cli = require.resolve('../../dist/cli');

function run(api, proxyUrl, args, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--dns-result-order=ipv4first', '-r', join(__dirname, 'loopback.cjs'), ...args],
      {
        timeout: 8000,
        env: {
          ...process.env,
          NODE_EXTRA_CA_CERTS: cert,
          NODE_TLS_REJECT_UNAUTHORIZED: '1',
          FIXTURE_PORT: String(api.port),
          TELEGRAM_PROXY_URL: proxyUrl,
          TELEGRAM_BOT_TOKEN: token,
          TELEGRAM_CHAT_ID: '42',
          TELEGRAM_THREAD_ID: '7',
          ...env,
        },
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') return reject(error);
        resolve({ code: error?.code ?? 0, output: stdout + stderr });
      },
    );
  });
}

function checkExit(result, expected) {
  assert.equal(result.code, expected, result.output);
  assert.doesNotMatch(result.output, /fixture-token|fixture(%3A|:)secret|wrong-password/i);
}

for (const [protocol, kind, auth, mode] of [
  ['http', 'text', true, 'worker'],
  ['https', 'document', true, 'direct'],
  ['socks5', 'photo', false, 'direct'],
  ['socks5h', 'text', true, 'direct'],
]) {
  test(`${protocol}: ${mode} delivers ${kind} to a topic`, async (t) => {
    const api = await startApi(t);
    const socks = protocol.startsWith('socks');
    const proxy = await (socks ? startSocks : startConnect)(t, api.port, protocol, auth);
    checkExit(await run(api, proxy.url, [sender, mode, kind]), 0);
    assert.deepEqual(
      proxy.targets,
      socks
        ? [
            {
              type: protocol === 'socks5' ? 1 : 3,
              host: protocol === 'socks5' ? '127.0.0.1' : 'localhost',
              port: api.port,
            },
          ]
        : [`localhost:${api.port}`],
    );
    assert.equal(api.requests.length, 1);
    const [{ method, headers, body }] = api.requests;
    assert.equal(headers['proxy-authorization'], undefined);
    if (kind === 'text') {
      assert.equal(method, 'sendMessage');
      const message = JSON.parse(body);
      assert.equal(message.message_thread_id, 7);
      assert.match(message.text, /text fixture/);
    } else {
      assert.equal(method, kind === 'photo' ? 'sendPhoto' : 'sendDocument');
      const form = await new Response(body, {
        headers: { 'content-type': headers['content-type'] },
      }).formData();
      assert.equal(form.get('message_thread_id'), '7');
      const file = form.get(kind);
      assert.equal(file.name, 'fixture.bin');
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), Buffer.from([0, 255, 13, 10, 128]));
    }
  });
}

test('CLI: flag wins over env; no publication without probe; probe and delete use the same route', async (t) => {
  const api = await startApi(t);
  const proxy = await startConnect(t, api.port, 'http', false);
  checkExit(await run(api, 'tg://invalid', [cli, 'check', '--proxy-url', proxy.url]), 0);
  assert.deepEqual(
    api.requests.map((r) => r.method),
    ['getMe', 'getChat'],
  );
  checkExit(await run(api, proxy.url, [cli, 'check', '--probe-message']), 0);
  assert.deepEqual(
    api.requests.map((r) => r.method),
    ['getMe', 'getChat', 'getMe', 'getChat', 'sendMessage', 'deleteMessage'],
  );
  assert.equal(api.requests[4].url.searchParams.get('message_thread_id'), '7');
  assert.equal(api.requests[5].url.searchParams.get('message_id'), '17');
  assert.deepEqual(proxy.targets, Array(6).fill(`localhost:${api.port}`));
});

test('CLI and transport redact credentials echoed by the server', async (t) => {
  const api = await startApi(t, [403, 403]);
  const proxy = await startConnect(t, api.port, 'https');
  const check = await run(api, proxy.url, [cli, 'check']);
  checkExit(check, 1);
  assert.match(check.output, /403/);
  const send = await run(api, proxy.url, [sender, 'default-error']);
  checkExit(send, 0); // Без onDeliveryError транспорт пишет ошибку в stderr.
  assert.match(send.output, /Ошибка доставки/);
  assert.equal(api.requests.length, 2);
});

test('temporary API failures retry through the same proxy', async (t) => {
  const api = await startApi(t, [429, 503, 200]);
  const proxy = await startConnect(t, api.port, 'http', false);
  checkExit(await run(api, proxy.url, [sender, 'direct'], { FIXTURE_ATTEMPTS: '3' }), 0);
  assert.equal(api.requests.length, 3);
  assert.equal(proxy.targets.length, 3);
});

for (const [kind, method] of [
  ['text', 'sendMessage'],
  ['document', 'sendDocument'],
]) {
  test(`${method}: a truncated HTTP 200 response does not repeat the POST`, async (t) => {
    const api = await startApi(t, [
      (res) => {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': 100 });
        res.write('{"ok":');
        res.socket.end();
      },
    ]);
    const proxy = await startConnect(t, api.port, 'http', false);
    const result = await run(api, proxy.url, [sender, 'direct', kind], { FIXTURE_ATTEMPTS: '2' });
    checkExit(result, 1);
    assert.match(result.output, /status: 200/);
    assert.deepEqual(api.requests.map((request) => request.method), [method]);
  });
}

test('SOCKS5 accepts a bracketed IPv6 proxy address', async (t) => {
  const api = await startApi(t);
  const proxy = await startSocks(t, api.port, 'socks5h', false);
  const ipv6 = new URL(proxy.url);
  ipv6.hostname = '[::ffff:127.0.0.1]';
  checkExit(await run(api, ipv6.href, [sender, 'direct']), 0);
  assert.equal(proxy.targets.length, 1);
  assert.equal(api.requests.length, 1);
});

for (const protocol of ['http', 'socks5h']) {
  test(`${protocol}: bad credentials never reach the API or diagnostics`, async (t) => {
    const api = await startApi(t);
    const proxy = await (protocol === 'http' ? startConnect : startSocks)(
      t,
      api.port,
      protocol,
      true,
    );
    const wrong = new URL(proxy.url);
    wrong.password = 'wrong-password';
    const result = await run(api, wrong.href, [cli, 'check']);
    checkExit(result, 1);
    if (protocol === 'http') assert.match(result.output, /407/);
    assert.equal(api.requests.length, 0);
  });
}

for (const protocol of ['http', 'https', 'socks5h']) {
  test(`${protocol}: a stalled handshake times out and releases the socket`, async (t) => {
    const api = await startApi(t);
    let accepted = 0;
    let closed = 0;
    const port = await listen(
      t,
      net.createServer((socket) => {
        accepted++;
        socket.resume();
        socket.on('close', () => closed++);
      }),
    );
    const result = await run(api, `${protocol}://127.0.0.1:${port}`, [sender, 'direct'], {
      FIXTURE_TIMEOUT: '150',
    });
    checkExit(result, 1);
    assert.match(result.output, /Таймаут/);
    assert.equal(accepted, 1);
    assert.equal(closed, 1);
    assert.equal(api.requests.length, 0);
  });
}

test('unavailable proxy: no direct retry', async (t) => {
  const api = await startApi(t);
  const server = net.createServer();
  const port = await listen(t, server);
  await new Promise((resolve) => server.close(resolve));
  checkExit(await run(api, `http://127.0.0.1:${port}`, [cli, 'check']), 1);
  assert.equal(api.requests.length, 0);
});

for (const protocol of ['http', 'https']) {
  test(`${protocol}: rejects an untrusted TLS peer`, async (t) => {
    const api = await startApi(t);
    const proxy = await startConnect(t, api.port, protocol);
    checkExit(await run(api, proxy.url, [cli, 'check'], { NODE_EXTRA_CA_CERTS: '' }), 1);
    assert.equal(proxy.targets.length, protocol === 'https' ? 0 : 1);
    assert.equal(api.requests.length, 0);
  });
}
