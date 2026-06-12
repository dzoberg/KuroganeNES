// nes-server.js — WebSocket relay server for KuroganeNES multiplayer
//
// SETUP (Let's Encrypt — recommended):
//   Pick your public domain(s), then request a cert (DuckDNS example shown):
//   sudo certbot certonly --authenticator dns-duckdns \
//     --dns-duckdns-token YOUR_TOKEN --dns-duckdns-propagation-seconds 120 \
//     -d "your-domain.example.org"
//   LE_DOMAIN=your-domain.example.org node nes-server.js
//   (or set LE_CERT / LE_KEY env vars to point directly at your fullchain/privkey)
//
// SETUP (self-signed — localhost only):
//   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
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
// Prefer Let's Encrypt certs (fully trusted, required for navigator.audioSession
// on Android). Falls back to local cert.pem/key.pem for localhost development.
// Domain is taken from the LE_DOMAIN env var (e.g. LE_DOMAIN=your-domain.example.org),
// or override the full paths directly with LE_CERT / LE_KEY. Falls back to a local
// self-signed cert.pem/key.pem for localhost development.
const LE_DOMAIN = process.env.LE_DOMAIN || 'localhost';
const LE_CERT = process.env.LE_CERT || `/etc/letsencrypt/live/${LE_DOMAIN}/fullchain.pem`;
const LE_KEY  = process.env.LE_KEY  || `/etc/letsencrypt/live/${LE_DOMAIN}/privkey.pem`;
const LOCAL_CERT = path.join(__dirname, 'cert.pem');
const LOCAL_KEY  = path.join(__dirname, 'key.pem');

let ssl;
if (fs.existsSync(LE_CERT) && fs.existsSync(LE_KEY)) {
  ssl = {
    key:  fs.readFileSync(LE_KEY),
    cert: fs.readFileSync(LE_CERT),
  };
} else if (fs.existsSync(LOCAL_CERT) && fs.existsSync(LOCAL_KEY)) {
  ssl = {
    key:  fs.readFileSync(LOCAL_KEY),
    cert: fs.readFileSync(LOCAL_CERT),
  };
} else {
  console.error('\n[ERROR] No SSL certificate found.');
  console.error('        Let\'s Encrypt: run certbot (see setup comment above)');
  console.error('        Self-signed:   openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"\n');
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════
// RFC 6455 WebSocket — frame encode/decode (no npm dependencies)
// ══════════════════════════════════════════════════════════════
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_OP_TEXT   = 0x01;
const WS_OP_BINARY = 0x02;
const WS_OP_CLOSE  = 0x08;
const WS_OP_PING   = 0x09;
const WS_OP_PONG   = 0x0A;

// ── Security limits (hardening) ──
// MAX_FRAME must exceed the largest *legitimate* single frame. ROM and save-state
// resyncs are chunked at MP_CHUNK_SIZE (16 KB), but the FDS disk-delta patch
// (MP_FDS_PATCH) is sent as one unchunked frame — up to a few hundred KB for a
// heavily-written multi-side disk. 1 MB covers that with margin while still bounding
// a single allocation (the original bug allowed a 2^53-byte Buffer.alloc → crash).
const MAX_FRAME        = 1 << 20;        // S3-012: 1 MB hard cap per client frame
const MAX_BUFFER       = MAX_FRAME + 65536; // S3-012: receive-buffer ceiling (one max frame + slack)
const MSG_RATE_WINDOW  = 1000;           // S3-013: per-client message-rate window (ms)
const MSG_RATE_MAX     = 1000;           // S3-013: max frames per window per client (>> 60 fps input + headroom; blocks floods)
const CONN_RATE_WINDOW = 10000;          // S3-013: per-IP new-connection window (ms)
const CONN_RATE_MAX    = 15;             // S3-013: max new connections per window per IP
const IP_MAX_CONCURRENT = 8;             // S3-013: max simultaneous live connections per IP (bounds held-buffer memory)
// S4-013: optional strict Origin allowlist via env (comma-separated). Empty ⇒ same-origin
// only (the request's Origin host must equal its Host header), which blocks cross-site
// WebSocket hijacking while allowing the page this server itself serves.
const ALLOWED_ORIGINS  = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

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

// Decode client→server frames (clients always mask per RFC 6455 §5.3).
// Returns null if the buffer doesn't yet hold a complete frame,
//         { protocolError: true } / { tooLarge: true } for frames the caller must close on,
//         { opcode, payload, consumed } on success.
function wsDecode(buf, offset) {
  if (buf.length - offset < 2) return null;
  const b0 = buf[offset], b1 = buf[offset + 1];
  const fin    = !!(b0 & 0x80);
  const rsv    = b0 & 0x70;
  const opcode = b0 & 0x0F;
  const masked = !!(b1 & 0x80);
  let payloadLen = b1 & 0x7F;
  let pos = offset + 2;
  const isControl = (opcode & 0x08) !== 0;

  // ── RFC 6455 hardening (S4-013) ── reject malformed/abusive framing.
  if (rsv !== 0) return { protocolError: true };                          // reserved bits must be 0 (no negotiated extensions)
  if (!masked) return { protocolError: true };                            // §5.1: a server MUST reject unmasked client frames
  if (isControl && (!fin || payloadLen > 125)) return { protocolError: true }; // control frames: FIN=1, ≤125 bytes, never extended length
  if (!fin || opcode === 0x0) return { protocolError: true };             // this protocol uses no fragmentation/continuation

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

  if (payloadLen > MAX_FRAME) return { tooLarge: true };                  // S3-012: cap frame size (memory DoS)

  // Mask key is always present (we required masked above)
  if (buf.length - pos < 4) return null;
  const maskKey = buf.slice(pos, pos + 4);
  pos += 4;

  if (buf.length - pos < payloadLen) return null;

  const payload = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    payload[i] = buf[pos + i] ^ maskKey[i & 3];
  }

  return { opcode, payload, consumed: pos + payloadLen - offset };
}

