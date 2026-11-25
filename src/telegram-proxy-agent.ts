import type { ClientRequest } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { connect as connectTls } from 'node:tls';
import { Agent, type AgentConnectOpts } from 'agent-base';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { connectToProxy } from './proxy-dns';
import { connectSocks5 } from './socks5';

export class TelegramProxyAgent extends Agent {
  readonly #proxy: URL;
  readonly #requestSignals = new WeakMap<ClientRequest, AbortSignal>();
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

  createRequest(url: string, options: RequestOptions): ClientRequest {
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
    if (signal) this.#requestSignals.set(req, signal);
    return req;
  }

  async connect(req: ClientRequest, options: AgentConnectOpts) {
    if (this.#closed) throw new Error('Прокси-агент закрыт');
    const signal = this.#requestSignals.get(req);
    signal?.throwIfAborted();

    const handshake = new AbortController();
    const abort = () => handshake.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    this.#pending.add(handshake);
    try {
      const socket = await this.#openTunnel(req, options, handshake.signal);
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

  async #openTunnel(req: ClientRequest, options: AgentConnectOpts, signal: AbortSignal) {
    const proxy = this.#proxy;
    if (proxy.protocol.startsWith('socks5')) {
      if (!options.secureEndpoint || !options.host) throw new Error('SOCKS5 требует HTTPS-адрес');
      const { host, port, servername } = options;
      const socket = await connectSocks5(proxy, { host, port }, signal);
      try {
        // DNS fallback меняет адрес CONNECT, но не TLS-имя Telegram.
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

    // https-proxy-agent пишет URL в DEBUG. Передаём ему адрес без учётных данных,
    // а заголовок авторизации строим только при CONNECT. Пул принадлежит этому агенту.
    const address = new URL(proxy.href);
    address.username = '';
    address.password = '';
    const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
    return connectToProxy(address.hostname.replace(/^\[|\]$/g, ''), signal, (lookup) =>
      new HttpsProxyAgent(address, {
        ...lookup,
        keepAlive: true,
        signal,
        headers: () =>
          proxy.username || proxy.password
            ? { 'Proxy-Authorization': `Basic ${Buffer.from(credentials).toString('base64')}` }
            : {},
      }).connect(req, options),
    );
  }
}
