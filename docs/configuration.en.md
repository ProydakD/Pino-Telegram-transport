# Configuration

English version · [Русская версия](configuration.ru.md)

## Transport Options

| Option                    | Type                                                                                 | Default value                                                            | Description                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `botToken`                | `string`                                                                             | —                                                                        | Telegram bot token (required).                                                           |
| `proxyUrl`                | `string` | — | HTTP(S) CONNECT or SOCKS5 proxy for all built-in delivery methods. Cannot be combined with `send`. |
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
| `dedupWindowMs`           | `number`                                                                             | `0`                                                                      | Suppresses repeated `sendMessage` events inside a time window. Matching is scoped by target and log content without the top-level `time` field. |
| `minDelayBetweenMessages` | `number`                                                                             | `100`                                                                    | Minimum delay (ms) between messages for the same chat.                                   |
| `minLevel`                | `number \| 'trace' \| 'debug' \| 'info' \| 'warn' \| 'error' \| 'fatal' \| 'silent'` | `0`                                                                      | Global baseline threshold for the transport. Use `target.minLevel` for stricter per-destination routing. |
| `maxQueueSize`            | `number`                                                                             | `1000`                                                                   | Maximum number of pending tasks in the in-memory delivery queue. Minimum value is `1`.   |
| `overflowStrategy`        | `'dropOldest' \| 'dropNewest' \| 'block'`                                            | `'dropOldest'`                                                           | Queue overflow behaviour: replace the oldest task, drop the new one, or wait for space.  |
| `failOnInitError`         | `boolean`                                                                            | `false`                                                                  | Throws configuration errors (including invalid proxy settings) instead of disabling the transport. |
| `retryAttempts`           | `number`                                                                             | `3`                                                                      | Total number of delivery attempts, including the first one.                              |
| `retryInitialDelay`       | `number`                                                                             | `500`                                                                    | Initial delay (ms) before retrying.                                                      |
| `retryBackoffFactor`      | `number`                                                                             | `2`                                                                      | Exponential backoff multiplier.                                                          |
| `retryMaxDelay`           | `number`                                                                             | `10000`                                                                  | Backoff limit in ms. Also the largest HTTP(S) proxy `Retry-After` that permits a retry. |
| `requestTimeoutMs`        | `number`                                                                             | `10000`                                                                  | Deadline per delivery attempt in milliseconds, including proxy setup. Set `0` to disable the client's deadline. |
| `formatPreset`            | `'default' \| 'compact' \| 'verbose'`                                                | `'default'`                                                              | Selects a built-in formatter preset. `default` is kept for backward compatibility and is equivalent to `verbose`. Prefer presets over callback formatters for `transport.target`. |
| `formatMessage`           | `FormatMessageFn`                                                                    | `createMediaFormatter()`                                                 | Custom message formatter.                                                                |
| `onDeliveryError`         | `(error, payload?, method?) => void`                                                 | —                                                                        | Delivery error handler.                                                                  |
| `send`                    | `(payload, method) => Promise<void>`                                                 | —                                                                        | Custom delivery implementation instead of the built-in HTTP client.                      |
| `headings`                | `Partial<FormatterHeadings>`                                                         | `{ time: 'Time', context: 'Context', error: 'Error', extras: 'Extras' }` | Overrides default headings used by the formatter.                                        |

## Default Formatter

- Uses level emojis (`🔍`, `🐛`, `ℹ️`, `⚠️`, `❗️`, `💀`) and block headings.
- Truncates the message according to `maxMessageLength` without breaking HTML tags or entities.
- With `splitLongMessages: true`, long `sendMessage` payloads are delivered as multiple parts instead of truncation.
- With `dedupWindowMs > 0`, repeated text events for the same target are suppressed inside the configured window.
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

- Without `proxyUrl` the client uses the existing `fetch` route. Set `proxyUrl: process.env.TELEGRAM_PROXY_URL` in the transport options (worker or direct stream) to opt into a proxy. The transport does not read that variable automatically.
- Use a server URL such as `http://proxy.example:8080`, `https://proxy.example:8443`, or `socks5h://proxy.example:1080`. URL-encode credentials if supplied. SOCKS5 requires both username and password or neither; each provided field must be 1–255 UTF-8 bytes after decoding. HTTP(S) Basic usernames cannot contain a colon, even URL-encoded; passwords can. MTProxy links are not supported.
- With `socks5://` the client resolves the Bot API hostname and can try another resolved address if SOCKS CONNECT fails for the chosen address, including on reply `8` (unsupported address type). With `socks5h://` the proxy resolves the name; reply `8` ends the delivery without retrying or resolving the name locally. A proxy failure never triggers a direct connection.
- Proxied requests use Node HTTPS with TLS verification enabled. Text, photos, documents, and topic messages use the same route; a transport reuses its established tunnels when the server supports keep-alive. An invalid URL or a conflict with `send` is an initialization error.
- Proxied GET and JSON requests do not require `fetch`, including on Node 18 with `--no-experimental-fetch`. Binary multipart uploads still require the built-in Web APIs.
- If the proxy hostname resolves to multiple addresses, the next TCP dial starts immediately after a refusal or after a short delay if the first dial is still pending and the deadline allows it. Only the first connected socket proceeds to the proxy handshake. The HTTPS proxy and the Bot API certificates are checked separately against their respective hosts.
- Each attempt shares one `requestTimeoutMs` deadline (`10000` ms by default) across DNS, connection establishment, sending, and reading the response. Set `0` to disable the deadline without disabling cancellation by `destroy()`.
- The in-memory delivery queue is capped by `maxQueueSize` (`1000` tasks by default).
- Queue overflow follows `overflowStrategy`: `dropOldest`, `dropNewest`, or `block`.
- For a direct transport stream, `end()` drains the queue. `destroy()` instead cancels built-in requests and retry or rate-limit waits, and discards queued logs without reporting a delivery error for the cancellation. It cannot interrupt user code that is already running.
- Deduplication applies only to `sendMessage`; an entry is added to the dedup cache only after all message parts are delivered successfully.
- Configuration errors disable the transport and print a warning by default; `failOnInitError: true` switches this behaviour to throwing.
- The client retries `429`, `5xx`, and temporary network errors (including timeouts before HTTP headers). SOCKS authentication failures, SOCKS CONNECT replies `2` and `7`, and known certificate verification errors on the proxied route are not retried. If reading the body fails after `2xx`, the client does not resend the POST: the server may already have processed it.
- If an HTTP(S) proxy rejects CONNECT with `429` or `5xx`, a permitted retry starts at the next resolved IP after the one that refused the tunnel, if there is another IP. This affects only the current delivery. CONNECT `403`/`407`, certificate errors, and Bot API responses do not trigger this rotation.
- For a retryable CONNECT rejection, a valid proxy `Retry-After` (whole seconds or an HTTP date) sets a minimum wait alongside the normal backoff. Without an unambiguous valid value, only backoff applies. If the hint strictly exceeds `retryMaxDelay`, the current delivery fails immediately, without a wait or another CONNECT. At equality, a retry is still allowed if attempts remain.
- The Bot API's `parameters.retry_after` is also a minimum delay before the next attempt, but it is not capped by `retryMaxDelay`.
- If Telegram's response body cannot be read, the delivery error includes the HTTP status but not the raw body.
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
