# FAQ

English version · [Русская версия](faq.ru.md)

## Why does the bot stay silent?

- Ensure the bot is added to the chat and has permission to post.
- Check that `botToken` and `chatId` are provided; otherwise the transport switches to a no-op mode and logs a warning.
- Enable `onDeliveryError` to inspect the Telegram response (`error.response`).

## How do I target multiple chats?

- Pass an array in `chatId`, for example `chatId: ['@channel', 123456789]`.
- Use objects `{ chatId, threadId }` to address a specific topic in a supergroup.
- Increase `minDelayBetweenMessages` to avoid hitting Telegram limits.

## What causes DataCloneError?

- Pino serialises transport options for the worker; functions (`formatMessage`, `send`, `onDeliveryError`) cannot be cloned.
- Disable the worker with `worker: { enabled: false }`, or create the transport manually and pass the stream to `pino`.

## How can I send captions longer than 1024 characters?

- Telegram caps media captions at 1024 characters — shorten the `caption` or move text to `sendMessage`.
- Store large files in object storage and send a URL instead of binary data.
- Use `document` for files that require a filename and content type.

## Can I test without hitting Telegram?

- Provide a custom `send` implementation that stores payloads in memory or posts to a mock HTTP server.
- Use Vitest with `vi.useFakeTimers()` to validate delays and retries.
- See `tests/transport.test.ts` and `examples/custom-send.ts` for reference.

## How do I detect rate limiting?

- Telegram returns status `429` along with a `retry_after` value.
- The transport respects this delay automatically, but consider increasing `minDelayBetweenMessages` if it happens frequently.
- Emit metrics inside `onDeliveryError` to monitor throttling events.
