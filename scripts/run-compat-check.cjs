const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packageRoot = path.resolve(__dirname, '..');
const projectPackageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
);

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const pinoMajor = readPinoMajor(process.argv.slice(2));
  ensureSupportedNodeVersion(pinoMajor);

  const tempRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), `pino-telegram-compat-pino${pinoMajor}-`),
  );

  try {
    const tarballPath = packCurrentPackage(tempRoot);
    const consumerDir = path.join(tempRoot, 'consumer');

    await fsp.mkdir(consumerDir, { recursive: true });
    await writeConsumerFiles(consumerDir);

    installConsumerDependencies(consumerDir, tarballPath, pinoMajor);
    runNpm(['exec', '--', 'tsc', '--noEmit'], consumerDir);

    runNodeFile('smoke-target.cjs', consumerDir);
    runNodeFile('smoke-direct.cjs', consumerDir);
    runNodeFile('smoke-target-callback-negative.cjs', consumerDir);

    console.log(
      `Compat check passed for pino@${pinoMajor} on Node.js ${process.versions.node}.`,
    );
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

function readPinoMajor(args) {
  const optionIndex = args.indexOf('--pino');
  const pinoMajor = optionIndex >= 0 ? args[optionIndex + 1] : undefined;

  if (!pinoMajor || !['9', '10'].includes(pinoMajor)) {
    throw new Error('Укажите поддерживаемую major-версию через --pino 9 или --pino 10.');
  }

  return pinoMajor;
}

function ensureSupportedNodeVersion(pinoMajor) {
  if (pinoMajor !== '10') {
    return;
  }

  const currentNodeMajor = Number(process.versions.node.split('.')[0]);
  if (currentNodeMajor < 20) {
    throw new Error('Для test:compat:pino10 требуется Node.js 20 или выше.');
  }
}

function packCurrentPackage(destinationDir) {
  const result = runNpm(['pack', '--pack-destination', destinationDir], packageRoot);
  const tarballName = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();

  if (!tarballName) {
    throw new Error('npm pack не вернул имя tarball для compat-проверки.');
  }

  return path.join(destinationDir, tarballName);
}

function installConsumerDependencies(consumerDir, tarballPath, pinoMajor) {
  runNpm(
    [
      'install',
      '--silent',
      `typescript@${projectPackageJson.devDependencies.typescript}`,
      `@types/node@${projectPackageJson.devDependencies['@types/node']}`,
      `pino@^${pinoMajor}.0.0`,
      tarballPath,
    ],
    consumerDir,
  );
}

async function writeConsumerFiles(consumerDir) {
  await fsp.writeFile(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'pino-telegram-compat-consumer',
        private: true,
        type: 'commonjs',
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await fsp.writeFile(
    path.join(consumerDir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ['node'],
        },
        include: ['compat-typecheck.ts'],
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  await fsp.writeFile(
    path.join(consumerDir, 'compat-typecheck.ts'),
    `import pino from 'pino';
import telegramTransport, {
  createFastifyLoggerOptions,
  createLambdaLoggerOptions,
  createNestLoggerOptions,
  type FastifyLoggerOptions,
  type NestLoggerOptions,
  type TelegramTransportOptions,
} from 'pino-telegram-logger-transport';

const transportOptions: TelegramTransportOptions = {
  botToken: '123:ABC',
  chatId: 111,
};

const stream = telegramTransport({
  ...transportOptions,
  send: async () => {},
});

const directLogger = pino({}, stream);
const fastifyOptions: FastifyLoggerOptions = createFastifyLoggerOptions(transportOptions, {
  level: 'warn',
});
const nestOptions: NestLoggerOptions = createNestLoggerOptions(transportOptions, {
  pinoHttp: {
    level: 'info',
  },
});
const lambdaLogger = pino(
  createLambdaLoggerOptions(transportOptions, {
    level: 'info',
  }),
);

directLogger.info('compat typecheck');
lambdaLogger.info('compat lambda');
void fastifyOptions;
void nestOptions;
`,
    'utf8',
  );

  await fsp.writeFile(
    path.join(consumerDir, 'smoke-target.cjs'),
    `const pino = require('pino');

async function main() {
  const logger = pino({
    transport: {
      target: 'pino-telegram-logger-transport',
      options: {
        chatId: 111,
      },
    },
  });

  logger.info('compat target smoke');

  if (typeof logger.flush === 'function') {
    await logger.flush();
  }

  await new Promise((resolve) => setTimeout(resolve, 25));
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
`,
    'utf8',
  );

  await fsp.writeFile(
    path.join(consumerDir, 'smoke-direct.cjs'),
    `const pino = require('pino');
const telegramTransport = require('pino-telegram-logger-transport').default;

async function main() {
  let callCount = 0;

  const stream = telegramTransport({
    botToken: '123:ABC',
    chatId: 111,
    send: async (payload, method) => {
      callCount += 1;

      if (!payload || method !== 'sendMessage') {
        throw new Error('Ожидался вызов send с payload и методом sendMessage.');
      }
    },
  });

  const logger = pino({}, stream);

  logger.info({ context: { requestId: 'compat' } }, 'compat direct smoke');

  if (typeof logger.flush === 'function') {
    await logger.flush();
  }

  await new Promise((resolve) => setTimeout(resolve, 25));

  if (callCount !== 1) {
    throw new Error(\`Ожидалась одна отправка через direct-stream, получено \${callCount}.\`);
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
`,
    'utf8',
  );

  await fsp.writeFile(
    path.join(consumerDir, 'smoke-target-callback-negative.cjs'),
    `const pino = require('pino');

function main() {
  try {
    pino({
      transport: {
        target: 'pino-telegram-logger-transport',
        options: {
          botToken: '123:ABC',
          chatId: 111,
          send: async () => {},
        },
        worker: {
          enabled: false,
        },
      },
    });
  } catch (error) {
    if (error?.name === 'DataCloneError') {
      return;
    }

    throw error;
  }

  throw new Error(
    'Ожидался DataCloneError при передаче callback-опций через transport.target.',
  );
}

try {
  main();
} catch (error) {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
}
`,
    'utf8',
  );
}

function runNodeFile(filename, cwd) {
  runCommand(process.execPath, [path.join(cwd, filename)], cwd);
}

function runNpm(args, cwd) {
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath) {
    return runCommand(process.execPath, [npmExecPath, ...args], cwd);
  }

  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return runCommand(npmExecutable, args, cwd);
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(formatCommandError(command, args, result));
  }

  return result;
}

function formatCommandError(command, args, result) {
  const output = [
    `Команда завершилась с кодом ${result.status}.`,
    `> ${command} ${args.join(' ')}`,
  ];

  if (result.stdout.trim()) {
    output.push(`stdout:\n${result.stdout.trim()}`);
  }

  if (result.stderr.trim()) {
    output.push(`stderr:\n${result.stderr.trim()}`);
  }

  return output.join('\n\n');
}
