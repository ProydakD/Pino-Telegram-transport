import { once } from 'node:events';
import { request } from 'node:http';
import { isIP, type Socket } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { connectToProxy } from './proxy-dns';

export class ProxyConnectError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | undefined,
    readonly address: string,
  ) {
    super(`Proxy CONNECT failed (HTTP ${status})`);
  }
}

export async function openHttpTunnel(
  proxy: URL,
  target: { host: string; port: number },
  signal: AbortSignal,
  afterAddress?: string,
): Promise<Socket> {
  const { socket: tcp, address } = await connectToProxy(proxy, signal, afterAddress);
  let socket = tcp;
  const abort = () => socket.destroy();
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    if (proxy.protocol === 'https:') {
      // IP выбирает TCP-маршрут, но для проверки сертификата нужно исходное имя прокси.
      const host = proxy.hostname.replace(/^\[|\]$/g, '');
      socket = connectTls({
        socket: tcp,
        host,
        servername: isIP(host) ? undefined : host,
        ALPNProtocols: ['http/1.1'],
      });
      await once(socket, 'secureConnect', { signal });
    }

    const authority = `${isIP(target.host) === 6 ? `[${target.host}]` : target.host}:${target.port}`;
    await new Promise<void>((resolve, reject) => {
      // CONNECT использует готовый сокет без своего пула или повторного DNS.
      // Только внешний HTTPS-агент переиспользует успешно открытый туннель.
      const req = request({
        method: 'CONNECT',
        path: authority,
        headers: { Host: authority, Connection: 'keep-alive', 'Proxy-Connection': 'Keep-Alive' },
        createConnection: () => socket,
        signal,
      });
      if (proxy.username || proxy.password) {
        const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
        req.setHeader(
          'Proxy-Authorization',
          `Basic ${Buffer.from(credentials).toString('base64')}`,
        );
      }
      req.once('error', reject);
      req.once('connect', (response, _socket, head) => {
        const status = response.statusCode ?? 502;
        if (status < 200 || status >= 300) {
          // Тело, reason phrase и произвольные заголовки прокси не доходят до доставки.
          reject(
            new ProxyConnectError(
              status,
              parseRetryAfter(response.rawHeaders),
              address,
            ),
          );
          return;
        }
        if (head.length) socket.unshift(head);
        resolve();
      });
      req.end();
    });
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function parseRetryAfter(rawHeaders: string[]): number | undefined {
  // headersDistinct отсутствует на Node 18.0–18.2; rawHeaders сохраняет дубликаты.
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === 'retry-after') values.push(rawHeaders[index + 1]);
  }
  if (values.length !== 1) return undefined;
  const value = values[0]; // HTTP-парсер уже убрал допустимые пробелы по краям значения.
  if (/^\d+$/.test(value)) return Number(value) * 1000;

  const now = Date.now();
  const date = normalizeHttpDate(value, now);
  const timestamp = Date.parse(date);
  // Date.parse принимает списки, не-HTTP форматы и нормализует несуществующие даты.
  if (
    date.length !== 29 ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toUTCString() !== date
  ) {
    return undefined;
  }
  return Math.max(0, timestamp - now);
}

function normalizeHttpDate(value: string, now: number): string {
  // RFC 9110 §5.6.7: кроме IMF-fixdate получатель принимает RFC 850 и asctime.
  const rfc850 =
    /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(
      value,
    );
  if (rfc850) {
    const [, weekday, day, month, shortYear, time] = rfc850;
    const limit = new Date(now);
    const limitYear = limit.getUTCFullYear() + 50;
    limit.setUTCFullYear(limitYear);
    let year = Math.floor(limitYear / 100) * 100 + Number(shortYear);
    if (Date.parse(`${day} ${month} ${year} ${time} GMT`) > limit.getTime()) year -= 100;
    return `${weekday.slice(0, 3)}, ${day} ${month} ${year} ${time} GMT`;
  }
  const asctime = /^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) ( \d|\d{2}) (\d{2}:\d{2}:\d{2}) (\d{4})$/.exec(
    value,
  );
  if (asctime) {
    const [, weekday, month, day, time, year] = asctime;
    return `${weekday}, ${day.trim().padStart(2, '0')} ${month} ${year} ${time} GMT`;
  }
  return value;
}
