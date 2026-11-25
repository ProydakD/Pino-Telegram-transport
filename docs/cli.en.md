# CLI reference

English version · [Русская версия](cli.ru.md)

The bundled command line utility helps you validate Telegram credentials before enabling the transport and generate ready-to-use configuration snippets for Pino projects.

## Install the CLI

- Install the package globally: run `npm install -g pino-telegram-logger-transport`.
- Run it ad hoc with `npx pino-telegram-cli --help` inside your project.

## Validate credentials

- Run `pino-telegram-cli check --token <token>` to verify that the bot token is accepted by Telegram.
- Pass `--chat-id <id>` (comma-separated for multiple chats) to ensure the bot can access each destination.
- Supply `--thread-id <id>` along with a single chat to target a specific forum topic.
- Add `--probe-message` when you need to verify real send permissions: the CLI sends a muted test message and immediately tries to delete it.
- Without `--probe-message`, `check` stays read-only: it validates the token and chats via the Bot API, but does not publish anything.
- Set `TELEGRAM_PROXY_URL` or pass `--proxy-url` to route every step, including probe deletion, through the proxy. The flag wins over the environment. Use the environment rather than shell history for credentials.
- Omit explicit flags if you export `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_THREAD_ID` in the environment.
- Each CLI network request has a 10-second deadline, including proxy setup and reading the response. Steps in the same `check` invocation can reuse the tunnel.
- An invalid [proxy URL](configuration.en.md#client-behaviour) or a failed check returns a non-zero exit code. If SOCKS5 refuses authentication, the diagnostic tells you to check the proxy credentials without printing them.

### Example

```bash
pino-telegram-cli check --token 123:ABC --chat-id -1001234567890 --proxy-url socks5h://proxy.example:1080
```

```bash
pino-telegram-cli check --token 123:ABC --chat-id -1001234567890 --thread-id 777 --probe-message
```

## Generate configuration

- Produce a JSON snippet with `pino-telegram-cli generate-config --token <token> --chat-id <id>`.
- By default, the CLI writes the `<YOUR_BOT_TOKEN>` placeholder even if the real token comes from a flag or the environment.
- Add `--include-token` only when you explicitly want the real token in the JSON or `.env` output.
- The same proxy flag or environment variable adds `proxyUrl` (JSON) or `TELEGRAM_PROXY_URL` (env). A URL containing credentials is replaced in full by `<YOUR_PROXY_URL>`, even with `--include-token`.
- Switch to `.env` format with `--format env` to append variables to your environment file.
- Provide `--output path/to/file` to write the result instead of printing it to stdout.
- Combine `--chat-id` with several recipients (comma-separated) to emit an array in the JSON output.
- Populate placeholders automatically by defining `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, or `TELEGRAM_THREAD_ID` ahead of time.

### Example

```bash
pino-telegram-cli generate-config --token 123:ABC --chat-id -1001234567890 --format env --output .env.telegram
```

```bash
pino-telegram-cli generate-config --token 123:ABC --chat-id -1001234567890 --include-token
```

## Exit codes

- 0: all checks passed or the configuration snippet was generated successfully.
- 1: invalid input, a network, proxy or Telegram check failed, or writing the file failed.
