#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { fetch } from 'undici';
import { buildTelegramUrl } from './utils';

interface CliContext {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: () => string;
}

type CliOptionValue = string | boolean;
type CliOptions = Record<string, CliOptionValue | undefined>;

type CommandName = 'check' | 'generate-config' | 'help';

interface ParsedArgs {
  command?: CommandName;
  positionals: string[];
  options: CliOptions;
}

interface BotInfo {
  id: number;
  first_name: string;
  username?: string;
}

interface ChatInfo {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

interface SentMessage {
  message_id: number;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

/**
 * Специализированное исключение CLI для сохранения HTTP-статуса и кода ошибки Telegram.
 *
 * @param message Описание ошибки.
 * @param status HTTP-статус ответа Telegram.
 * @param errorCode Код ошибки Telegram.
 * @param cause Первоначальная ошибка.
 */
class TelegramCliError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly errorCode?: number,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TelegramCliError';
    this.cause = cause;
  }
}

const defaultContext: CliContext = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
  env: process.env,
  cwd: () => process.cwd(),
};

/**
 * Точка входа CLI. Разбирает аргументы, применяет позиционные сокращения и исполняет команду.
 *
 * @param argv Сырые аргументы командной строки без node и имени скрипта.
 * @param partialContext Зависимости окружения, которые можно переопределить в тестах.
 * @returns Код завершения процесса.
 */
export async function runCli(
  argv: string[],
  partialContext: Partial<CliContext> = {},
): Promise<number> {
  const context: CliContext = {
    stdout: partialContext.stdout ?? defaultContext.stdout,
    stderr: partialContext.stderr ?? defaultContext.stderr,
    env: partialContext.env ?? defaultContext.env,
    cwd: partialContext.cwd ?? defaultContext.cwd,
  };

  const { command, positionals, options } = parseArgs(argv);

  if (command === 'help' || options.help === true) {
    printHelp(context);
    return 0;
  }

  if (!command) {
    printHelp(context);
    return 0;
  }

  applyPositionalShortcuts(command, positionals, options);

  switch (command) {
    case 'check':
      return await handleCheck(options, context);
    case 'generate-config':
      return await handleGenerateConfig(options, context);
    default:
      context.stderr(`Неизвестная команда: ${command}`);
      printHelp(context);
      return 1;
  }
}

/**
 * Разбирает массив аргументов на команду, позиционные аргументы и опции.
 *
 * @param args Аргументы после имени команды.
 * @returns Структура с именем команды, позиционными аргументами и опциями.
 */
function parseArgs(args: string[]): ParsedArgs {
  const options: CliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const valueIndex = arg.indexOf('=');
      if (valueIndex !== -1) {
        const key = arg.slice(2, valueIndex);
        const value = arg.slice(valueIndex + 1);
        options[toCamelCase(key)] = value;
        continue;
      }
      const key = arg.slice(2);
      const normalizedKey = toCamelCase(key);
      const next = args[index + 1];
      if (shouldConsumeValue(next)) {
        options[normalizedKey] = next as string;
        index += 1;
      } else {
        options[normalizedKey] = true;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      if (/^-[0-9]/.test(arg)) {
        positionals.push(arg);
        continue;
      }
      for (const flag of arg.slice(1)) {
        if (flag === 'h') {
          options.help = true;
        }
      }
      continue;
    }
    positionals.push(arg);
  }

  const [commandCandidate, ...rest] = positionals;
  return {
    command: normalizeCommandName(commandCandidate),
    positionals: rest,
    options,
  };
}

/**
 * Приводит строку к одному из поддерживаемых имён команд CLI.
 *
 * @param value Кандидат на имя команды.
 * @returns Имя команды или undefined, если строка не распознана.
 */
function normalizeCommandName(value?: string): CommandName | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === 'check') {
    return 'check';
  }
  if (normalized === 'generate' || normalized === 'generate-config' || normalized === 'config') {
    return 'generate-config';
  }
  if (normalized === 'help') {
    return 'help';
  }
  return undefined;
}

/**
 * Преобразует kebab-case опции в camelCase для внутренних ключей.
 *
 * @param value Имя опции из аргументов командной строки.
 * @returns Имя опции в camelCase.
 */
function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * Определяет, следует ли трактовать следующий аргумент как значение текущей опции.
 *
 * @param next Следующий аргумент командной строки.
 * @returns True, если аргумент нужно потребить как значение.
 */
function shouldConsumeValue(next: string | undefined): next is string {
  if (next === undefined || next === '--') {
    return false;
  }
  if (!next.startsWith('-')) {
    return true;
  }
  return /^-[0-9]/.test(next);
}

