# Installation and Updates

English version · [Русская версия](install.ru.md)

## Requirements

- Use Node.js 18 or newer (the built-in `fetch` API is required).
- Use Node.js 20 or newer when your project depends on `pino@10`.
- Create a Telegram bot and make sure it can post to the target chats.
- Allow outbound connections to `https://api.telegram.org`.

## Compatibility matrix

- `pino@^9` on Node.js 18+
- `pino@^10` on Node.js 20+

## Installation

1. Install the transport together with a supported `pino` version, because `pino` is declared as a peer dependency.
2. Use one of the supported commands:

```bash
npm install pino@^10 pino-telegram-logger-transport
# or
npm install pino@^9 pino-telegram-logger-transport
```

## Updating

1. Upgrade both packages inside the supported matrix.
2. For example, stay on the latest minor in the same major line:

```bash
npm install pino@^10 pino-telegram-logger-transport@latest
```
