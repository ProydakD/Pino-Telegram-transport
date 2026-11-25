const assert = require('node:assert/strict');
const dns = require('node:dns');
const { once } = require('node:events');
const net = require('node:net');
const { join } = require('node:path');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const telegramTransport = require('../../dist').default;
const { TelegramClient } = require('../../dist/telegram-client');
const { normalizeOptions } = require('../../dist/utils');
const { run, token } = require('./run.cjs');
const { listen, startApi, startConnect, startSocks } = require('./servers.cjs');

const socksCredentials = { user: 'user', password: 'fixture:secret' };
const sender = join(__dirname, 'send.cjs');
const cli = require.resolve('../../dist/cli');

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
    const proxy = await (socks
      ? startSocks(t, api.port, protocol, { credentials: auth ? socksCredentials : undefined })
      : startConnect(t, api.port, protocol, auth));
    checkExit(await run(api, proxy.url, [sender, mode, kind]), 0);
    assert.equal(proxy.targets.length, 1);
    if (protocol === 'socks5') {
      const [target] = proxy.targets;
      assert.ok([1, 4].includes(target.type), 'SOCKS5 must send a locally resolved IP');
      assert.equal(target.port, api.port);
    } else if (protocol === 'socks5h') {
      assert.deepEqual(proxy.targets, [{ type: 3, host: 'localhost', port: api.port }]);
    } else {
      assert.deepEqual(proxy.targets, [`localhost:${api.port}`]);
    }
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

test('a deadline while reading HTTP 200 retains the status and does not repeat the POST', async (t) => {
  const api = await startApi(t, [
    (res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': 100 });
      res.write('{"ok":');
    },
  ]);
  const proxy = await startConnect(t, api.port, 'http', false);
  const result = await run(api, proxy.url, [sender, 'direct'], {
    env: { FIXTURE_ATTEMPTS: '2', FIXTURE_TIMEOUT: '500' },
  });
  checkExit(result, 1);
  assert.match(result.output, /status: 200, isTimeout: true/);
  assert.equal(api.requests.length, 1);
});

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
  // Каждый запуск CLI использует один туннель независимо от числа шагов проверки.
  assert.deepEqual(proxy.targets, Array(2).fill(`localhost:${api.port}`));
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

test('CONNECT uses port 443 independently of the stack trace limit', async (t) => {
  const api = await startApi(t);
  const proxy = await startConnect(t, api.port, 'http', false);
  const observed = [];
  for (const depth of [10, 4, 0]) {
    const before = proxy.targets.length;
    const result = await run(api, proxy.url, [cli, 'check'], {
      env: { FIXTURE_PORT: '', NODE_OPTIONS: `--stack-trace-limit=${depth}` },
    });
    observed.push({ exit: result.code, target: proxy.targets[before] ?? null });
  }
  assert.deepEqual(observed, Array(3).fill({ exit: 0, target: 'localhost:443' }));
  assert.equal(api.requests.length, 6);
});

test('temporary API failures retry through the same proxy', async (t) => {
  const api = await startApi(t, [429, 503, 200]);
  const proxy = await startConnect(t, api.port, 'http', false);
  checkExit(await run(api, proxy.url, [sender, 'direct'], { env: { FIXTURE_ATTEMPTS: '3' } }), 0);
  assert.equal(api.requests.length, 3);
  assert.deepEqual(proxy.targets, [`localhost:${api.port}`]);
});

test('SOCKS5: end drains five messages through the same tunnel', async (t) => {
  const api = await startApi(t);
  const proxy = await startSocks(t, api.port, 'socks5h');
  const result = await run(api, proxy.url, [sender, 'direct'], { env: { FIXTURE_MESSAGES: '5' } });
  checkExit(result, 0);
  assert.equal(api.requests.length, 5);
  assert.equal(proxy.targets.length, 1);
});

