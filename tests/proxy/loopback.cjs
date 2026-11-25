// Загружается только в дочернем тестовом процессе и его Pino worker.
// Подменяем только адрес Bot API. Для отдельной регрессии задаём два DNS-адреса
// этого имени с IPv6 первым независимо от системного списка и порядка.
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
