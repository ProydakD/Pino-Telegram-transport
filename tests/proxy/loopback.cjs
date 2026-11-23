// Загружается только в дочернем тестовом процессе и его Pino worker.
// Подменяем адрес Bot API, но не DNS, TLS, HTTP-клиент или агенты прокси.
const utils = require('../../dist/utils');
const buildUrl = utils.buildTelegramUrl;
utils.buildTelegramUrl = (token, method) => {
  const url = new URL(buildUrl(token, method));
  url.hostname = 'localhost';
  url.port = process.env.FIXTURE_PORT;
  return url.href;
};
