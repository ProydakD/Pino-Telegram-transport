const assert = require('node:assert/strict');
const { spawnSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { readFileSync, mkdtempSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const https = require('node:https');
const test = require('node:test');
const { listen } = require('./servers.cjs');

test('HTTPS proxy: weak certificate key is permanent without relaxing client TLS', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pino-weak-tls-'));
  const windowsOpenSsl = 'C:/Program Files/Git/usr/bin/openssl.exe';
  const openssl = process.env.OPENSSL ?? (existsSync(windowsOpenSsl) ? windowsOpenSsl : 'openssl');
  for (const args of [
    [
      'req',
      '-x509',
      '-nodes',
      '-newkey',
      'rsa:2048',
      '-keyout',
      'ca.key',
      '-out',
      'ca.pem',
      '-days',
      '2',
      '-subj',
      '/CN=Local test CA',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
    ],
    [
      'req',
      '-new',
      '-nodes',
      '-newkey',
      'rsa:1024',
      '-keyout',
      'leaf.key',
      '-out',
      'leaf.csr',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=IP:127.0.0.1,DNS:localhost',
    ],
    [
      'x509',
      '-req',
      '-in',
      'leaf.csr',
      '-CA',
      'ca.pem',
      '-CAkey',
      'ca.key',
      '-set_serial',
      '2',
      '-days',
      '2',
      '-out',
      'leaf.pem',
      '-copy_extensions',
      'copy',
    ],
  ]) {
    const result = spawnSync(openssl, args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  }
  const read = (name) => readFileSync(join(dir, name));
  // Только сервер стенда допускает слабый ключ. Клиент проверяет цепочку и имя;
  // SECLEVEL=2 делает порог ключа одинаковым на Node 18, 20 и 24, не ослабляя TLS.
  const server = https.createServer({
    key: read('leaf.key'),
    cert: read('leaf.pem'),
    ciphers: 'DEFAULT@SECLEVEL=0',
  });
  let connections = 0;
  let connects = 0;
  server.on('connection', () => connections++);
  server.on('connect', (_, socket) => {
    connects++;
    socket.destroy();
  });
  const port = await listen(t, server);
  const result = await promisify(execFile)(
    process.execPath,
    [
      '--tls-cipher-list=DEFAULT@SECLEVEL=2',
      '-e',
      `
    const { TelegramClient } = require('./dist/telegram-client');
    const { normalizeOptions } = require('./dist/utils');
    const client = new TelegramClient(normalizeOptions({botToken: '0:fixture', chatId: 42,
      proxyUrl: 'https://127.0.0.1:${port}', retryAttempts: 3, retryInitialDelay: 1}));
    client.send({method: 'sendMessage', payload: {chat_id: 42, text: 'fixture'}})
      .then(() => { process.exitCode = 1; }, (error) => console.log(error.cause?.code))
      .finally(() => client.close());
  `,
    ],
    {
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: join(dir, 'ca.pem'),
        NODE_TLS_REJECT_UNAUTHORIZED: '1',
      },
      timeout: 8000,
    },
  );
  assert.equal(result.stdout.trim(), 'CERT_KEY_TOO_WEAK');
  assert.equal(connections, 1);
  assert.equal(connects, 0);
});
