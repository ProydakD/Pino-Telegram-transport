const { execFile } = require('node:child_process');
const { join } = require('node:path');
const { cert } = require('./servers.cjs');

const token = '123:fixture-token';

function run(api, proxyUrl, args, { env = {}, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['-r', join(__dirname, 'loopback.cjs'), ...args],
      {
        timeout,
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
        if (error && typeof error.code !== 'number') {
          return reject(new Error(`Fixture process failed (${error.code ?? error.signal})`));
        }
        resolve({ code: error?.code ?? 0, stderr, output: stdout + stderr });
      },
    );
  });
}

module.exports = { run, token };
