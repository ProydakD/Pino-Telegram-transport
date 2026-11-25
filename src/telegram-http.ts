import { Readable } from 'node:stream';
import { json as readJson } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { domainToASCII } from 'node:url';
import { SocksAuthenticationError, SocksConnectError } from './socks5';
import type { TelegramProxyAgent } from './telegram-proxy-agent';

export class ProxyConfigurationError extends Error {}

export class ProxyRequestError extends Error {
  constructor(readonly code?: string) {
    super(`Не удалось выполнить запрос через прокси${code ? ` (${code})` : ''}`);
  }
}

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
      // Ошибка escape-последовательности — ошибка настройки до любых сетевых попыток.
      const username = decodeURIComponent(url.username);
      const password = decodeURIComponent(url.password);
      // WHATWG URL не нормализует hostname у нестандартных схем socks5(h).
      if (url.protocol.startsWith('socks5')) {
        if (Boolean(username) !== Boolean(password)) {
          throw new ProxyConfigurationError('proxyUrl: для SOCKS5 укажите и логин, и пароль');
        }
        if (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255) {
          throw new ProxyConfigurationError(
            'proxyUrl: логин и пароль SOCKS5 — не более 255 байт каждый',
          );
        }
        const hostname = domainToASCII(url.hostname);
        if (!hostname) throw new TypeError();
        url.hostname = hostname;
      } else if (username.includes(':')) {
        // HTTP Basic разделяет логин и пароль по первому двоеточию после декодирования.
        throw new ProxyConfigurationError('proxyUrl: логин HTTP(S)-прокси не должен содержать ":"');
      }
      if (url.hostname && url.port !== '0') return url;
    } catch (error) {
      if (error instanceof ProxyConfigurationError) throw error;
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
  agent?: TelegramProxyAgent,
): Promise<TelegramHttpResponse> {
  if (!agent) return fetch(url, options);

  const { signal, body } = options;
  // На Node 18 с --no-experimental-fetch глобальных FormData и Response нет.
  const multipart = body === undefined || typeof body === 'string' ? undefined : new Response(body);
  try {
    return await new Promise<TelegramHttpResponse>((resolve, reject) => {
      const req = agent.createRequest(url, {
        method: options.method,
        headers: multipart
          ? { 'content-type': multipart.headers.get('content-type')! }
          : options.headers,
        signal,
      });
      req.once('error', reject);
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
        // Как и fetch, возвращаем статус до чтения тела: обрыв JSON не отменяет HTTP 200.
        resolve({
          ok: status >= 200 && status < 300,
          status,
          statusText: response.statusMessage ?? '',
          json: () => readJson(response),
        });
      });
      if (multipart?.body) {
        // Response сериализует FormData в нативный Web Stream Node. На ранних Node 18
        // Writable.toWeb не принимает ClientRequest, поэтому адаптируем источник.
        pipeline(Readable.fromWeb(multipart.body as ReadableStream), req, { signal }).catch(reject);
      } else {
        req.end(typeof body === 'string' ? body : undefined);
      }
    });
  } catch (error) {
    if (error instanceof SocksAuthenticationError || error instanceof SocksConnectError)
      throw error;
    // Ошибки агента могут содержать разобранный запрос или ответ прокси, включая секреты.
    // Сохраняем для политики повторов только безопасный код Node, без исходной ошибки.
    const code = error instanceof Error && 'code' in error ? error.code : undefined;
    throw new ProxyRequestError(
      typeof code === 'string' && /^[A-Z_0-9]+$/.test(code) ? code : undefined,
    );
  }
}
