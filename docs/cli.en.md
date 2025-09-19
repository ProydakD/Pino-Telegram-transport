# CLI reference

English version · [Русская версия](cli.ru.md)

The bundled command line utility helps you validate Telegram credentials before enabling the transport and generate ready-to-use configuration snippets for Pino projects.

## Install the CLI

- Install the package globally: run `npm install -g pino-telegram-logger-transport`.
- Run it ad hoc with `npx pino-telegram-cli --help` inside your project.

## Validate credentials

- Run `pino-telegram-cli check --token <token>` to verify that the bot token is accepted by Telegram.
- Pass `--chat-id <id>` (comma-separated for multiple chats) to ensure the bot can access each destination.
- Supply `--thread-id <id>` along with a single chat to confirm that a forum topic is reachable.
- Omit explicit flags if you export `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and `TELEGRAM_THREAD_ID` in the environment.
- Expect a non-zero exit code if Telegram rejects the token, chat, or thread.

### Example

```bash
pino-telegram-cli check --token 123:ABC --chat-id -1001234567890
```

## Generate configuration

- Produce a JSON snippet with `pino-telegram-cli generate-config --token <token> --chat-id <id>`.
- Switch to `.env` format with `--format env` to append variables to your environment file.
- Provide `--output path/to/file` to write the result instead of printing it to stdout.
- Combine `--chat-id` with several recipients (comma-separated) to emit an array in the JSON output.
- Populate placeholders automatically by defining `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, or `TELEGRAM_THREAD_ID` ahead of time.

### Example

```bash
pino-telegram-cli generate-config --token 123:ABC --chat-id -1001234567890 --format env --output .env.telegram
```

## Exit codes

- 0: all checks passed or the configuration snippet was generated successfully.
- 1: invalid input, Telegram rejected one of the checks, or writing the file failed.
