// nes-server.js — WebSocket relay server for KuroganeNES multiplayer
//
// SETUP — choose one option:
//
// Option A: Self-signed certificate (localhost only, quick start)
//   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes \
//     -subj "/CN=localhost" \
//     -addext "subjectAltName=IP:127.0.0.1,DNS:localhost"
//   node nes-server.js
//   Access at: https://localhost:8888
//   Note: Android hardware volume buttons may not map to the music stream
//         when accessed via LAN IP with a self-signed certificate.
//
// Option B: Let's Encrypt certificate (recommended for LAN/remote access)
//   pip install certbot                        (install certbot)
//   pip install certbot-dns-cloudflare         (or your DNS provider's plugin)
//   sudo certbot certonly --authenticator dns-<provider> \
//     --dns-<provider>-credentials YOUR_CREDENTIALS \
//     --dns-<provider>-propagation-seconds 120 \
//     -d "yourdomain.com"
//   Copy /etc/letsencrypt/live/yourdomain.com/fullchain.pem → cert.pem
//   Copy /etc/letsencrypt/live/yourdomain.com/privkey.pem  → key.pem
//   node nes-server.js
//   Renew: sudo certbot renew
//
// Place cert.pem and key.pem in the same directory as this file, then run:
//   node nes-server.js
//
// Zero npm dependencies. WebSocket protocol (RFC 6455) implemented from scratch
// using only Node.js stdlib: https, crypto, fs, path, os.
//
// Single port (default 8888) serves HTTPS + WSS.
// Binary relay between host and guests. 2P or 4P (Four Score).

const https  = require('https');
const crypto = require('crypto');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const PORT   = process.env.PORT || 8888;
const FILE   = path.join(__dirname, 'nes.html');

// ── SSL setup ──
['cert.pem', 'key.pem'].forEach(f => {
  if (!fs.existsSync(path.join(__dirname, f))) {
    console.error(`\n[ERROR] Missing ${f}\n        openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"\n`);
    process.exit(1);
  }
});
const ssl = {
  key:  fs.readFileSync(path.join(__dirname, 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'cert.pem')),
};

// ══════════════════════════════════════════════════════════════
// RFC 6455 WebSocket — frame encode/decode (no npm dependencies)
// ══════════════════════════════════════════════════════════════
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_OP_TEXT   = 0x01;
const WS_OP_BINARY = 0x02;
const WS_OP_CLOSE  = 0x08;
const WS_OP_PING   = 0x09;
const WS_OP_PONG   = 0x0A;

function wsAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_MAGIC).digest('base64');
}

// Encode a server→client frame (server frames are never masked per RFC 6455 §5.1)
function wsEncode(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode; // FIN=1
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    // Node.js Buffer doesn't have writeUInt64BE — write as two 32-bit halves
    header.writeUInt32BE(0, 2);          // high 32 bits (always 0 for our sizes)
    header.writeUInt32BE(len, 6);        // low 32 bits
  }
  return Buffer.concat([header, Buffer.isBuffer(payload) ? payload : Buffer.from(payload)]);
}

// Decode client→server frames (clients always mask per RFC 6455 §5.3)
// Returns null if buffer doesn't contain a complete frame yet.
// Returns { opcode, payload, consumed } on success.
function wsDecode(buf, offset) {
  if (buf.length - offset < 2) return null;
  const b0 = buf[offset], b1 = buf[offset + 1];
  const opcode = b0 & 0x0F;
  const masked = !!(b1 & 0x80);
  let payloadLen = b1 & 0x7F;
  let pos = offset + 2;

  if (payloadLen === 126) {
    if (buf.length - offset < 4) return null;
    payloadLen = buf.readUInt16BE(pos);
    pos += 2;
  } else if (payloadLen === 127) {
    if (buf.length - offset < 10) return null;
    // Read as two 32-bit values; high must be 0 for sane sizes
    const hi = buf.readUInt32BE(pos);
    const lo = buf.readUInt32BE(pos + 4);
    payloadLen = hi * 0x100000000 + lo;
    pos += 8;
  }

  let maskKey;
  if (masked) {
    if (buf.length - pos < 4) return null;
    maskKey = buf.slice(pos, pos + 4);
    pos += 4;
  }

  if (buf.length - pos < payloadLen) return null;

  const payload = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    payload[i] = masked ? (buf[pos + i] ^ maskKey[i & 3]) : buf[pos + i];
  }

  return { opcode, payload, consumed: pos + payloadLen - offset };
}

// ══════════════════════════════════════════════════════════════
// WebSocket connection wrapper
// ══════════════════════════════════════════════════════════════
class WsClient {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.alive = true;
    this.room = null;
    this.role = null;  // 'host' | 'guest'
    this.slot = -1;    // guest slot index (0-based, so P2=0, P3=1, P4=2)
    this.identified = false; // has sent initial join/host message
    this.pongReceived = true; // dead-client detection: set false on ping, true on pong

    socket.setNoDelay(true); // Disable Nagle — critical for low-latency input packets