for (const protocol of ['https', 'socks5h']) {
  test(`${protocol}: cancelling a request does not close another tunnel in the same agent`, async (t) => {
    const api = await startApi(t, (url) => {
      if (url.searchParams.has('stall')) {
        // Принять запрос, но не отвечать до отмены со стороны клиента.
        return () => undefined;
      }
      return 200;
    });
    const proxy = await (protocol === 'https'
      ? startConnect(t, api.port, protocol, false)
      : startSocks(t, api.port, protocol));
    const result = await run(api, proxy.url, [join(__dirname, 'agent-isolation.cjs')]);
    checkExit(result, 0);
    assert.equal(api.requests.length, 4);
    assert.equal(proxy.targets.length, 2);
  });
}

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
    const result = await run(api, proxy.url, [sender, 'direct', kind], {
      env: { FIXTURE_ATTEMPTS: '2' },
    });
    checkExit(result, 1);
    assert.match(result.output, /status: 200/);
    assert.deepEqual(
      api.requests.map((request) => request.method),
      [method],
    );
  });
}

test('SOCKS5 accepts a bracketed IPv6 proxy address', async (t) => {
  const api = await startApi(t);
  const proxy = await startSocks(t, api.port, 'socks5h');
  const ipv6 = new URL(proxy.url);
  ipv6.hostname = '[::ffff:127.0.0.1]';
  checkExit(await run(api, ipv6.href, [sender, 'direct']), 0);
  assert.equal(proxy.targets.length, 1);
  assert.equal(api.requests.length, 1);
});

test('HTTP CONNECT: bad credentials are reported as 407 without reaching the API', async (t) => {
  const api = await startApi(t);
  const proxy = await startConnect(t, api.port, 'http');
  const wrong = new URL(proxy.url);
  wrong.password = 'wrong-password';
  const result = await run(api, wrong.href, [cli, 'check']);
  checkExit(result, 1);
  assert.match(result.output, /407/);
  assert.equal(api.requests.length, 0);
});

test('SOCKS5: an explicit authentication refusal is safe and is not retried', async (t) => {
  const api = await startApi(t);
  const proxy = await startSocks(t, api.port, 'socks5h', { credentials: socksCredentials });
  const wrong = new URL(proxy.url);
  wrong.password = 'wrong-password';
  const check = await run(api, wrong.href, [cli, 'check']);
  checkExit(check, 1);
  assert.match(check.output, /отклонил авторизацию/);
  assert.equal(proxy.authAttempts, 1);

  const send = await run(api, wrong.href, [sender, 'direct'], { env: { FIXTURE_ATTEMPTS: '3' } });
  checkExit(send, 1);
  assert.match(send.output, /отклонил авторизацию/);
  assert.equal(proxy.authAttempts, 2);
  assert.equal(proxy.targets.length, 0);
  assert.equal(api.requests.length, 0);
});

for (const reply of [2, 7]) {
  test(`SOCKS5: CONNECT reply ${reply} is retained and not retried`, async (t) => {
    const api = await startApi(t);
    const proxy = await startSocks(t, api.port, 'socks5h', { connectReply: () => reply });
    const client = new TelegramClient(
      normalizeOptions({ botToken: token, chatId: 42, proxyUrl: proxy.url }),
    );
    t.after(() => client.close());
    const failure = await client
      .send({ method: 'sendMessage', payload: { chat_id: 42, text: 'refused' } })
      .catch((error) => error);
    assert.deepEqual({ attempts: proxy.targets.length, reply: failure?.cause?.reply }, {
      attempts: 1,
      reply,
    });
    assert.match(failure.message, new RegExp(`код ${reply}`));
    assert.equal(api.requests.length, 0);
  });
}

test('HTTPS CONNECT: an untrusted proxy certificate is not retried', async (t) => {
  const api = await startApi(t);
  const proxy = await startConnect(t, api.port, 'https', false);
  const result = await run(api, proxy.url, [sender, 'direct'], {
    env: { FIXTURE_ATTEMPTS: '3', NODE_EXTRA_CA_CERTS: '' },
  });
  checkExit(result, 1);
  assert.equal(proxy.connections, 1);
  assert.match(result.output, /DEPTH_ZERO_SELF_SIGNED_CERT/);
  assert.equal(proxy.targets.length, 0);
  assert.equal(api.requests.length, 0);
});

