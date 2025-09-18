export type ChatIdentifier = string | number;

export interface TelegramChatTarget {
  /** Идентификатор чата (отрицательные значения используются для групп). */
  chatId: ChatIdentifier;
  /** Идентификатор темы в супергруппе. */
  threadId?: number;
}

export type RawChatTarget = ChatIdentifier | TelegramChatTarget;

export interface TelegramMessagePayload {
  chat_id: ChatIdentifier;
  text: string;
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  disable_notification?: boolean;
  message_thread_id?: number;
  disable_web_page_preview?: boolean;
}

export interface TelegramTransportOptions {
  /** Токен Telegram-бота. */
  botToken: string;
  /** Описание целевых чатов. */
  chatId: RawChatTarget | RawChatTarget[];
  /** Общая тема для всех сообщений (опционально). */
  threadId?: number;
  /** Режим форматирования текста Telegram. */
  parseMode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  /** Отключение push-уведомлений. */
  disableNotification?: boolean;
  /** Запрет предпросмотра ссылок. */
  disableWebPagePreview?: boolean;
  /** Включать ли пользовательский контекст. */
  includeContext?: boolean;
  /** Ключи, из которых извлекается контекст. */
  contextKeys?: string | string[];
  /** Управление секцией Extras. */
  includeExtras?: boolean;
  /** Белый список полей для секции Extras. */
  extraKeys?: string[];
  /** Максимальная длина текстового сообщения. */
  maxMessageLength?: number;
  /** Минимальный интервал между сообщениями в одном чате (мс). */
  minDelayBetweenMessages?: number;
  /** Пользовательский форматтер сообщения. */
  formatMessage?: (input: FormatMessageInput) => FormatMessageResult | Promise<FormatMessageResult>;
  /** Обработчик ошибок доставки. */
  onDeliveryError?: (error: unknown, payload?: TelegramMessagePayload) => void;
  /** Пользовательский способ отправки (для тестов/кастомных клиентов). */
  send?: (payload: TelegramMessagePayload) => Promise<void>;
  /** Кастомные заголовки для форматтера по умолчанию. */
  headings?: Partial<FormatterHeadings>;
  /** Количество попыток доставки (включая первую). */
  retryAttempts?: number;
  /** Стартовая пауза перед повторной попыткой (мс). */
  retryInitialDelay?: number;
  /** Множитель экспоненциального backoff. */
  retryBackoffFactor?: number;
  /** Максимальная пауза между попытками (мс). */
  retryMaxDelay?: number;
}

export interface FormatMessageInput {
  log: PinoLog;
  target: TelegramChatTarget;
  options: NormalizedOptions;
}

export interface FormatterHeadings {
  time: string;
  context: string;
  error: string;
  extras: string;
}

export interface FormatMessageResult {
  text: string;
  extra?: Partial<TelegramMessagePayload>;
}

export interface PinoLog {
  level: number;
  time?: number | string;
  msg?: string;
  context?: unknown;
  err?: { message?: string; stack?: string } & Record<string, unknown>;
  [key: string]: unknown;
}

export interface NormalizedOptions {
  botToken: string;
  targets: TelegramChatTarget[];
  parseMode: 'HTML' | 'Markdown' | 'MarkdownV2';
  disableNotification: boolean;
  disableWebPagePreview: boolean;
  includeContext: boolean;
  contextKeys: string[];
  includeExtras: boolean;
  extraKeys?: string[];
  maxMessageLength: number;
  minDelayBetweenMessages: number;
  retryAttempts: number;
  retryInitialDelay: number;
  retryBackoffFactor: number;
  retryMaxDelay: number;
  formatMessage?: TelegramTransportOptions['formatMessage'];
  onDeliveryError?: TelegramTransportOptions['onDeliveryError'];
  send?: TelegramTransportOptions['send'];
  headings: FormatterHeadings;
}