    socket.on('data', (data) => {
      this.buf = Buffer.concat([this.buf, data]);
      this._processFrames();
    });
    socket.on('close', () => { this.alive = false; this._onClose(); });
    socket.on('error', () => { this.alive = false; this._onClose(); });
  }

  _processFrames() {
    let offset = 0;
    while (offset < this.buf.length) {
      const frame = wsDecode(this.buf, offset);
      if (!frame) break;
      offset += frame.consumed;

      if (frame.opcode === WS_OP_PING) {
        this.sendRaw(wsEncode(WS_OP_PONG, frame.payload));
      } else if (frame.opcode === WS_OP_PONG) {
        this.pongReceived = true;
      } else if (frame.opcode === WS_OP_CLOSE) {
        this.sendRaw(wsEncode(WS_OP_CLOSE, Buffer.alloc(0)));
        this.socket.end();
        this.alive = false;
      } else if (frame.opcode === WS_OP_TEXT) {
        this._onText(frame.payload.toString('utf8'));
      } else if (frame.opcode === WS_OP_BINARY) {
        this._onBinary(frame.payload);
      }
    }
    if (offset > 0) this.buf = this.buf.subarray(offset);
  }

  sendText(str) {
    if (!this.alive) return;
    this.sendRaw(wsEncode(WS_OP_TEXT, Buffer.from(str, 'utf8')));
  }

  sendBinary(data) {
    if (!this.alive) return;
    this.sendRaw(wsEncode(WS_OP_BINARY, data));
  }

  sendRaw(buf) {
    if (this.socket.writable) {
      this.socket.write(buf);
    }
  }

  close() {
    if (this.alive) {
      this.alive = false;
      try { this.sendRaw(wsEncode(WS_OP_CLOSE, Buffer.alloc(0))); } catch {}
      try { this.socket.end(); } catch {}
    }
  }

  // ── Application-level message routing ──
  _onText(str) {
    // First message must be JSON identifying the client
    if (!this.identified) {
      try {
        const msg = JSON.parse(str);
        handleJoin(this, msg);
      } catch (e) {
        this.sendText(JSON.stringify({ error: 'Invalid JSON' }));
        this.close();
      }
      return;
    }
    // After identification, text messages are not expected in normal play
    // but forward them as-is if they arrive (future extensibility)
    relayToRoom(this, wsEncode(WS_OP_TEXT, Buffer.from(str, 'utf8')));
  }

  _onBinary(data) {
    if (!this.identified || !this.room) return;
    // Relay binary game data to the other side(s)
    relayToRoom(this, wsEncode(WS_OP_BINARY, data));
  }

  _onClose() {
    if (this.room) {
      handleLeave(this);
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Room management
// ══════════════════════════════════════════════════════════════
const rooms = new Map();
const ROOM_TIMEOUT = 120000; // 120s inactivity → expire

function genCode() {
  const c = 'ABCDEFHJKLMNPQRTUVWXY34679';
  let code = '';
  for (let i = 0; i < 4; i++) code += c[Math.random() * c.length | 0];
  return code;
}

// Expire rooms with no activity
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TIMEOUT) {
      // Close any lingering sockets
      if (room.host?.alive) room.host.close();
      for (const g of room.guests) if (g?.alive) g.close();
      rooms.delete(code);
      console.log(`   [room] ${code} expired (inactive)`);
    }
  }
}, 5000);

// WebSocket-level ping for NAT keepalive + dead-client detection
setInterval(() => {
  for (const [, room] of rooms) {
    room.lastActivity = Date.now();
    const ping = wsEncode(WS_OP_PING, Buffer.alloc(0));
    // Check each client: if previous pong never arrived, connection is dead
    const checkAndPing = (client) => {
      if (!client?.alive) return;
      if (!client.pongReceived) {
        // No pong since last ping — dead connection
        console.log(`   [warn] dead client detected (no pong) — closing`);
        client.alive = false;
        client._onClose();
        try { client.socket.destroy(); } catch {}
        return;
      }
      client.pongReceived = false;
      client.sendRaw(ping);
    };
    checkAndPing(room.host);
    for (const g of room.guests) checkAndPing(g);
  }
}, 2000);

