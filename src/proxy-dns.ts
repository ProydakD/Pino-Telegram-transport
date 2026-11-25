import dns from 'node:dns';
import { isIP, type TcpNetConnectOpts } from 'node:net';

export function lookupAddresses(host: string, signal: AbortSignal): Promise<dns.LookupAddress[]> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // Системный lookup не отменяется, но поздний результат уже не откроет сокет.
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    dns.lookup(host, { all: true }, (error, addresses) => {
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

type ProxyLookup = Pick<TcpNetConnectOpts, 'lookup' | 'autoSelectFamily'>;

export async function connectToProxy<T>(
  host: string,
  signal: AbortSignal,
  connect: (options: ProxyLookup) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  if (isIP(host)) return connect({});

  const addresses = await lookupAddresses(host, signal);
  for (const [index, { address, family }] of addresses.entries()) {
    signal.throwIfAborted();
    try {
      // Подменяем только результат lookup: TLS продолжает проверять имя прокси.
      // На ранней Node 18 встроенного перебора адресов нет.
      return await connect({
        autoSelectFamily: false,
        lookup: (_host, _options, callback) =>
          queueMicrotask(() => callback(null, address, family)),
      });
    } catch (error) {
      // Не переходим на другой адрес после ошибки TLS или отказа CONNECT.
      if (
        !(error instanceof Error && 'syscall' in error && error.syscall === 'connect') ||
        index === addresses.length - 1
      ) {
        throw error;
      }
    }
  }
  throw new Error('DNS не вернул ни одного адреса прокси');
}
