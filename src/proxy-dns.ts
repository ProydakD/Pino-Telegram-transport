import dns from 'node:dns';
import { isIP, Socket } from 'node:net';

const PROXY_TCP_STAGGER_MS = 250;

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

export async function connectToProxy(
  proxy: URL,
  signal: AbortSignal,
  afterAddress?: string,
): Promise<{ socket: Socket; address: string }> {
  signal.throwIfAborted();
  const host = proxy.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(host);
  const resolved = family ? [{ address: host, family }] : await lookupAddresses(host, signal);
  signal.throwIfAborted();
  const unique = [...new Map(resolved.map((entry) => [entry.address, entry])).values()];
  if (!unique.length) throw new Error('DNS не вернул ни одного адреса прокси');
  const start = unique.findIndex(({ address }) => address === afterAddress) + 1;
  const addresses = unique.slice(start).concat(unique.slice(0, start));
  const port = proxy.port
    ? Number(proxy.port)
    : proxy.protocol === 'https:'
      ? 443
      : proxy.protocol === 'http:'
        ? 80
        : 1080;

  return new Promise((resolve, reject) => {
    const pending = new Set<Socket>();
    let next = 0;
    let timer: NodeJS.Timeout | undefined;

    function cleanup() {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      for (const socket of pending) socket.destroy();
      pending.clear();
    }

    function abort() {
      cleanup();
      reject(signal.reason);
    }

    function dialNext() {
      clearTimeout(timer);
      const { address, family } = addresses[next++];
      const socket = new Socket();
      pending.add(socket);
      socket.once('connect', () => {
        if (!pending.delete(socket)) return;
        socket.off('error', fail);
        cleanup();
        resolve({ socket, address });
      });
      socket.once('error', fail);

      function fail(error: unknown) {
        if (!pending.delete(socket)) return;
        socket.destroy();
        if (next < addresses.length) dialNext();
        else if (!pending.size) {
          cleanup();
          reject(error);
        }
      }

      // Задержка запускает запасного кандидата, но не обрывает медленный сокет.
      // TLS и CONNECT выполняются только один раз, на первом подключившемся TCP.
      if (next < addresses.length) timer = setTimeout(dialNext, PROXY_TCP_STAGGER_MS);
      try {
        socket.connect({ host: address, port, family });
      } catch (error) {
        fail(error);
      }
    }

    signal.addEventListener('abort', abort, { once: true });
    dialNext();
  });
}