test('SOCKS5: a transient network failure still retries', async (t) => {
  const api = await startApi(t);
  let accepted = 0;
  const proxy = await startSocks(t, api.port, 'socks5h', {
    beforeGreeting(socket) {
      if (++accepted === 1) socket.end();
    },
  });
  const result = await run(api, proxy.url, [sender, 'direct'], { env: { FIXTURE_ATTEMPTS: '2' } });
  checkExit(result, 0);
  assert.equal(accepted, 2);
  assert.equal(api.requests.length, 1);
});

test('SOCKS5: 255-byte credentials work and are absent from extended debug output', async (t) => {
  const api = await startApi(t);
  const credentials = { user: `u${'я'.repeat(127)}`, password: `socks-fixture${'ю'.repeat(121)}` };
  assert.equal(Buffer.byteLength(credentials.user), 255);
  assert.equal(Buffer.byteLength(credentials.password), 255);
  const proxy = await startSocks(t, api.port, 'socks5h', { credentials });
  const result = await run(api, proxy.url, [sender, 'direct'], {
    env: { DEBUG: '*', DEBUG_SHOW_HIDDEN: '1' },
  });
  checkExit(result, 0);
  assert.doesNotMatch(result.output, /socks-fixture/);
  assert.equal(proxy.authAttempts, 1);
  assert.equal(api.requests.length, 1);
});

for (const field of ['username', 'password']) {
  test(`SOCKS5: a 256-byte ${field} is rejected by the transport and CLI before TCP`, async (t) => {
    let connections = 0;
    const port = await listen(
      t,
      net.createServer((socket) => {
        connections++;
        socket.destroy();
      }),
    );
    const proxy = new URL(`socks5h://user:secret@127.0.0.1:${port}`);
    proxy[field] = 'я'.repeat(128);
    const cliResult = await run({ port }, proxy.href, [cli, 'check']);
    checkExit(cliResult, 1);
    assert.match(cliResult.output, /255 байт/);
    const transport = await run({ port }, proxy.href, [sender, 'direct']);
    checkExit(transport, 0);
    assert.match(transport.output, /transport disabled:.*255 байт/);
    assert.doesNotMatch(cliResult.output + transport.output, /яя|%D1%8F/i);
    assert.equal(connections, 0);
  });
}

for (const [reply, acceptsFallback] of [
  [8, true],
  [2, false],
]) {
  test(`local SOCKS5 DNS: ${acceptsFallback ? 'tries IPv4 after IPv6 fails' : 'does not fall back after a policy refusal'}`, async (t) => {
    const api = await startApi(t);
    const proxy = await startSocks(t, api.port, 'socks5', {
      connectReply: ({ type }) => (type === 4 ? reply : 0),
    });
    const result = await run(api, proxy.url, [sender, 'direct'], {
      env: { FIXTURE_DUAL_STACK: '1' },
    });
    checkExit(result, acceptsFallback ? 0 : 1);
    const ipv6 = { type: 4, host: '0:0:0:0:0:0:0:1', port: api.port };
    const ipv4 = { type: 1, host: '127.0.0.1', port: api.port };
    assert.deepEqual(proxy.targets, acceptsFallback ? [ipv6, ipv4] : [ipv6]);
    assert.equal(api.requests.length, acceptsFallback ? 1 : 0);
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
      env: { FIXTURE_TIMEOUT: '150' },
    });
    checkExit(result, 1);
    assert.match(result.output, /Таймаут/);
    assert.equal(accepted, 1);
    assert.equal(closed, 1);
    assert.equal(api.requests.length, 0);
  });
}

