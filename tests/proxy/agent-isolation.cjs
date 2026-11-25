const assert = require('node:assert/strict');
const { parseProxyUrl, requestTelegram } = require('../../dist/telegram-http');
const { TelegramProxyAgent } = require('../../dist/telegram-proxy-agent');
const { buildTelegramUrl } = require('../../dist/utils');

async function main() {
  const agent = new TelegramProxyAgent(parseProxyUrl(process.env.TELEGRAM_PROXY_URL));
  const url = buildTelegramUrl(process.env.TELEGRAM_BOT_TOKEN, 'sendMessage');
  const send = async (signal) => {
    const response = await requestTelegram(url, { method: 'POST', signal }, agent);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
  };
  try {
    const first = new AbortController();
    await send(first.signal);
    first.abort(); // Сигнал завершившегося запроса не должен закрывать свободный туннель.

    const stalled = new AbortController();
    const failure = assert.rejects(
      requestTelegram(`${url}?stall=1`, { method: 'POST', signal: stalled.signal }, agent),
      /ABORT_ERR/,
    );
    await send(); // Второй туннель нужен, пока первый занят запросом без ответа.
    stalled.abort();
    await failure;
    await send(); // Второй туннель остаётся пригодным после отмены первого запроса.
  } finally {
    agent.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
