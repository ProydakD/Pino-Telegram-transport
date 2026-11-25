import dns from 'node:dns';
import { createConnection, isIP, Socket } from 'node:net';
import { finished } from 'node:stream';

export class SocksAuthenticationError extends Error {
  constructor() {
    super('Прокси SOCKS5 отклонил авторизацию; проверьте учётные данные');
  }
}

class SocksConnectError extends Error {
  constructor(readonly reply: number) {
    super(`Прокси SOCKS5 отклонил CONNECT (код ${reply})`);
  }
}

export async function connectSocks5(
  proxy: URL,
  target: { host: string; port: number },
  signal: AbortSignal,
): Promise<Socket> {
  const addresses =
    proxy.protocol === 'socks5:' && !isIP(target.host)
      ? await lookupSocksTarget(target.host, signal)
      : [target.host];

  for (const [index, host] of addresses.entries()) {
    try {
      return await openSocksTunnel(proxy, { host, port: target.port }, signal);
    } catch (error) {
      // Другой адрес может помочь только при отказе CONNECT, а не при отказе
      // авторизации, запрете правилами прокси или обрыве самого соединения с прокси.
      if (
        !(error instanceof SocksConnectError) ||
        ![1, 3, 4, 5, 6, 8].includes(error.reply) ||
        index === addresses.length - 1
      ) {
        throw error;
      }
    }
  }
  throw new Error('DNS не вернул ни одного адреса для SOCKS5');
}

function lookupSocksTarget(host: string, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // Системный lookup не отменяется, но поздний результат уже не откроет сокет.
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    dns.lookup(host, { all: true }, (error, addresses) => {
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(addresses.map(({ address }) => address));
    });
  });
}

async function openSocksTunnel(
  proxy: URL,
  target: { host: string; port: number },
  signal: AbortSignal,
): Promise<Socket> {
  signal.throwIfAborted();
  const socket = createConnection({
    host: proxy.hostname.replace(/^\[|\]$/g, ''),
    port: proxy.port ? Number(proxy.port) : 1080,
    signal,
  });

  try {
    // Только CONNECT и методы без авторизации / логин-пароль (RFC 1928 и 1929).
    // Сокетом владеет этот handshake: нет отдельного таймера или вывода userinfo в DEBUG.
    const user = Buffer.from(decodeURIComponent(proxy.username));
    const password = Buffer.from(decodeURIComponent(proxy.password));
    const hasCredentials = user.length > 0 || password.length > 0;
    socket.write(Buffer.from(hasCredentials ? [5, 2, 0, 2] : [5, 1, 0]));
    const [version, method] = await readSocksBytes(socket, 2);
    if (version !== 5) throw new Error('Некорректный ответ SOCKS5');
    if (method === 2 && hasCredentials) {
      socket.write(
        Buffer.concat([
          Buffer.from([1, user.length]),
          user,
          Buffer.from([password.length]),
          password,
        ]),
      );
      const [authVersion, status] = await readSocksBytes(socket, 2);
      if (authVersion !== 1) throw new Error('Некорректный ответ авторизации SOCKS5');
      if (status !== 0) throw new SocksAuthenticationError();
    } else if (method !== 0) {
      throw new SocksAuthenticationError();
    }

    const port = Buffer.alloc(2);
    port.writeUInt16BE(target.port);
    socket.write(Buffer.concat([Buffer.from([5, 1, 0]), encodeSocksAddress(target.host), port]));

    const [replyVersion, reply, reserved, type] = await readSocksBytes(socket, 4);
    if (replyVersion !== 5 || reserved !== 0) throw new Error('Некорректный ответ CONNECT SOCKS5');
    if (reply !== 0) throw new SocksConnectError(reply);

    let length: number;
    switch (type) {
      case 1:
        length = 4;
        break;
      case 3:
        [length] = await readSocksBytes(socket, 1);
        break;
      case 4:
        length = 16;
        break;
      default:
        throw new Error('Некорректный тип адреса в ответе CONNECT SOCKS5');
    }
    // Читаем ровно BND.ADDR и BND.PORT и передаём остаток потока TLS-клиенту.
    await readSocksBytes(socket, length + 2);
    return socket;
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

function readSocksBytes(socket: Socket, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const truncated = () => new Error('Прокси закрыл соединение до завершения SOCKS5');
    const stop = finished(socket, { readable: true, writable: false }, (error) => {
      socket.off('readable', read);
      stop();
      reject(error ?? truncated());
    });
    function read() {
      const bytes: Buffer | null = socket.read(length);
      if (bytes === null) return;
      socket.off('readable', read);
      stop();
      if (bytes.length === length) resolve(bytes);
      else reject(truncated());
    }
    socket.on('readable', read);
    read();
  });
}

function encodeSocksAddress(host: string): Buffer {
  const family = isIP(host);
  if (family === 4) return Buffer.from([1, ...host.split('.').map(Number)]);
  if (family === 6) {
    // URL приводит IPv4-mapped адрес к шестнадцатеричной записи, но сохраняет ::.
    const ipv6 = new URL(`http://[${host.split('%')[0]}]/`).hostname.slice(1, -1);
    const [prefix, suffix] = ipv6.split('::');
    const words = prefix ? prefix.split(':') : [];
    if (suffix !== undefined) {
      const tail = suffix ? suffix.split(':') : [];
      while (words.length + tail.length < 8) words.push('0');
      words.push(...tail);
    }
    const address = Buffer.alloc(17);
    address[0] = 4;
    words.forEach((word, index) => address.writeUInt16BE(Number.parseInt(word, 16), 1 + 2 * index));
    return address;
  }
  const name = Buffer.from(host);
  if (name.length > 255) throw new Error('Слишком длинное имя назначения SOCKS5');
  return Buffer.concat([Buffer.from([3, name.length]), name]);
}