test(
  'SOCKS5: the deadline closes a stalled handshake after slow DNS while the client is alive',
  { timeout: 5000 },
  async (t) => {
    let accepted = 0;
    let markClosed;
    const closed = new Promise((resolve) => (markClosed = resolve));
    const port = await listen(
      t,
      net.createServer((socket) => {
        accepted++;
        socket.resume();
        socket.once('close', () => markClosed(performance.now()));
      }),
    );
    const lookup = dns.lookup;
    t.mock.method(dns, 'lookup', (host, options, callback) => {
      if (host !== 'api.telegram.org') return lookup(host, options, callback);
      if (typeof options === 'function') callback = options;
      setTimeout(() => {
        if (options.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
        else callback(null, '127.0.0.1', 4);
      }, 350);
    });
    const client = new TelegramClient(
      normalizeOptions({
        botToken: token,
        chatId: 42,
        proxyUrl: `socks5://127.0.0.1:${port}`,
        requestTimeoutMs: 650,
        retryAttempts: 1,
      }),
    );
    t.after(() => client.close());
    await assert.rejects(
      client.send({ method: 'sendMessage', payload: { chat_id: 42, text: 'deadline' } }),
      { isTimeout: true },
    );
    const errorAt = performance.now();
    assert.equal(accepted, 1);
    const closeDelay = (await closed) - errorAt;
    assert.ok(closeDelay < 200, `proxy socket closed ${closeDelay}ms after the deadline`);
  },
);

test(
  'SOCKS5: timeout zero allows a handshake longer than 30 seconds',
  { timeout: 45_000 },
  async (t) => {
    const api = await startApi(t);
    const proxy = await startSocks(t, api.port, 'socks5h', {
      beforeGreeting: () => delay(30_300),
    });
    const result = await run(api, proxy.url, [sender, 'direct'], {
      env: { FIXTURE_TIMEOUT: '0' },
      timeout: 40_000,
    });
    checkExit(result, 0);
    assert.equal(proxy.targets.length, 1);
    assert.equal(api.requests.length, 1);
  },
);

test(
  'destroy releases the pending SOCKS5 handshake and skips queued logs with default retries',
  { timeout: 2000 },
  async (t) => {
    const server = net.createServer((socket) => socket.resume());
    const port = await listen(t, server);
    const formatted = [];
    const failures = [];
    const transport = telegramTransport({
      botToken: token,
      chatId: 42,
      proxyUrl: `socks5h://127.0.0.1:${port}`,
      requestTimeoutMs: 0,
      formatMessage: ({ log }) => {
        formatted.push(log.msg);
        return { text: log.msg };
      },
      onDeliveryError: (error) => failures.push(error.message),
    });
    t.after(() => transport.destroy());
    const connection = once(server, 'connection');
    transport.write('{"level":30,"msg":"active"}\n{"level":30,"msg":"queued"}\n');
    const [socket] = await connection;
    const closed = once(socket, 'close');
    transport.destroy();
    await closed;
    await new Promise((resolve, reject) => {
      transport.flush((error) => (error ? reject(error) : resolve()));
    });
    assert.deepEqual(formatted, ['active']);
    assert.deepEqual(failures, []);
  },
);

test('unavailable proxy: no direct retry', async (t) => {
  const api = await startApi(t);
  const server = net.createServer();
  const port = await listen(t, server);
  await new Promise((resolve) => server.close(resolve));
  const options = { env: { FIXTURE_API_HOST: '127.0.0.1' } };
  checkExit(await run(api, `http://127.0.0.1:${port}`, [cli, 'check'], options), 1);
  assert.equal(api.requests.length, 0);
  checkExit(await run(api, undefined, [cli, 'check'], options), 0);
  assert.deepEqual(
    api.requests.map((request) => request.method),
    ['getMe', 'getChat'],
  );
});

for (const protocol of ['http', 'https', 'socks5h']) {
  test(`${protocol}: rejects an untrusted TLS peer`, async (t) => {
    const api = await startApi(t);
    const proxy = await (protocol === 'socks5h'
      ? startSocks(t, api.port, protocol)
      : startConnect(t, api.port, protocol));
    checkExit(await run(api, proxy.url, [cli, 'check'], { env: { NODE_EXTRA_CA_CERTS: '' } }), 1);
    assert.equal(proxy.targets.length, protocol === 'https' ? 0 : 1);
    assert.equal(api.requests.length, 0);
  });
}