// ══════════════════════════════════════════════════════════════
// WebSocket connection wrapper
// ══════════════════════════════════════════════════════════════
class WsClient {
  constructor(socket) {
    this.socket = socket;
    this.remoteIp = socket.remoteAddress || 'unknown'; // S3-013: for per-IP concurrency release
    this.released = false; // ensure ipConnRelease runs exactly once
    this.buf = Buffer.alloc(0);
    this.alive = true;
    this.room = null;
    this.role = null;  // 'host' | 'guest'
    this.slot = -1;    // guest slot index (0-based, so P2=0, P3=1, P4=2)
    this.identified = false; // has sent initial join/host message
    this.pongReceived = true; // dead-client detection: set false on ping, true on pong
    this.msgWindowStart = Date.now(); // S3-013: per-client message-rate window
    this.msgCount = 0;

    socket.setNoDelay(true); // Disable Nagle — critical for low-latency input packets

    socket.on('data', (data) => {
      this.buf = Buffer.concat([this.buf, data]);
      if (this.buf.length > MAX_BUFFER) { // S3-012: a client streaming without completing a frame is dropped
        this.close();
        this.buf = Buffer.alloc(0);
        return;
      }
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
      if (frame.tooLarge || frame.protocolError) { // S3-012 / S4-013: drop abusive/malformed clients
        this.close();
        this.buf = Buffer.alloc(0);
        return;
      }
      offset += frame.consumed;

      // S3-013: per-client message-rate limit (flood protection)
      const now = Date.now();
      if (now - this.msgWindowStart >= MSG_RATE_WINDOW) { this.msgWindowStart = now; this.msgCount = 0; }
      if (++this.msgCount > MSG_RATE_MAX) {
        this.close();
        this.buf = Buffer.alloc(0);
        return;
      }

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
    if (!this.released) { this.released = true; ipConnRelease(this.remoteIp); } // S3-013
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

// ── Per-IP connection rate + concurrency limiting (S3-013) ──
const ipConns = new Map(); // ip → { times: [recent connection timestamps], live: <current open count> }
function ipConnAllow(ip) {
  const now = Date.now();
  let e = ipConns.get(ip);
  if (!e) { e = { times: [], live: 0 }; ipConns.set(ip, e); }
  while (e.times.length && now - e.times[0] > CONN_RATE_WINDOW) e.times.shift();
  if (e.times.length >= CONN_RATE_MAX) return false;   // too many recent connections
  if (e.live >= IP_MAX_CONCURRENT) return false;        // too many simultaneous connections
  e.times.push(now);
  e.live++;
  return true;
}
function ipConnRelease(ip) {
  const e = ipConns.get(ip);
  if (e && e.live > 0) e.live--;
}

function genCode() {
  const c = 'ABCDEFHJKLMNPQRTUVWXY34679';
  let code = '';
  for (let i = 0; i < 4; i++) code += c[crypto.randomInt(c.length)]; // S3-013: CSPRNG (was Math.random)
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
  // S3-013: prune stale per-IP rate-limit windows so the map can't grow unbounded
  for (const [ip, e] of ipConns) {
    while (e.times.length && now - e.times[0] > CONN_RATE_WINDOW) e.times.shift();
    if (e.times.length === 0 && e.live === 0) ipConns.delete(ip);
  }
}, 5000);

// WebSocket-level ping for NAT keepalive + dead-client detection
setInterval(() => {
  for (const [, room] of rooms) {
    // S5-008: do NOT refresh lastActivity here — that made the inactivity timeout
    // unfireable. lastActivity now tracks real client traffic (see relayToRoom).
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
    // S2-001: msg.playerSlots is attacker-controlled — clamp to the only real values
    // (1 ⇒ 2P, 3 ⇒ 4P). Unclamped, {"playerSlots":1e9} allocates a huge array → OOM crash.
    const playerSlots = (msg.playerSlots === 3) ? 3 : 1;

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
    const requestedSlot = Number.isInteger(msg.slot) ? msg.slot : null; // S11-001: was typeof==='number' — 1.5 passed range check, made a ghost array index
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

  // S11-002: verify the sender is STILL the live occupant of its claimed position
  // before relaying. A guest whose slot was reassigned (kicked / replaced by a
  // reconnect) keeps role='guest' and a stale room ref; without this check its
  // frames would still reach the host. Same-room only (no cross-room leak), but
  // relay is an authorization boundary and should assert membership.
  if (sender.role === 'host') {
    if (room.host !== sender) return;
    room.lastActivity = Date.now(); // S5-008: real client traffic keeps the room alive
    for (const g of room.guests) {
      if (g?.alive) g.sendRaw(rawFrame);
    }
  } else if (sender.role === 'guest') {
    if (room.guests[sender.slot] !== sender) return;
    room.lastActivity = Date.now();
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
      // S11-003: defense-in-depth response headers for a public-facing single-file app.
      // The page is self-contained (no third-party origins), so a tight CSP costs nothing
      // and blocks injected-script execution if any HTML ever slips in. 'wss:' permits the
      // same-origin multiplayer socket; 'data:' covers the inlined save-state thumbnails.
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          // blob: in script-src — the AudioWorklet module loads from a blob URL
          // (safe: blobs are minted only by same-origin running code; data: scripts
          // would be the dangerous allowance and remain blocked).
          // font-src data: — the app inlines its fonts as data: URIs.
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; " +
          "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
          "font-src 'self' data:; media-src 'self' blob:; connect-src 'self' wss: https:; " +
          "worker-src 'self' blob:; frame-ancestors 'none'",
      });
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

  // S4-013: reject cross-site WebSocket hijacking. Browsers always send Origin on a WS
  // handshake; require it to match this server (or an explicit allowlist). Non-browser
  // clients (no Origin) are allowed — the CSWSH threat is browser-only.
  const origin = req.headers['origin'];
  if (origin) {
    let ok;
    if (ALLOWED_ORIGINS.length) {
      ok = ALLOWED_ORIGINS.includes(origin);
    } else {
      let originHost; try { originHost = new URL(origin).host; } catch { originHost = null; }
      ok = originHost !== null && originHost === req.headers['host'];
    }
    if (!ok) { socket.destroy(); return; }
  }

  // S3-013: throttle connections per IP (rate + concurrency). Checked LAST, immediately
  // before WsClient is created, so a count is only taken when a client actually exists
  // to release it on close.
  const wsKey = req.headers['sec-websocket-key'];
  if (!wsKey) { socket.destroy(); return; }

  const ip = socket.remoteAddress || 'unknown';
  if (!ipConnAllow(ip)) { socket.destroy(); return; }

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
