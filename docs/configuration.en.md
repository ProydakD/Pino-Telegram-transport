# Configuration

English version · [Русская версия](configuration.ru.md)

## Transport Options

| Option                    | Type                                                                                 | Default value                                                            | Description                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `botToken`                | `string`                                                                             | —                                                                        | Telegram bot token (required).                                                           |
| `chatId`                  | `string \| number \| RawChatTarget[]`                                                | —                                                                        | One or more destinations. Supports arrays and `{ chatId, threadId, minLevel }` objects.            |
| `threadId`                | `number`                                                                             | —                                                                        | Default topic for all messages; overridden by `target.threadId`.                         |
| `parseMode`               | `'HTML' \| 'Markdown' \| 'MarkdownV2'`                                               | `'HTML'`                                                                 | Controls Telegram text formatting.                                                       |
| `disableNotification`     | `boolean`                                                                            | `false`                                                                  | Sends silent messages.                                                                   |
| `disableWebPagePreview`   | `boolean`                                                                            | `true`                                                                   | Disables link previews for `sendMessage`.                                                |
| `includeContext`          | `boolean`                                                                            | `true`                                                                   | Adds the `Context` block with user data.                                                 |
| `contextKeys`             | `string \| string[]`                                                                 | `['context', 'ctx']`                                                     | Keys used to read the context payload.                                                   |
| `includeExtras`           | `boolean`                                                                            | `true`                                                                   | Adds the `Extras` section with remaining fields.                                         |
| `extraKeys`               | `string[]`                                                                           | —                                                                        | Whitelists fields that appear in `Extras`.                                               |
| `redactKeys`              | `string[]`                                                                           | `['token', 'password', 'secret', 'authorization', 'cookie', 'apiKey']`   | Redacts sensitive keys inside the `Context`, `Error`, and `Extras` blocks. An empty array disables the default redaction list. |
| `maxMessageLength`        | `number`                                                                             | `4096`                                                                   | Maximum text length. Remember the 1024-character caption limit for media.                |
| `splitLongMessages`       | `boolean`                                                                            | `false`                                                                  | Splits long text messages into multiple HTML-safe parts. Media captions still use truncation. |
| `minDelayBetweenMessages` | `number`                                                                             | `100`                                                                    | Minimum delay (ms) between messages for the same chat.                                   |
| `minLevel`                | `number \| 'trace' \| 'debug' \| 'info' \| 'warn' \| 'error' \| 'fatal' \| 'silent'` | `0`                                                                      | Global baseline threshold for the transport. Use `target.minLevel` for stricter per-destination routing. |
| `maxQueueSize`            | `number`                                                                             | `1000`                                                                   | Maximum number of pending tasks in the in-memory delivery queue. Minimum value is `1`.   |
| `overflowStrategy`        | `'dropOldest' \| 'dropNewest' \| 'block'`                                            | `'dropOldest'`                                                           | Queue overflow behaviour: replace the oldest task, drop the new one, or wait for space.  |
| `failOnInitError`         | `boolean`                                                                            | `false`                                                                  | Throws configuration errors (`botToken`, `chatId`) instead of falling back to a noop transport. |
| `retryAttempts`           | `number`                                                                             | `3`                                                                      | Total number of delivery attempts, including the first one.                              |
| `retryInitialDelay`       | `number`                                                                             | `500`                                                                    | Initial delay (ms) before retrying.                                                      |
| `retryBackoffFactor`      | `number`                                                                             | `2`                                                                      | Exponential backoff multiplier.                                                          |
| `retryMaxDelay`           | `number`                                                                             | `10000`                                                                  | Maximum delay (ms) between attempts.                                                     |
| `requestTimeoutMs`        | `number`                                                                             | `10000`                                                                  | HTTP timeout for Telegram requests in milliseconds. Set `0` to disable the built-in timeout. |
| `formatPreset`            | `'default' \| 'compact' \| 'verbose'`                                                | `'default'`                                                              | Selects a built-in formatter preset. `default` is kept for backward compatibility and is equivalent to `verbose`. Prefer presets over callback formatters for `transport.target`. |
| `formatMessage`           | `FormatMessageFn`                                                                    | `createMediaFormatter()`                                                 | Custom message formatter.                                                                |
| `onDeliveryError`         | `(error, payload?, method?) => void`                                                 | —                                                                        | Delivery error handler.                                                                  |
| `send`                    | `(payload, method) => Promise<void>`                                                 | —                                                                        | Custom delivery implementation instead of the built-in HTTP client.                      |
| `headings`                | `Partial<FormatterHeadings>`                                                         | `{ time: 'Time', context: 'Context', error: 'Error', extras: 'Extras' }` | Overrides default headings used by the formatter.                                        |

