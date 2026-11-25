const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
// Родительский node_modules предоставляет установленные peer-типы Pino без сети.
const consumer = fs.mkdtempSync(path.join(root, 'node_modules', '.pino-telegram-types-'));
const pkg = path.join(consumer, 'node_modules', 'pino-telegram-logger-transport');
fs.mkdirSync(pkg, { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(pkg, 'package.json'));
fs.cpSync(path.join(root, 'dist'), path.join(pkg, 'dist'), { recursive: true });
fs.writeFileSync(
  path.join(consumer, 'consumer.ts'),
  `
import transport, { TelegramDeliveryError } from 'pino-telegram-logger-transport';
transport({ botToken: '0:fixture', chatId: 42 });
new TelegramDeliveryError('fixture');
`,
);
const result = spawnSync(
  process.execPath,
  [
    require.resolve('typescript/bin/tsc'),
    '--noEmit',
    '--strict',
    '--esModuleInterop',
    '--skipLibCheck',
    'false',
    '--typeRoots',
    path.join(root, 'node_modules/@types'),
    '--types',
    'node',
    '--lib',
    'ES2022',
    '--module',
    'commonjs',
    '--target',
    'ES5',
    'consumer.ts',
  ],
  { cwd: consumer, encoding: 'utf8' },
);
assert.equal(result.status, 0, result.stdout + result.stderr);
console.log('Public package import: target ES5, skipLibCheck=false passed');