/**
 * Поддерживает короткую форму вызова команд через позиционные аргументы.
 *
 * @param command Имя команды.
 * @param positionals Позиционные аргументы, переданные пользователем.
 * @param options Объект опций, который будет дополнен сокращениями.
 */
function applyPositionalShortcuts(
  command: CommandName,
  positionals: string[],
  options: CliOptions,
): void {
  if (command === 'check') {
    if (positionals[0] && options.token === undefined && options.botToken === undefined) {
      options.token = positionals[0];
    }
    if (positionals[1] && options.chat === undefined && options.chatId === undefined) {
      options.chat = positionals[1];
    }
    if (positionals[2] && options.threadId === undefined && options.thread === undefined) {
      options.threadId = positionals[2];
    }
  }
  if (command === 'generate-config') {
    if (positionals[0] && options.token === undefined && options.botToken === undefined) {
      options.token = positionals[0];
    }
    if (positionals[1] && options.chat === undefined && options.chatId === undefined) {
      options.chat = positionals[1];
    }
  }
}

/**
 * Выполняет команду `check`: проверяет токен, чат и необязательную тему.
 *
 * @param options Опции командной строки.
 * @param context Контекст ввода-вывода CLI.
 * @returns Код завершения команды.
 */
async function handleCheck(options: CliOptions, context: CliContext): Promise<number> {
  const tokenCandidate = pickOption(options, ['token', 'botToken']);
  if (typeof tokenCandidate === 'boolean') {
    context.stderr('Флаг --token требует значения.');
    return 1;
  }
  const token = tokenCandidate ?? context.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    context.stderr('Не указан токен. Передайте --token или установите TELEGRAM_BOT_TOKEN.');
    return 1;
  }

  context.stdout('Проверка токена…');
  let bot: BotInfo;
  try {
    bot = await callTelegram<BotInfo>(token, 'getMe');
    context.stdout(`✅ Токен действителен: ${formatBot(bot)}`);
  } catch (error) {
    context.stderr(formatTelegramError('Не удалось проверить токен', error));
    return 1;
  }

  const chatCandidate = pickOption(options, ['chat', 'chatId']);
  if (typeof chatCandidate === 'boolean') {
    context.stderr('Флаг --chat-id требует значения.');
    return 1;
  }

  const chats = parseChatList(chatCandidate ?? context.env.TELEGRAM_CHAT_ID);
  let hasFailures = false;

  for (const chatId of chats) {
    context.stdout(`Проверка чата ${chatId}…`);
    try {
      const chat = await callTelegram<ChatInfo>(token, 'getChat', { chat_id: chatId });
      context.stdout(`✅ Чат доступен: ${formatChat(chat)}`);
    } catch (error) {
      hasFailures = true;
      context.stderr(formatTelegramError(`❌ Не удалось проверить чат ${chatId}`, error));
    }
  }

  const threadCandidate = pickOption(options, ['threadId', 'thread']);
  if (typeof threadCandidate === 'boolean') {
    context.stderr('Флаг --thread-id требует значения.');
    return 1;
  }

  const parsedThread = parseThreadId(threadCandidate ?? context.env.TELEGRAM_THREAD_ID);
  if (parsedThread.error) {
    context.stderr(parsedThread.error);
    return 1;
  }

  if (parsedThread.value !== undefined) {
    if (chats.length !== 1) {
      context.stderr('Для проверки темы укажите ровно один чат.');
      return 1;
    }
    const chatId = chats[0];
    context.stdout(`Проверка темы ${parsedThread.value} в чате ${chatId}…`);
    try {
      const probe = await callTelegram<SentMessage>(token, 'sendMessage', {
        chat_id: chatId,
        message_thread_id: parsedThread.value,
        text: 'pino-telegram-cli thread probe',
        disable_notification: true,
      });
      await attemptDeleteMessage(token, chatId, probe.message_id, context);
      context.stdout(`✅ Тема доступна: ID ${parsedThread.value}`);
    } catch (error) {
      context.stderr(formatTelegramError('❌ Не удалось проверить тему', error));
      return 1;
    }
  }

  return hasFailures ? 1 : 0;
}

/**
 * Пытается удалить временное сообщение, созданное во время проверки.
 * Ошибки удаления подавляются, чтобы не нарушать основной сценарий проверки.
 *
 * @param token Токен Telegram-бота.
 * @param chatId Идентификатор чата.
 * @param messageId Идентификатор отправленного сообщения.
 * @param context Контекст CLI для логирования.
 */
