// Minimal RESP2 Redis server for tests.
//
// Purpose: exercise the REAL ioredis client + the REAL
// @socket.io/redis-adapter across two Socket.IO server instances without
// requiring a redis-server binary or Docker in CI.
//
// Supported surface (everything the adapter needs):
//   PING, ECHO, SELECT, AUTH, CLIENT, INFO, QUIT
//   SUBSCRIBE / UNSUBSCRIBE, PSUBSCRIBE / PUNSUBSCRIBE
//   PUBLISH, PUBSUB NUMSUB
//
// Deliberately NOT a general-purpose Redis: no keyspace, no persistence, no
// ACLs. HELLO is rejected so ioredis falls back to RESP2, whose pub/sub
// semantics are simple enough to implement faithfully here.
import net from 'node:net';

const CRLF = '\r\n';

/** Parse one RESP command from a Buffer. Returns null when incomplete. */
function parseCommand(buffer) {
  if (buffer.length === 0) return null;
  if (buffer[0] !== 0x2a /* '*' */) {
    throw new Error('miniRedis: expected an array command');
  }

  const headerEnd = buffer.indexOf(CRLF, 0);
  if (headerEnd === -1) return null;
  const count = Number(buffer.subarray(1, headerEnd).toString('utf8'));
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('miniRedis: invalid multibulk length');
  }

  const args = [];
  let offset = headerEnd + 2;

  for (let i = 0; i < count; i += 1) {
    if (offset >= buffer.length) return null;
    if (buffer[offset] !== 0x24 /* '$' */) {
      throw new Error('miniRedis: expected a bulk string');
    }
    const lenEnd = buffer.indexOf(CRLF, offset);
    if (lenEnd === -1) return null;
    const len = Number(buffer.subarray(offset + 1, lenEnd).toString('utf8'));
    if (!Number.isInteger(len) || len < 0) {
      throw new Error('miniRedis: invalid bulk length');
    }
    const start = lenEnd + 2;
    const end = start + len;
    if (buffer.length < end + 2) return null;
    args.push(buffer.subarray(start, end));
    offset = end + 2;
  }

  return { args, rest: buffer.subarray(offset) };
}

function simple(value) {
  return Buffer.from(`+${value}${CRLF}`, 'utf8');
}

function error(value) {
  return Buffer.from(`-${value}${CRLF}`, 'utf8');
}

function integer(value) {
  return Buffer.from(`:${value}${CRLF}`, 'utf8');
}

function bulk(value) {
  const payload = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return Buffer.concat([
    Buffer.from(`$${payload.length}${CRLF}`, 'utf8'),
    payload,
    Buffer.from(CRLF, 'utf8'),
  ]);
}

function array(items) {
  return Buffer.concat([
    Buffer.from(`*${items.length}${CRLF}`, 'utf8'),
    ...items,
  ]);
}

/** Convert a Redis glob (`*`, `?`, `[...]`) into a RegExp. */
function globToRegExp(pattern) {
  let out = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else if (ch === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) out += '\\[';
      else {
        out += pattern.slice(i, end + 1);
        i = end;
      }
    } else if ('\\^$.|+(){}'.includes(ch)) out += `\\${ch}`;
    else out += ch;
  }
  return new RegExp(`${out}$`);
}

