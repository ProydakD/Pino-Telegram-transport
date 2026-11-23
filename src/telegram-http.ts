import dns from 'node:dns';
import { request } from 'node:https';
import { Writable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

export class ProxyConfigurationError extends Error {}

export function redactTelegramDiagnostic(message: string, token: string, proxy?: URL): string {
  const password = proxy?.password;
  for (const secret of [
    token,
    encodeURIComponent(token),
    password,
    password && decodeURIComponent(password),
  ]) {
    if (secret) message = message.split(secret).join('[REDACTED]');
  }
  return message;
}

export function parseProxyUrl(value: unknown): URL | undefined {
  if (value === undefined) return undefined;
  // Только адрес сервера, а не ссылка-приглашение t.me/proxy с секретом в query.
  if (typeof value === 'string' && /^(?:https?|socks5h?):\/\/[^/\\?#\s]+\/?$/i.test(value)) {
    try {
      const url = new URL(value);
      // Оба агента декодируют userinfo. Ошибка escape-последовательности — ошибка настройки.
      decodeURIComponent(url.username);
      decodeURIComponent(url.password);
      if (url.hostname && url.port !== '0') return url;
    } catch {
      // Ошибка URL может содержать исходную строку вместе с паролем.
    }
  }
  throw new ProxyConfigurationError('proxyUrl: ожидается адрес HTTP(S)- или SOCKS5-прокси');
}

interface TelegramHttpOptions {
  method?: 'POST';
  headers?: Record<string, string>;
  body?: string | FormData;
  signal?: AbortSignal;
}

type TelegramHttpResponse = Pick<Response, 'ok' | 'status' | 'statusText' | 'json'>;

export async function requestTelegram(
  url: string,
  options: TelegramHttpOptions,
  proxy: URL | undefined,
  timeoutMs: number,
): Promise<TelegramHttpResponse> {
  if (!proxy) return fetch(url, options);

  // До завершения CONNECT у ClientRequest ещё нет сокета. Ограничиваем и handshake
  // самого агента, а не только чтение ответа Telegram.
  const { signal, body } = options;
  const agent = createProxyAgent(proxy, signal, timeoutMs);
  const multipart = body instanceof FormData ? new Response(body) : undefined;
  try {
    return await new Promise<TelegramHttpResponse>((resolve, reject) => {
      signal?.throwIfAborted();
      const req = request(url, {
        agent,
        method: options.method,
        headers: multipart
          ? { 'content-type': multipart.headers.get('content-type')! }
          : options.headers,
        signal,
        // Если локальный DNS завершился уже после дедлайна, не начинаем SOCKS handshake.
        lookup:
          proxy.protocol === 'socks5:' && signal
            ? (host, _, done) =>
                dns.lookup(host, (err, address, family) =>
                  done(signal.aborted ? signal.reason : err, address, family),
                )
            : undefined,
      });
      req.once('error', reject);
      if (signal) {
        // До выдачи сокета агентом req.destroy() откладывает событие error.
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        req.once('close', () => signal.removeEventListener('abort', abort));
      }
      req.once('proxyConnect', ({ statusCode }: { statusCode: number }) => {
        if (statusCode !== 200) {
          // Текст отказа CONNECT не является ответом Bot API и может содержать userinfo.
          resolve({
            ok: false,
            status: statusCode,
            statusText: `Proxy CONNECT failed (HTTP ${statusCode})`,
            json: async () => ({}),
          });
        }
      });
      req.once('response', (response) => {
        const status = response.statusCode ?? 502;
        text(response).then(
          (content) =>
            resolve({
              ok: status >= 200 && status < 300,
              status,
              statusText: response.statusMessage ?? '',
              json: async () => JSON.parse(content),
            }),
          reject,
        );
      });
      if (multipart?.body) {
        // Response формирует boundary и поток из того же FormData, что получает fetch.
        multipart.body.pipeTo(Writable.toWeb(req), { signal }).catch(reject);
      } else {
        req.end(body);
      }
    });
  } catch (error) {
    agent.destroy();
    // Ошибки агента могут содержать разобранный запрос или ответ прокси, включая секреты.
    const code = (error as NodeJS.ErrnoException)?.code;
    const reason = code && /^[A-Z_0-9]+$/.test(code) ? ` (${code})` : '';
    throw new Error(`Не удалось выполнить запрос через прокси${reason}`);
  }
}

function createProxyAgent(proxy: URL, signal: AbortSignal | undefined, timeoutMs: number) {
  if (proxy.protocol.startsWith('socks5')) {
    return new SocksProxyAgent(proxy, { timeout: timeoutMs || undefined });
  }
  // Агент пишет переданный URL в DEBUG; передаём учётные данные только в CONNECT.
  const address = new URL(proxy.href);
  address.username = '';
  address.password = '';
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  return new HttpsProxyAgent(address, {
    signal,
    headers: () =>
      proxy.username || proxy.password
        ? { 'Proxy-Authorization': `Basic ${Buffer.from(credentials).toString('base64')}` }
        : {},
  });
}