async function attemptDeleteMessage(
  token: string,
  chatId: string | number,
  messageId: number,
  context: CliContext,
): Promise<void> {
  try {
    await callTelegram<boolean>(token, 'deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    });
  } catch (error) {
    context.stderr(formatTelegramError('⚠️ Не удалось удалить контрольное сообщение', error));
  }
}

/**
 * Генерирует пример конфигурации транспорта и сохраняет его на диск.
 *
 * @param options Опции командной строки.
 * @param context Контекст ввода-вывода CLI.
 * @returns Код завершения команды.
 */
async function handleGenerateConfig(options: CliOptions, context: CliContext): Promise<number> {
  const tokenCandidate = pickOption(options, ['token', 'botToken']);
  if (typeof tokenCandidate === 'boolean') {
    context.stderr('Флаг --token требует значения.');
    return 1;
  }
  const chatCandidate = pickOption(options, ['chat', 'chatId']);
  if (typeof chatCandidate === 'boolean') {
    context.stderr('Флаг --chat-id требует значения.');
    return 1;
  }

  const formatCandidate = pickOption(options, ['format']);
  if (typeof formatCandidate === 'boolean') {
    context.stderr('Флаг --format требует значения.');
    return 1;
  }

  const format = (formatCandidate ?? 'json').toLowerCase();
  if (format !== 'json' && format !== 'env') {
    context.stderr('Поддерживаются форматы json и env.');
    return 1;
  }

  const token = tokenCandidate ?? context.env.TELEGRAM_BOT_TOKEN ?? '<YOUR_BOT_TOKEN>';
  const chats = parseChatList(chatCandidate ?? context.env.TELEGRAM_CHAT_ID);
  const chatValue: string | string[] =
    chats.length === 0 ? '<CHAT_ID>' : chats.length === 1 ? chats[0] : chats;

  const threadCandidate = pickOption(options, ['threadId', 'thread']);
  if (typeof threadCandidate === 'boolean') {
    context.stderr('Флаг --thread-id требует значения.');
    return 1;
  }
  const parsedThread = parseThreadId(threadCandidate ?? context.env.TELEGRAM_THREAD_ID);
  if (parsedThread.error) {
    context.stderr(parsedThread.error);
    return 1;
  }

  const config: Record<string, unknown> = {
    botToken: token,
    chatId: chatValue,
  };

  if (parsedThread.value !== undefined) {
    config.threadId = parsedThread.value;
  }

  let output: string;
  if (format === 'json') {
    const snippet = {
      transport: {
        target: 'pino-telegram-logger-transport',
        options: config,
      },
    };
    output = JSON.stringify(snippet, null, 2);
  } else {
    const normalizedChat = Array.isArray(chatValue) ? chatValue.join(',') : chatValue;
    const envLines = [
      `TELEGRAM_BOT_TOKEN=${token === '<YOUR_BOT_TOKEN>' ? '' : token}`,
      `TELEGRAM_CHAT_ID=${normalizedChat === '<CHAT_ID>' ? '' : normalizedChat}`,
    ];
    if (parsedThread.value !== undefined) {
      envLines.push(`TELEGRAM_THREAD_ID=${parsedThread.value}`);
    }
    const newline = String.fromCharCode(10);
    output = envLines.join(newline);
  }

  const outputPathCandidate = pickOption(options, ['output', 'out']);
  if (typeof outputPathCandidate === 'boolean') {
    context.stderr('Флаг --output требует значения.');
    return 1;
  }

  if (outputPathCandidate) {
    const absolutePath = resolvePath(context.cwd(), outputPathCandidate);
    await writeFile(
      absolutePath,
      `${output}
`,
      'utf8',
    );
    context.stdout(`Конфигурация сохранена в ${absolutePath}`);
  } else {
    context.stdout(output);
  }

  return 0;
}

/**
 * Выбирает первое доступное значение опции из списка алиасов.
 *
 * @param options Объект опций.
 * @param keys Список синонимов опции.
 * @returns Значение опции или undefined.
 */
function pickOption(options: CliOptions, keys: string[]): CliOptionValue | undefined {
  for (const key of keys) {
    if (options[key] !== undefined) {
      return options[key];
    }
  }
  return undefined;
}

/**
 * Разбирает список идентификаторов чатов из строки.
 *
 * @param value Строка со значениями через запятую.
 * @returns Массив идентификаторов (строк).
 */
function parseChatList(value?: string): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

/**
 * Проверяет корректность значения threadId, переданного пользователем.
 *
 * @param value Строковое представление threadId.
 * @returns Объект с числовым значением или описанием ошибки.
 */
function parseThreadId(value?: string): { value?: number; error?: string } {
  if (value === undefined || value === '') {
    return {};
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return { error: 'Идентификатор темы должен быть положительным целым числом.' };
  }
  return { value: numeric };
}

/**
 * Универсальный помощник для вызова методов Telegram Bot API.
 *
 * @param token Токен бота.
 * @param method Имя вызываемого метода.
 * @param payload Тело запроса к Telegram.
 * @returns Результат, разобранный из ответа Telegram.
 */
async function callTelegram<T>(
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const url = buildTelegramMethodUrl(token, method, params);
  let response: Awaited<ReturnType<typeof fetch>>;
  try {
    response = await fetch(url);
  } catch (error) {
    const reason = (error as Error | undefined)?.message ?? 'неизвестная ошибка';
    throw new TelegramCliError(
      `Сетевая ошибка при вызове ${method}: ${reason}`,
      undefined,
      undefined,
      error,
    );
  }

  let data: TelegramResponse<T> | undefined;
  try {
    data = (await response.json()) as TelegramResponse<T>;
  } catch (error) {
    throw new TelegramCliError(
      `Не удалось разобрать ответ Telegram (${method})`,
      response.status,
      undefined,
      error,
    );
  }

  if (!response.ok || !data?.ok || data.result === undefined) {
    const description = data?.description ?? response.statusText ?? 'Неизвестная ошибка';
    throw new TelegramCliError(description, response.status, data?.error_code);
  }

  return data.result;
}

/**
 * Строит URL метода Telegram с учётом токена.
 *
 * @param token Токен бота.
 * @param method Имя метода Telegram.
 * @returns Полный URL HTTP-запроса.
 */
function buildTelegramMethodUrl(
  token: string,
  method: string,
  params?: Record<string, unknown>,
): string {
  const base = buildTelegramUrl(token, method);
  if (!params || Object.keys(params).length === 0) {
    return base;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    search.append(key, String(value));
  }
  return `${base}?${search.toString()}`;
}

/**
 * Форматирует информацию о боте для вывода в консоль.
 *
 * @param bot Данные о боте из Telegram.
 * @returns Человекочитаемая строка.
 */
function formatBot(bot: BotInfo): string {
  if (bot.username) {
    return `@${bot.username} (${bot.first_name})`;
  }
  return `${bot.first_name} [${bot.id}]`;
}

/**
 * Форматирует информацию о чате для вывода в консоль.
 *
 * @param chat Данные о чате из Telegram.
 * @returns Человекочитаемая строка.
 */
function formatChat(chat: ChatInfo): string {
  const parts: string[] = [];
  if (chat.title) {
    parts.push(chat.title);
  }
  if (chat.username) {
    parts.push(`@${chat.username}`);
  }
  if (parts.length === 0) {
    parts.push(String(chat.id));
  }
  parts.push(`тип: ${chat.type}`);
  return parts.join(' — ');
}

/**
 * Преобразует ошибку Telegram в человекочитаемую строку.
 *
 * @param prefix Префикс сообщения об ошибке.
 * @param error Ошибка, полученная при вызове API.
 * @returns Описание ошибки.
 */
function formatTelegramError(prefix: string, error: unknown): string {
  if (error instanceof TelegramCliError) {
    const details: string[] = [];
    if (typeof error.status === 'number') {
      details.push(`HTTP ${error.status}`);
    }
    if (typeof error.errorCode === 'number') {
      details.push(`код ${error.errorCode}`);
    }
    const suffix = details.length ? ` (${details.join(', ')})` : '';
    return `${prefix}: ${error.message}${suffix}`;
  }
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }
  return `${prefix}: неизвестная ошибка`;
}

