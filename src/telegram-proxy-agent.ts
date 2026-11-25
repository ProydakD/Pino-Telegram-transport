import type { ClientRequest } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { Agent, type AgentConnectOpts } from 'agent-base';
import { openHttpTunnel } from './http-connect';
import { connectSocks5 } from './socks5';

interface ProxyAttempt {
  signal?: AbortSignal;
  afterAddress?: string;
}

export class TelegramProxyAgent extends Agent {
  readonly #proxy: URL;
  readonly #attempts = new WeakMap<ClientRequest, ProxyAttempt>();
  readonly #pending = new Set<AbortController>();
  #closed = false;

  constructor(proxy: URL) {
    super({ keepAlive: true, maxFreeSockets: 1 });
    // Агент обслуживает только HTTPS. Не даём agent-base определять протокол по стеку ошибок.
    this.protocol = 'https:';
    this.defaultPort = 443;
    this.#proxy = proxy;
  }

  getProxyUrl(): URL {
    return this.#proxy;
  }

  createRequest(url: string, options: RequestOptions, afterAddress?: string): ClientRequest {
    if (this.#closed) throw new Error('Прокси-агент закрыт');
    const { signal } = options;
    signal?.throwIfAborted();
    const { protocol, hostname, port, pathname, search } = new URL(url);
    // Node 18.12 переносит href и pathname из URL в отладочный вывод агента.
    // Токен нужен только в пути запроса, а не в параметрах подключения.
    const req = request({
      ...options,
      agent: this,
      protocol,
      hostname: hostname.replace(/^\[|\]$/g, ''),
      port,
      path: pathname + search,
    });
    // Node привязывает signal к ClientRequest, но не передаёт его агенту.
    // agent-base вызывает connect асинхронно, после регистрации сигнала.
    this.#attempts.set(req, { signal, afterAddress });
    return req;
  }

  async connect(req: ClientRequest, options: AgentConnectOpts) {
    if (this.#closed) throw new Error('Прокси-агент закрыт');
    const { signal, afterAddress } = this.#attempts.get(req) ?? {};
    signal?.throwIfAborted();

    const handshake = new AbortController();
    const abort = () => handshake.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    this.#pending.add(handshake);
    try {
      const socket = await this.#openTunnel(options, handshake.signal, afterAddress);
      if (handshake.signal.aborted) {
        socket.destroy();
        handshake.signal.throwIfAborted();
      }
      return socket;
    } finally {
      // Установленный туннель может обслуживать другие запросы. Сигнал первого
      // запроса больше не должен прерывать соединение с прокси.
      signal?.removeEventListener('abort', abort);
      this.#pending.delete(handshake);
    }
  }

  destroy(): void {
    this.#closed = true;
    // Agent.destroy видит только сокеты, уже переданные HTTP-клиенту.
    for (const handshake of this.#pending) handshake.abort();
    super.destroy();
  }

  async #openTunnel(options: AgentConnectOpts, signal: AbortSignal, afterAddress?: string) {
    if (!options.secureEndpoint || !options.host) throw new Error('Прокси требует HTTPS-адрес');
    const { host, port, servername } = options;
    const target = { host, port };
    const socket = this.#proxy.protocol.startsWith('socks5')
      ? await connectSocks5(this.#proxy, target, signal)
      : await openHttpTunnel(this.#proxy, target, signal, afterAddress);
    try {
      signal.throwIfAborted();
      // Выбор IP для прокси и SOCKS CONNECT не меняет TLS-имя Bot API.
      return connectTls({
        ...options,
        path: undefined,
        servername: servername ?? (isIP(host) ? undefined : host),
        socket,
      });
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }
}
