// Загружается только в дочернем тестовом процессе и его Pino worker.
// Подменяем адрес Bot API. Для DNS-регрессий задаём два адреса localhost
// с IPv6 первым; тест выбирает, использовать это имя для API или для прокси.
if (process.env.FIXTURE_DUAL_STACK === '1') {
  const dns = require('node:dns');
  const lookup = dns.lookup;
  const addresses = [
    { address: '::1', family: 6 },
    { address: '127.0.0.1', family: 4 },
  ];
  dns.lookup = (host, options, callback) => {
    if (host !== 'localhost') return lookup(host, options, callback);
    if (typeof options === 'function') callback = options;
    queueMicrotask(() => (options?.all ? callback(null, addresses) : callback(null, '::1', 6)));
  };
}

const utils = require('../../dist/utils');
const buildUrl = utils.buildTelegramUrl;
utils.buildTelegramUrl = (token, method) => {
  const url = new URL(buildUrl(token, method));
  url.hostname = process.env.FIXTURE_API_HOST ?? 'localhost';
  url.port = process.env.FIXTURE_PORT;
  return url.href;
};