/**
 * Печатает справку по CLI-командам.
 *
 * @param context Контекст ввода-вывода.
 */
function printHelp(context: CliContext): void {
  const lines = [
    'pino-telegram-cli — утилита для проверки Telegram Bot API и генерации конфигурации транспорта.',
    '',
    'Использование:',
    '  pino-telegram-cli check --token <token> [--chat-id <id>] [--thread-id <id>]',
    '  pino-telegram-cli generate-config [--token <token>] [--chat-id <id>[,<id>]] [--format json|env] [--output <файл>]',
    '',
    'Позиционные параметры:',
    '  check <token> [chatId] [threadId]              Быстрый ввод токена и идентификаторов',
    '  generate-config <token> [chatId]               Быстрый ввод токена и чатов',
    '',
    'Опции:',
    '  --token, --bot-token           Токен бота (или TELEGRAM_BOT_TOKEN)',
    '  --chat-id, --chat              Идентификатор чата/чатов (через запятую) или TELEGRAM_CHAT_ID',
    '  --thread-id, --thread          Идентификатор темы (message_thread_id) или TELEGRAM_THREAD_ID',
    '  --format                       Формат вывода: json (по умолчанию) или env',
    '  --output <путь>                Сохранить результат в файл вместо вывода в консоль',
    '  --help, -h                     Показать справку',
    '',
    'Примеры:',
    '  pino-telegram-cli check --token 123:ABC --chat-id -1001234567890',
    '  pino-telegram-cli generate-config --token 123:ABC --chat-id -1001,-1002 --format env',
  ];
  for (const line of lines) {
    context.stdout(line);
  }
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
