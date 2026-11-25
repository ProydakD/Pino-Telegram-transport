const assert = require('node:assert/strict');
const dns = require('node:dns');
const { readFileSync } = require('node:fs');
const net = require('node:net');
const test = require('node:test');
const { setTimeout: delay } = require('node:timers/promises');
const tls = require('node:tls');
const { TelegramClient } = require('../../dist/telegram-client');
const utils = require('../../dist/utils');
const { token } = require('./run.cjs');
const { cert, startApi, startConnect, startSocks } = require('./servers.cjs');

const request = { method: 'sendMessage', payload: { chat_id: 42, text: 'TCP fixture' } };
const ca = readFileSync(cert);

async function startRoute(t, protocol, { backup = true, onConnect } = {}) {
  const api = await startApi(t);
  const startProxy = (address) =>
    protocol === 'socks5h'
      ? startSocks(t, api.port, protocol, address)
      : startConnect(t, api.port, protocol, false, address);
  const first = await startProxy({ host: '::1', onConnect });
  const port = Number(new URL(first.url).port);
  const second = backup ? await startProxy({ port }) : undefined;
  const lookup = dns.lookup;
  t.mock.method(dns, 'lookup', (host, options, callback) => {
    if (host !== 'localhost') return lookup(host, options, callback);
    assert.equal(options.all, true);
    queueMicrotask(() =>
      callback(null, [
        { address: '::1', family: 6 },
        { address: '::1', family: 6 }, // Один и тот же IP не должен создавать второй сокет.
        { address: '127.0.0.1', family: 4 },
      ]),
    );
  });
  t.mock.method(utils, 'buildTelegramUrl', () => `https://localhost:${api.port}/sendMessage`);
  const connectTls = tls.connect;
  // Доверяем только тестовому CA; проверка имени TLS остаётся включённой.
  t.mock.method(tls, 'connect', (options) => connectTls({ ca, ...options }));
  const client = (timeout) => {
    const instance = new TelegramClient(
      utils.normalizeOptions({
        botToken: token,
        chatId: 42,
        proxyUrl: `${protocol}://localhost:${port}`,
        retryAttempts: 1,
        requestTimeoutMs: timeout,
      }),
    );
    t.after(() => instance.close());
    return instance;
  };
  return { api, first, second, port, client };
}

function controlDials(t, port, { holdBoth = false, refuseBackup = false } = {}) {
  const connect = net.Socket.prototype.connect;
  const dials = [];
  let markSecond;
  const secondStarted = new Promise((resolve) => (markSecond = resolve));
  let markRefused;
  const backupRefused = new Promise((resolve) => (markRefused = resolve));
  t.mock.method(net.Socket.prototype, 'connect', function (...args) {
    const options = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (options?.port !== port) return connect.apply(this, args);

    // Задерживаем завершение именно TCP, до первого байта HTTP/TLS/SOCKS.
    const socket = this;
    const resume = () => {
      if (!socket.destroyed) {
        socket.connecting = false;
        connect.apply(socket, args);
      }
    };
    dials.push({ socket, resume });
    if (dials.length === 2) markSecond();
    if (dials.length === 1 || holdBoth) {
      socket.connecting = true;
      return socket;
    }
    if (refuseBackup) {
      socket.once('error', markRefused);
      queueMicrotask(() =>
        socket.destroy(
          Object.assign(new Error('fixture TCP refusal'), {
            code: 'ECONNREFUSED',
            syscall: 'connect',
          }),
        ),
      );
      return socket;
    }
    return connect.apply(socket, args);
  });
  return { dials, secondStarted, backupRefused };
}

for (const protocol of ['http', 'https', 'socks5h']) {
  test(`${protocol}: a stuck first TCP dial does not consume the only attempt`, async (t) => {
    const route = await startRoute(t, protocol);
    const { dials } = controlDials(t, route.port);
    const client = route.client(1500);
    await client.send(request);
    assert.equal(dials.length, 2);
    assert.equal(dials[0].socket.destroyed, true);
    dials[0].resume();
    client.close();
    assert.ok(dials.every(({ socket }) => socket.destroyed));
    assert.deepEqual([route.first.targets.length, route.second.targets.length], [0, 1]);
    assert.deepEqual(
      route.api.requests.map(({ verb }) => verb),
      ['POST'],
    );
  });
}

test('TCP selection: a refused backup leaves the slow first dial alive', async (t) => {
  const route = await startRoute(t, 'http', { backup: false });
  const { dials, backupRefused } = controlDials(t, route.port, { refuseBackup: true });
  const delivery = route.client(1500).send(request);
  await Promise.race([backupRefused, delivery]);
  assert.equal(dials[0].socket.destroyed, false);
  dials[0].resume();
  await delivery;
  assert.equal(dials.length, 2);
  assert.equal(route.first.connections, 1);
  assert.equal(route.first.targets.length, 1);
  assert.deepEqual(
    route.api.requests.map(({ verb }) => verb),
    ['POST'],
  );
});

for (const cancel of ['deadline', 'destroy']) {
  test(`TCP selection: ${cancel} closes every pending dial without a late CONNECT`, async (t) => {
    const route = await startRoute(t, 'http');
    const { dials, secondStarted } = controlDials(t, route.port, { holdBoth: true });
    const client = route.client(cancel === 'deadline' ? 1000 : 0);
    const outcome = client.send(request).catch((error) => error);
    if (cancel === 'destroy') {
      const timer = new AbortController();
      try {
        await Promise.race([
          secondStarted,
          outcome.then(() => assert.fail('delivery finished before destroy')),
          delay(2500, undefined, { signal: timer.signal }).then(() =>
            assert.fail('no second TCP dial'),
          ),
        ]);
      } finally {
        timer.abort();
        client.close();
      }
    }
    const error = await outcome;
    if (cancel === 'deadline') assert.equal(error?.isTimeout, true);
    else assert.equal(error?.message, 'Транспорт Telegram закрыт');
    assert.equal(dials.length, 2);
    assert.ok(dials.every(({ socket }) => socket.destroyed));
    for (const dial of dials) dial.resume();
    assert.deepEqual([route.first.connections, route.second.connections], [0, 0]);
    assert.deepEqual(route.api.requests, []);
  });
}

test('a slow CONNECT reply is not a slow TCP dial', async (t) => {
  const route = await startRoute(t, 'http', {
    onConnect(socket, accept) {
      // Ответ CONNECT задержан дольше окна запуска запасного TCP-подключения.
      const timer = setTimeout(accept, 600);
      socket.once('close', () => clearTimeout(timer));
    },
  });
  await route.client(2000).send(request);
  assert.deepEqual([route.first.targets.length, route.second.connections], [1, 0]);
  assert.deepEqual(
    route.api.requests.map(({ verb }) => verb),
    ['POST'],
  );
});