export class MiniRedisServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.clients = new Set();
    this.channelSubs = new Map(); // channel -> Set<client>
    this.patternSubs = new Map(); // pattern -> Set<client>
    this.commands = [];
  }

  async start(port = 0) {
    if (this.server) return this.port;

    this.server = net.createServer((socket) => this.#onConnection(socket));
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', () => {
        this.server.off('error', reject);
        resolve();
      });
    });
    this.port = this.server.address().port;
    return this.port;
  }

  async stop() {
    for (const client of this.clients) {
      try {
        client.socket.destroy();
      } catch {
        // already gone
      }
    }
    this.clients.clear();
    this.channelSubs.clear();
    this.patternSubs.clear();

    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  url({ db = 0 } = {}) {
    return `redis://127.0.0.1:${this.port}/${db}`;
  }

  #publish(channel, payload) {
    let delivered = 0;
    const channelName = channel.toString('utf8');

    for (const client of this.channelSubs.get(channelName) || []) {
      client.socket.write(array([bulk('message'), bulk(channelName), bulk(payload)]));
      delivered += 1;
    }

    for (const [pattern, subscribers] of this.patternSubs.entries()) {
      if (!globToRegExp(pattern).test(channelName)) continue;
      for (const client of subscribers) {
        client.socket.write(
          array([bulk('pmessage'), bulk(pattern), bulk(channelName), bulk(payload)])
        );
        delivered += 1;
      }
    }

    return delivered;
  }

  #countSubscribers(channel) {
    return (this.channelSubs.get(channel) || new Set()).size +
      [...this.patternSubs.entries()]
        .filter(([pattern]) => globToRegExp(pattern).test(channel))
        .reduce((total, [, subscribers]) => total + subscribers.size, 0);
  }

  #onConnection(socket) {
    const client = { socket, channels: new Set(), patterns: new Set() };
    this.clients.add(client);
    let pending = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        let parsed;
        try {
          parsed = parseCommand(pending);
        } catch {
          socket.write(error('ERR Protocol error'));
          socket.destroy();
          return;
        }
        if (!parsed) return;
        pending = parsed.rest;
        this.#handle(client, parsed.args);
      }
    });

    socket.on('error', () => {});
    socket.on('close', () => this.#dropClient(client));
  }

  #dropClient(client) {
    this.clients.delete(client);
    for (const channel of client.channels) {
      const subscribers = this.channelSubs.get(channel);
      subscribers?.delete(client);
      if (subscribers?.size === 0) this.channelSubs.delete(channel);
    }
    for (const pattern of client.patterns) {
      const subscribers = this.patternSubs.get(pattern);
      subscribers?.delete(client);
      if (subscribers?.size === 0) this.patternSubs.delete(pattern);
    }
  }

  #handle(client, args) {
    const command = args[0]?.toString('utf8').toLowerCase();
    this.commands.push(command);

    switch (command) {
      case 'hello':
        // Force the RESP2 path: ioredis falls back when HELLO is unknown.
        client.socket.write(error("ERR unknown command 'HELLO'"));
        return;

      case 'ping':
        client.socket.write(simple('PONG'));
        return;

      case 'echo':
        client.socket.write(bulk(args[1] ?? Buffer.alloc(0)));
        return;

      case 'select':
      case 'auth':
      case 'client':
        client.socket.write(simple('OK'));
        return;

      case 'info':
        client.socket.write(bulk('# Server\r\nredis_version:7.4.0\r\nloading:0\r\nrole:master\r\n'));
        return;

      case 'quit':
        client.socket.write(simple('OK'));
        client.socket.end();
        return;

      case 'subscribe': {
        for (const channel of args.slice(1)) {
          const name = channel.toString('utf8');
          client.channels.add(name);
          if (!this.channelSubs.has(name)) this.channelSubs.set(name, new Set());
          this.channelSubs.get(name).add(client);
          client.socket.write(
            array([bulk('subscribe'), bulk(name), integer(client.channels.size)])
          );
        }
        return;
      }

      case 'psubscribe': {
        for (const rawPattern of args.slice(1)) {
          const pattern = rawPattern.toString('utf8');
          client.patterns.add(pattern);
          if (!this.patternSubs.has(pattern)) this.patternSubs.set(pattern, new Set());
          this.patternSubs.get(pattern).add(client);
          client.socket.write(
            array([bulk('psubscribe'), bulk(pattern), integer(client.patterns.size)])
          );
        }
        return;
      }

      case 'unsubscribe': {
        const channels = args.slice(1).map((item) => item.toString('utf8'));
        for (const name of channels.length ? channels : [...client.channels]) {
          client.channels.delete(name);
          this.channelSubs.get(name)?.delete(client);
          if (this.channelSubs.get(name)?.size === 0) this.channelSubs.delete(name);
          client.socket.write(
            array([bulk('unsubscribe'), bulk(name), integer(client.channels.size)])
          );
        }
        return;
      }

      case 'punsubscribe': {
        const patterns = args.slice(1).map((item) => item.toString('utf8'));
        for (const pattern of patterns.length ? patterns : [...client.patterns]) {
          client.patterns.delete(pattern);
          this.patternSubs.get(pattern)?.delete(client);
          if (this.patternSubs.get(pattern)?.size === 0) this.patternSubs.delete(pattern);
          client.socket.write(
            array([bulk('punsubscribe'), bulk(pattern), integer(client.patterns.size)])
          );
        }
        return;
      }

      case 'publish': {
        const channel = args[1]?.toString('utf8') ?? '';
        const payload = args[2] ?? Buffer.alloc(0);
        client.socket.write(integer(this.#publish(channel, payload)));
        return;
      }

      case 'pubsub': {
        const sub = args[1]?.toString('utf8').toLowerCase();
        if (sub === 'numsub') {
          const channel = args[2]?.toString('utf8') ?? '';
          client.socket.write(
            array([bulk(channel), integer(this.#countSubscribers(channel))])
          );
          return;
        }
        client.socket.write(array([]));
        return;
      }

      default:
        client.socket.write(error(`ERR unknown command '${command || ''}'`));
    }
  }
}

export default MiniRedisServer;
