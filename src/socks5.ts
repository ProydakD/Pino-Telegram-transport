import { isIP, type Socket } from 'node:net';
import { finished } from 'node:stream';
import { connectToProxy, lookupAddresses } from './proxy-dns';

export class SocksAuthenticationError extends Error {
  constructor() {
    super('Прокси SOCKS5 отклонил авторизацию; проверьте учётные данные');
  }
}

export class SocksConnectError extends Error {
  constructor(readonly reply: number) {
    const explanation = reply === 8 ? ': не поддерживает переданный тип адреса' : '';
    super(`Прокси SOCKS5 отклонил CONNECT (код ${reply})${explanation}`);
  }
}

class SocksAddressTimeoutError extends Error {}

export async function connectSocks5(
  proxy: URL,
  target: { host: string; port: number },
  signal: AbortSignal,
  timeoutMs = 0,
): Promise<Socket> {
  const addresses =
    proxy.protocol === 'socks5:' && !isIP(target.host)
      ? (await lookupAddresses(target.host, signal)).map(({ address }) => address)
      : [target.host];

  for (const [index, host] of addresses.entries()) {
    try {
      // Делим бюджет только между локально разрешёнными адресами назначения.
      // Последнему адресу оставляем остаток общего дедлайна; ноль не вводит новый таймаут.
      const addressTimeout = index < addresses.length - 1 ? timeoutMs / addresses.length : 0;
      return await openSocksTunnel(proxy, { host, port: target.port }, signal, addressTimeout);
    } catch (error) {
      // Другой адрес может помочь только при отказе CONNECT, а не при отказе
      // авторизации, запрете правилами прокси или обрыве самого соединения с прокси.
      if (
        signal.aborted ||
        (!(error instanceof SocksAddressTimeoutError) &&
          (!(error instanceof SocksConnectError) || ![1, 3, 4, 5, 6, 8].includes(error.reply))) ||
        index === addresses.length - 1
      ) {
        throw error;
      }
    }
  }
  throw new Error('DNS не вернул ни одного адреса для SOCKS5');
}

async function openSocksTunnel(
  proxy: URL,
  target: { host: string; port: number },
  signal: AbortSignal,
  addressTimeout: number,
): Promise<Socket> {
  const { socket } = await connectToProxy(proxy, signal);
  const abort = () => socket.destroy();
  signal.addEventListener('abort', abort, { once: true });
  let timer: NodeJS.Timeout | undefined;
  let addressTimedOut = false;
  try {
    signal.throwIfAborted();
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

    // Таймер начинается после авторизации и касается только ответа CONNECT.
    // Ни отказ авторизации, ни медленный POST не являются поводом сменить IP.
    if (addressTimeout > 0) {
      timer = setTimeout(() => {
        addressTimedOut = true;
        socket.destroy();
      }, addressTimeout);
      timer.unref();
    }

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
    if (addressTimedOut && !signal.aborted) throw new SocksAddressTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
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