function handleJoin(client, msg) {
  if (msg.action === 'host') {
    // Create room
    let code;
    do { code = genCode(); } while (rooms.has(code));
    const playerSlots = msg.playerSlots || 1; // 1=2P, 3=4P

    const room = {
      code,
      host: client,
      guests: new Array(playerSlots).fill(null),
      playerSlots,
      lastActivity: Date.now(),
    };
    rooms.set(code, room);

    client.room = room;
    client.role = 'host';
    client.slot = -1;
    client.identified = true;

    client.sendText(JSON.stringify({ event: 'room_created', code, playerSlots }));
    console.log(`   [room] ${code} created — ${playerSlots + 1}P (${rooms.size} active)`);

  } else if (msg.action === 'join') {
    const code = (msg.code || '').toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      client.sendText(JSON.stringify({ error: 'Room not found' }));
      client.close();
      return;
    }

    // Find available slot
    const requestedSlot = typeof msg.slot === 'number' ? msg.slot : null;
    let assignedSlot = -1;

    if (requestedSlot !== null && requestedSlot >= 0 && requestedSlot < room.playerSlots) {
      if (!room.guests[requestedSlot]?.alive) {
        assignedSlot = requestedSlot;
      }
    } else {
      // Auto-assign first available
      for (let i = 0; i < room.playerSlots; i++) {
        if (!room.guests[i]?.alive) { assignedSlot = i; break; }
      }
    }

    if (assignedSlot === -1) {
      // Check if multiple slots available — let client pick
      const available = [];
      for (let i = 0; i < room.playerSlots; i++) {
        if (!room.guests[i]?.alive) available.push(i);
      }
      if (available.length > 1) {
        // Don't close — send slot choices, client will reconnect with slot specified
        client.sendText(JSON.stringify({ event: 'choose_slot', availableSlots: available }));
        // Keep connection alive — client will send another join with slot
        client.identified = false; // Allow re-identification
        return;
      }
      client.sendText(JSON.stringify({ error: 'Room is full' }));
      client.close();
      return;
    }

    // Clean up old guest in this slot if any
    if (room.guests[assignedSlot]?.alive) {
      room.guests[assignedSlot].close();
    }

    room.guests[assignedSlot] = client;
    room.lastActivity = Date.now();

    client.room = room;
    client.role = 'guest';
    client.slot = assignedSlot;
    client.identified = true;

    const playerNum = assignedSlot + 2;
    client.sendText(JSON.stringify({ event: 'joined', slot: assignedSlot, playerNum }));

    // Notify host that a guest connected
    if (room.host?.alive) {
      room.host.sendText(JSON.stringify({ event: 'guest_joined', slot: assignedSlot, playerNum }));
    }

    console.log(`   [room] ${code} — P${playerNum} joined`);

  } else {
    client.sendText(JSON.stringify({ error: 'Unknown action' }));
    client.close();
  }
}

function handleLeave(client) {
  const room = client.room;
  if (!room) return;

  if (client.role === 'host') {
    // Host left — notify all guests and close room
    for (const g of room.guests) {
      if (g?.alive) {
        g.sendText(JSON.stringify({ event: 'host_disconnected' }));
        g.close();
      }
    }
    rooms.delete(room.code);
    console.log(`   [room] ${room.code} closed (host disconnected)`);
  } else if (client.role === 'guest') {
    // Guest left — clear slot, notify host
    const slot = client.slot;
    if (slot >= 0 && room.guests[slot] === client) {
      room.guests[slot] = null;
    }
    if (room.host?.alive) {
      room.host.sendText(JSON.stringify({ event: 'guest_disconnected', slot, playerNum: slot + 2 }));
    }
    console.log(`   [room] ${room.code} — P${slot + 2} disconnected`);
  }

  client.room = null;
}

function relayToRoom(sender, rawFrame) {
  const room = sender.room;
  if (!room) return;

  if (sender.role === 'host') {
    // Host → all connected guests
    for (const g of room.guests) {
      if (g?.alive) g.sendRaw(rawFrame);
    }
  } else if (sender.role === 'guest') {
    // Guest → host (and optionally other guests for spectator/4P sync)
    if (room.host?.alive) room.host.sendRaw(rawFrame);
  }
}

// ══════════════════════════════════════════════════════════════
// HTTPS server — serves HTML + handles WebSocket upgrade
// ══════════════════════════════════════════════════════════════

function json(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const server = https.createServer(ssl, (req, res) => {
  // Simple REST endpoint for multiplayer availability check
  if (req.method === 'GET' && req.url === '/multiplayer') {
    return json(res, 200, { available: true });
  }

  // Serve nes.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(FILE, (err, data) => {
      if (err) { res.writeHead(500); return res.end('Could not load nes.html'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ── WebSocket upgrade handler ──
server.on('upgrade', (req, socket, head) => {
  // Only accept upgrades on /ws path
  if (req.url !== '/ws') {
    socket.destroy();
    return;
  }

  const wsKey = req.headers['sec-websocket-key'];
  if (!wsKey) { socket.destroy(); return; }

  const acceptKey = wsAcceptKey(wsKey);
  const responseHeaders = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '', '' // double CRLF to end headers
  ].join('\r\n');

  socket.write(responseHeaders);

  // Wrap in WsClient — all further communication is WebSocket frames
  const client = new WsClient(socket);

  // Process any data that arrived with the upgrade request (rare but possible)
  if (head && head.length > 0) {
    client.buf = Buffer.concat([client.buf, head]);
    client._processFrames();
  }
});

// ── Start ──
server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  console.log('\n ╔══════════════════════════════════════╗');
  console.log(' ║        KuroganeNES  ·  v1.0          ║');
  console.log(' ╚══════════════════════════════════════╝\n');
  console.log(`   Local:   https://localhost:${PORT}`);
  for (const n of Object.keys(nets))
    for (const i of nets[n])
      if (i.family === 'IPv4' && !i.internal)
        console.log(`   Network: https://${i.address}:${PORT}`);
  console.log(`\n   Multiplayer: 2P / 4P · WebSocket relay\n`);
});