## Default Formatter

- Uses level emojis (`🔍`, `🐛`, `ℹ️`, `⚠️`, `❗️`, `💀`) and block headings.
- Truncates the message according to `maxMessageLength` without breaking HTML tags or entities.
- With `splitLongMessages: true`, long `sendMessage` payloads are delivered as multiple parts instead of truncation.
- Escapes HTML via `escapeHtml` to keep the markup safe.
- The `verbose` preset matches the existing detailed default renderer and keeps separate `Time`, `Context`, `Error`, and `Extras` blocks.
- The `compact` preset emits a short `LEVEL + time + message` line and collapses `Context`, `Error`, and `Extras` into compact JSON blocks.
- For `parseMode: 'HTML'`, use only tags supported by the Telegram Bot API: `b/strong`, `i/em`, `u/ins`, `s/strike/del`, `a`, `code`, `pre`, nested `pre` + `code class="language-..."`, `blockquote` (including `expandable`), `tg-spoiler`, `tg-emoji`.
- Named HTML entities in the Bot API are limited to `&lt;`, `&gt;`, `&amp;`, and `&quot;`; the transport also encodes apostrophes as `&#39;`.

## Media Formatter

`createMediaFormatter` evaluates a log record and picks the proper Bot API method.

| Log key            | Purpose                                                                                    | Default key        |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------ |
| `messageType`      | Chooses the method (`text`, `photo`, `document`).                                          | `messageType`      |
| `mediaUrl`         | URL of the media file.                                                                     | `mediaUrl`         |
| `mediaBuffer`      | Binary data (`Buffer`, `Uint8Array`, `ArrayBuffer`, `{ type: 'Buffer', data: number[] }`). | `mediaBuffer`      |
| `mediaFilename`    | Filename when sending a document.                                                          | `mediaFilename`    |
| `mediaContentType` | MIME type of the media payload.                                                            | `mediaContentType` |
| `caption`          | Caption limited by `captionMaxLength` (1024 by default).                                   | `caption`          |

Override these keys with `createMediaFormatter({ typeKey, urlKey, bufferKey, ... })` when your schema differs.

## Client Behaviour

- The HTTP client uses Node.js built-in `fetch`, `FormData`, and `Blob` APIs and sends `POST` requests.
- Slow requests are aborted after `requestTimeoutMs` milliseconds (`10000` by default).
- The in-memory delivery queue is capped by `maxQueueSize` (`1000` tasks by default).
- Queue overflow follows `overflowStrategy`: `dropOldest`, `dropNewest`, or `block`.
- Configuration errors disable the transport and print a warning by default; `failOnInitError: true` switches this behaviour to throwing.
- Responses `429` and `5xx` trigger exponential retry logic.
- Built-in client timeouts are treated as temporary failures and are retried as well.
- Telegram `retry_after` hints are honoured as the minimum delay before the next attempt.
- A custom `send` function receives `(payload, method)` and may implement any delivery strategy.

## Message Headings

```ts
headings: {
  time: 'Time',
  context: 'Context',
  error: 'Error',
  extras: 'Extras',
}
```

All keys are optional; the transport falls back to defaults when a heading is omitted.

## Context and Extras

- Context is rendered inside a `<pre>` block.
- The Extras section prints `key: value` pairs excluding reserved fields (`level`, `time`, `msg`, `context`, `err`).
- Sensitive keys (`token`, `password`, `secret`, `authorization`, `cookie`, `apiKey`) are replaced with `[REDACTED]` by default.
- Redaction applies to `Context`, `Error`, and `Extras` without mutating the original log object.
- Watch `maxMessageLength` when logging large objects.

## Telegram Limits

- `sendPhoto` captions are limited to 1024 characters.
- Maximum document size depends on the bot account (up to 50 MB for standard bots).
- Use URLs and external object storage for bigger assets.
