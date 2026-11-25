const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { once } = require('node:events');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { buffer } = require('node:stream/consumers');

const cert = join(__dirname, 'localhost-cert.pem');
const tls = { cert: readFileSync(cert), key: readFileSync(join(__dirname, 'localhost-key.pem')) };
const password = 'fixture:secret';
const basicAuth = 'Basic ' + Buffer.from('user:' + password).toString('base64');

async function listen(t, server) {
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => sockets.delete(socket));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        for (const socket of sockets) socket.destroy();
      }),
  );
  return server.address().port;
}

async function startApi(t, replies = []) {
  const requests = [];
  const server = https.createServer(tls, async (req, res) => {
    const url = new URL(req.url, 'https://localhost');
    const method = url.pathname.split('/').pop();
    requests.push({ method, url, headers: req.headers, body: await buffer(req) });
    const reply = (Array.isArray(replies) ? replies.shift() : replies(url)) ?? 200;
    if (typeof reply === 'function') return reply(res);
    const status = reply;
    const result = {
      getChat: { id: 42, type: 'group' },
      getMe: { id: 1, first_name: 'Fixture' },
      sendMessage: { message_id: 17 },
    };
    res.writeHead(status, { 'content-type': 'application/json' });
    const failure = status !== 200 && { description: `Rejected ${url.pathname}: ${password}` };
    res.end(JSON.stringify({ ok: status === 200, result: result[method] ?? true, ...failure }));
  });
  return { port: await listen(t, server), requests };
}

// Стенд никогда не подключается к адресу, запрошенному клиентом: upstream всегда loopback.
function tunnel(socket, apiPort, ready) {
  const upstream = net.connect(apiPort, '127.0.0.1', () => {
    socket.write(ready);
    upstream.pipe(socket).pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
  socket.on('close', () => upstream.destroy());
}

async function startConnect(t, apiPort, protocol, auth = true) {
  const targets = [];
  const serverNames = [];
  let connections = 0;
  const server = protocol === 'https' ? https.createServer(tls) : http.createServer();
  server.on('connection', () => connections++);
  server.on('secureConnection', (socket) => serverNames.push(socket.servername));
  server.on('connect', (req, socket) => {
    targets.push(req.url);
    if (auth && req.headers['proxy-authorization'] !== basicAuth) {
      socket.end(`HTTP/1.1 407 ${password}\r\nContent-Length: 0\r\n\r\n`);
    } else {
      tunnel(socket, apiPort, 'HTTP/1.1 200 OK\r\n\r\n');
    }
  });
  const port = await listen(t, server);
  return {
    targets,
    serverNames,
    get connections() {
      return connections;
    },
    url: `${protocol}://${auth ? 'user:' + encodeURIComponent(password) + '@' : ''}127.0.0.1:${port}`,
  };
}

async function readBytes(socket, length) {
  if (!length) return Buffer.alloc(0);
  let bytes;
  while ((bytes = socket.read(length)) === null) await once(socket, 'readable');
  return bytes;
}

async function startSocks(
  t,
  apiPort,
  protocol,
  { credentials, beforeGreeting, connectReply } = {},
) {
  const targets = [];
  let authAttempts = 0;
  const server = net.createServer((socket) => {
    async function handshake() {
      const greeting = await readBytes(socket, 2);
      const methods = await readBytes(socket, greeting[1]);
      await beforeGreeting?.(socket);
      if (!socket.writable) return;
      const method = credentials ? 2 : 0;
      if (greeting[0] !== 5 || !methods.includes(method)) return socket.end(Buffer.from([5, 255]));
      socket.write(Buffer.from([5, method]));
      if (credentials) {
        authAttempts++;
        const [, userLength] = await readBytes(socket, 2);
        const user = await readBytes(socket, userLength);
        const [passLength] = await readBytes(socket, 1);
        const pass = await readBytes(socket, passLength);
        if (user.toString() !== credentials.user || pass.toString() !== credentials.password)
          return socket.end(Buffer.from([1, 1]));
        socket.write(Buffer.from([1, 0]));
      }
      const [version, command, , type] = await readBytes(socket, 4);
      if (version !== 5 || command !== 1 || ![1, 3, 4].includes(type)) return socket.destroy();
      const length = type === 3 ? (await readBytes(socket, 1))[0] : type === 1 ? 4 : 16;
      const address = await readBytes(socket, length);
      const port = (await readBytes(socket, 2)).readUInt16BE();
      const host =
        type === 3
          ? address.toString()
          : type === 1
            ? [...address].join('.')
            : Array.from({ length: 8 }, (_, i) => address.readUInt16BE(i * 2).toString(16)).join(
                ':',
              );
      const target = { type, host, port };
      targets.push(target);
      const reply = connectReply?.(target) ?? 0;
      if (reply) return socket.end(Buffer.from([5, reply, 0, 1, 0, 0, 0, 0, 0, 0]));
      tunnel(socket, apiPort, Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
    }
    handshake().catch(() => socket.destroy());
  });
  const port = await listen(t, server);
  const userinfo = credentials
    ? `${encodeURIComponent(credentials.user)}:${encodeURIComponent(credentials.password)}@`
    : '';
  return {
    targets,
    get authAttempts() {
      return authAttempts;
    },
    url: `${protocol}://${userinfo}127.0.0.1:${port}`,
  };
}

module.exports = { cert, listen, startApi, startConnect, startSocks };
