/* Tank Battle Online — игровой сервер.
   Запуск:  node server.js   (порт по умолчанию 3000, можно задать переменной PORT)
   Без внешних зависимостей: HTTP-сервер статики + WebSocket (RFC 6455) + комнаты. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const os = require('os');
const { performance } = require('perf_hooks');

const PUBLIC = path.join(__dirname, 'public');
for (const f of ['core', 'world', 'ai', 'modes', 'proto']) require(path.join(PUBLIC, 'shared', f + '.js'));
const TG = globalThis.TG;
const C = TG.C;

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const VERSION = 2;
const MAX_ROOMS = 300;
const RECONNECT_GRACE_MS = 25000;
// Только для тестов: искусственная задержка сети в мс (в одну сторону) и разброс, например LAG=60 JITTER=20
const LAG = parseInt(process.env.LAG, 10) || 0;
const JITTER = parseInt(process.env.JITTER, 10) || 0;

// =====================================================================
// Статические файлы (кэш в памяти + gzip + ETag)
// =====================================================================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'
};
const fileCache = new Map();

function loadFile(rel) {
  const full = path.normalize(path.join(PUBLIC, rel));
  if (!full.startsWith(PUBLIC)) return null;
  let st;
  try { st = fs.statSync(full); } catch (e) { return null; }
  if (!st.isFile()) return null;
  const c = fileCache.get(full);
  if (c && c.mtime === st.mtimeMs) return c;
  const buf = fs.readFileSync(full);
  const ext = path.extname(full).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const compressible = /text|javascript|json|svg/.test(type);
  const entry = {
    buf, type, mtime: st.mtimeMs,
    gz: compressible && buf.length > 512 ? zlib.gzipSync(buf, { level: 9 }) : null,
    etag: '"' + crypto.createHash('sha1').update(buf).digest('base64').slice(0, 16) + '"'
  };
  fileCache.set(full, entry);
  return entry;
}

const server = http.createServer((req, res) => {
  try {
    let url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: clients.size }));
      return;
    }
    if (url === '/' || url === '') url = '/index.html';
    const f = loadFile(url);
    if (!f || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    const headers = { 'Content-Type': f.type, 'ETag': f.etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); res.end(); return; }
    const gz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (gz) { headers['Content-Encoding'] = 'gzip'; headers['Vary'] = 'Accept-Encoding'; }
    const body = gz ? f.gz : f.buf;
    headers['Content-Length'] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (e) {
    res.writeHead(500); res.end();
  }
});

// =====================================================================
// Минимальная реализация WebSocket (RFC 6455)
// =====================================================================
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1 << 16;

class WS {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.fragOp = 0;
    this.open = true;
    this.onmessage = null;
    this.onclose = null;
    socket.setNoDelay(true);
    socket.on('data', (d) => this._data(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
    socket.on('end', () => this._closed());
  }
  _data(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, o = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); o = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
        if (hi !== 0) return this.close(1009);
        len = lo; o = 10;
      }
      if (!masked) return this.close(1002);
      if (len > MAX_FRAME) return this.close(1009);
      if (b.length < o + 4 + len) return;
      const mask = b.subarray(o, o + 4);
      const payload = Buffer.allocUnsafe(len);
      const src = o + 4;
      for (let i = 0; i < len; i++) payload[i] = b[src + i] ^ mask[i & 3];
      this.buf = b.subarray(src + len);
      if (this.buf.length === 0) this.buf = Buffer.alloc(0);
      this._frame(fin, op, payload);
    }
  }
  _frame(fin, op, payload) {
    if (op === 0x8) { this.close(1000); return; }
    if (op === 0x9) { this._send(0xA, payload); return; }
    if (op === 0xA) return;
    if (op === 0x0) {
      if (!this.fragOp) return this.close(1002);
      this.frags.push(payload);
      if (this.frags.reduce((a, x) => a + x.length, 0) > MAX_FRAME) return this.close(1009);
      if (fin) { const all = Buffer.concat(this.frags); const t = this.fragOp; this.frags = []; this.fragOp = 0; this._msg(t, all); }
      return;
    }
    if (op === 0x1 || op === 0x2) {
      if (!fin) { this.fragOp = op; this.frags = [payload]; return; }
      this._msg(op, payload);
      return;
    }
    this.close(1002);
  }
  _msg(op, payload, delayed) {
    if (LAG && !delayed) { this._delay('_inAt', () => this._msg(op, payload, true)); return; }
    if (!this.onmessage) return;
    try { this.onmessage(op === 0x1 ? payload.toString('utf8') : payload); }
    catch (e) { console.error('Ошибка обработки сообщения:', e); }
  }
  _send(op, data) {
    if (!this.open || this.socket.destroyed) return;
    const len = data.length;
    let head;
    if (len < 126) { head = Buffer.allocUnsafe(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.allocUnsafe(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.allocUnsafe(10); head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    head[0] = 0x80 | op;
    this.socket.cork();
    this.socket.write(head);
    this.socket.write(data);
    this.socket.uncork();
  }
  _delay(key, fn) {
    // упорядоченная задержка (как в TCP — строгая очередь, без перестановки пакетов)
    const q = this[key] || (this[key] = { items: [], timer: null, last: 0 });
    const at = Math.max(q.last, Date.now() + LAG + Math.random() * JITTER);
    q.last = at;
    q.items.push({ at, fn });
    const run = () => {
      q.timer = null;
      const now = Date.now();
      while (q.items.length && q.items[0].at <= now) q.items.shift().fn();
      if (q.items.length) q.timer = setTimeout(run, Math.max(1, q.items[0].at - now));
    };
    if (!q.timer) q.timer = setTimeout(run, Math.max(1, at - Date.now()));
  }
  send(data, delayed) {
    if (LAG && !delayed) { const d = typeof data === 'string' ? data : Buffer.from(data); this._delay('_outAt', () => this.send(d, true)); return; }
    if (typeof data === 'string') this._send(0x1, Buffer.from(data, 'utf8'));
    else this._send(0x2, Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  }
  get buffered() { return this.socket.writableLength || 0; }
  close(code) {
    if (!this.open) return;
    try {
      const b = Buffer.alloc(2); b.writeUInt16BE(code || 1000, 0);
      this._send(0x8, b);
      this.socket.end();
    } catch (e) { /* игнор */ }
    setTimeout(() => this.socket.destroy(), 1000).unref();
    this._closed();
  }
  _closed() {
    if (!this.open) return;
    this.open = false;
    if (this.onclose) this.onclose();
  }
}

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if ((req.url || '').split('?')[0] !== '/ws' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    return;
  }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const ws = new WS(socket);
  onConnection(ws, req);
});

// =====================================================================
// Клиенты и комнаты
// =====================================================================
const clients = new Set();
const rooms = new Map();
let nextPid = 1;
function allocPid() {
  const used = new Set();
  for (const r of rooms.values()) for (const m of r.members.values()) used.add(m.pid);
  for (let i = 0; i < 65000; i++) {
    const id = nextPid++;
    if (nextPid > 64000) nextPid = 1;
    if (!used.has(id)) return id;
  }
  return 1;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let s = '';
    for (let i = 0; i < 4; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(s)) return s;
  }
}

const MODE_IDS = ['levels', 'waves', 'survival', 'ctf', 'arena'];
const validMode = (m) => typeof m === 'string' && MODE_IDS.includes(m);

function cleanName(n) {
  n = String(n || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16);
  return n || 'Игрок';
}
function cleanColor(c) {
  if (Array.isArray(c) && c.length === 3 && c.every((v) => Number.isFinite(v))) return c.map((v) => Math.max(0, Math.min(255, v | 0)));
  return [0, 255, 100];
}
function cleanShape(s) { return TG.SHAPES.includes(s) ? s : 'Circle'; }

function cleanOpts(mode, o) {
  o = o && typeof o === 'object' ? o : {};
  const n = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? Math.max(a, Math.min(b, Math.round(v))) : d; };
  switch (mode) {
    case 'levels': return { level: n(o.level, 1, 20, 1) };
    case 'ctf': return { teamSize: n(o.teamSize, 1, 10, 5), diff: n(o.diff, 1, 4, 2), caps: n(o.caps, 1, 5, 3), time: n(o.time, 5, 15, 10) };
    case 'arena': return { bots: n(o.bots, 0, 10, 2), diff: n(o.diff, 1, 4, 2), kills: n(o.kills, 5, 30, 10), teams: !!o.teams };
    default: return {};
  }
}

class Room {
  constructor(code) {
    this.code = code;
    this.members = new Map(); // pid -> member
    this.host = 0;
    this.mode = 'arena';
    this.opts = cleanOpts('arena', {});
    this.state = 'lobby';
    this.world = null;
    this.result = null;
    this.postTimer = 0;
    this.lastHud = '';
    this.chat = [];
  }

  connected() { let n = 0; for (const m of this.members.values()) if (m.conn) n++; return n; }

  info() {
    return {
      t: 'room', code: this.code, host: this.host, mode: this.mode, opts: this.opts, state: this.state,
      members: Array.from(this.members.values()).map((m) => ({ pid: m.pid, name: m.name, color: m.color, shape: m.shape, team: m.team, off: m.conn ? 0 : 1, ping: m.ping | 0 }))
    };
  }
  broadcastInfo() { this.broadcast(JSON.stringify(this.info())); }
  broadcast(str) { for (const m of this.members.values()) if (m.conn) m.conn.ws.send(str); }
  sys(text) { this.say({ t: 'chat', sys: 1, text }); }
  say(msg) {
    this.chat.push(msg);
    if (this.chat.length > 30) this.chat.shift();
    this.broadcast(JSON.stringify(msg));
  }

  addMember(client) {
    const m = {
      pid: allocPid(), token: crypto.randomBytes(12).toString('hex'), name: client.name, color: client.color,
      shape: client.shape, team: 0, conn: client, ping: 0, offSince: 0
    };
    this.members.set(m.pid, m);
    if (!this.host) this.host = m.pid;
    client.room = this; client.member = m;
    client.ws.send(JSON.stringify({ t: 'joined', code: this.code, pid: m.pid, token: m.token }));
    for (const c of this.chat) client.ws.send(JSON.stringify(c));
    this.sys(`${m.name} присоединился`);
    if (this.world && this.state !== 'lobby') {
      this.world.addPlayer({ id: m.pid, name: m.name, color: m.color, shape: m.shape, team: m.team });
      this.sendStart(m);
      if (this.state === 'post' && this.result) client.ws.send(JSON.stringify({ t: 'end', result: this.result }));
    }
    this.broadcastInfo();
    return m;
  }

  reattach(client, m) {
    if (m.conn && m.conn !== client) { const old = m.conn; old.room = null; old.member = null; old.ws.close(4000); }
    m.conn = client; m.offSince = 0;
    client.room = this; client.member = m;
    client.ws.send(JSON.stringify({ t: 'joined', code: this.code, pid: m.pid, token: m.token }));
    if (this.world && this.state !== 'lobby') {
      const p = this.world.players.get(m.pid);
      if (p) { p.connected = true; p.inputs.length = 0; p.ackSeq = 0; p.credits = 0; }
      else this.world.addPlayer({ id: m.pid, name: m.name, color: m.color, shape: m.shape, team: m.team });
      this.sendStart(m);
      if (this.state === 'post' && this.result) client.ws.send(JSON.stringify({ t: 'end', result: this.result }));
    }
    this.sys(`${m.name} переподключился`);
    this.broadcastInfo();
  }

  detach(m) {
    m.conn = null;
    m.offSince = Date.now();
    if (this.world) { const p = this.world.players.get(m.pid); if (p) { p.connected = false; p.inputs.length = 0; } }
    this.broadcastInfo();
  }

  removeMember(m, reason) {
    this.members.delete(m.pid);
    if (m.conn) { m.conn.room = null; m.conn.member = null; }
    if (this.world) this.world.removePlayer(m.pid);
    this.sys(`${m.name} ${reason || 'вышел'}`);
    if (this.host === m.pid) {
      const next = Array.from(this.members.values()).find((x) => x.conn) || this.members.values().next().value;
      this.host = next ? next.pid : 0;
      if (next) this.sys(`${next.name} теперь хост`);
    }
    if (this.members.size === 0) { rooms.delete(this.code); return; }
    this.broadcastInfo();
  }

  startRound() {
    if (this.connected() === 0) return;
    const opts = Object.assign({}, this.opts);
    this.world = new TG.World({ mode: this.mode, options: opts });
    for (const m of this.members.values()) {
      if (!m.conn) continue;
      this.world.addPlayer({ id: m.pid, name: m.name, color: m.color, shape: m.shape, team: m.team });
    }
    this.world.start();
    this.state = 'playing';
    this.result = null;
    this.lastHud = '';
    for (const m of this.members.values()) if (m.conn) this.sendStart(m);
    this.broadcastInfo();
  }

  sendStart(m) {
    if (!m.conn) return;
    m.conn.lastHud = ''; m.conn.lastPers = ''; m.conn.sbTick = 0;
    const p = this.world.players.get(m.pid);
    if (p && this.world.mode.teamColors) m.team = p.team;
    m.conn.ws.send(JSON.stringify({ t: 'start', info: this.world.roundInfo(), pid: m.pid }));
  }

  toLobby() {
    this.state = 'lobby';
    this.world = null;
    this.result = null;
    this.broadcast(JSON.stringify({ t: 'lobby' }));
    this.broadcastInfo();
  }

  step() {
    const w = this.world;
    if (!w || this.state === 'lobby') return;
    w.step();
    if (w.over && this.state === 'playing') { this.state = 'post'; this.postTimer = 150; }
    if (this.state === 'post' && this.postTimer > 0 && --this.postTimer === 0) {
      this.result = w.result;
      if (this.mode === 'levels' && w.result.win) this.result.next = this.opts.level < 20;
      this.broadcast(JSON.stringify({ t: 'end', result: this.result }));
      this.broadcastInfo();
    }
    if (w.tick % (w.over && this.state === 'post' && this.postTimer === 0 ? 12 : C.SNAP_EVERY) === 0) this.sendSnapshots();
  }

  sendSnapshots() {
    const w = this.world;
    const cull = w.map.w > 1300 || w.map.h > 1000;
    const hud = JSON.stringify(w.mode.hud());
    const hudChanged = hud !== this.lastHud;
    this.lastHud = hud;
    const events = w.events.length ? w.events.map(stripEvent) : null;
    w.events.length = 0;
    let sb = null;
    for (const m of this.members.values()) {
      const c = m.conn;
      if (!c) continue;
      const p = w.players.get(m.pid);
      if (!p) continue;
      if (c.ws.buffered > 512 * 1024) continue; // медленный клиент — пропускаем кадр
      const extra = {};
      let has = false;
      if (hudChanged || c.lastHud !== hud) { extra.h = JSON.parse(hud); c.lastHud = hud; has = true; }
      const pers = w.mode.personal(p);
      const ps = pers ? JSON.stringify(pers) : '';
      if (ps !== c.lastPers) { extra.p = pers; c.lastPers = ps; has = true; }
      if (events) { extra.e = events; has = true; }
      if (w.tick - (c.sbTick || 0) >= 60) {
        if (!sb) sb = w.scoreboard();
        extra.sb = sb; c.sbTick = w.tick; has = true;
      }
      const snap = w.snapshot(m.pid, cull);
      c.ws.send(TG.encodeSnapshot(snap, has ? extra : null));
    }
  }
}

function stripEvent(e) {
  const o = {};
  for (const k in e) {
    const v = e[k];
    o[k] = typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 10) / 10 : v;
  }
  return o;
}

// =====================================================================
// Обработка соединений
// =====================================================================
function onConnection(ws, req) {
  const client = {
    ws, name: 'Игрок', color: [0, 255, 100], shape: 'Circle', room: null, member: null,
    lastSeen: Date.now(), lastChat: 0, lastHud: '', lastPers: '', sbTick: 0, msgs: 0, msgWindow: Date.now()
  };
  clients.add(client);
  ws.send(JSON.stringify({ t: 'welcome', v: VERSION }));

  ws.onmessage = (data) => {
    client.lastSeen = Date.now();
    // простая защита от флуда
    const now = Date.now();
    if (now - client.msgWindow > 1000) { client.msgWindow = now; client.msgs = 0; }
    if (++client.msgs > 400) return;

    if (typeof data !== 'string') {
      if (data.length >= 2 && data[0] === TG.MSG_INPUT && client.room && client.room.world && client.member) {
        const inputs = TG.decodeInputs(data);
        for (const inp of inputs) {
          if (!Number.isFinite(inp.a)) continue;
          client.room.world.pushInput(client.member.pid, inp);
        }
      }
      return;
    }
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    handle(client, msg);
  };
  ws.onclose = () => {
    clients.delete(client);
    const r = client.room, m = client.member;
    if (r && m && m.conn === client) {
      r.detach(m);
      r.sys(`${m.name} отключился`);
    }
  };
}

function send(client, obj) { client.ws.send(JSON.stringify(obj)); }

function handle(client, msg) {
  const room = client.room, me = client.member;
  const isHost = room && me && room.host === me.pid;
  switch (msg.t) {
    case 'ping':
      send(client, { t: 'pong', c: msg.c });
      if (me && Number.isFinite(msg.rtt)) me.ping = Math.max(0, Math.min(9999, msg.rtt | 0));
      break;
    case 'hello':
    case 'profile': {
      client.name = cleanName(msg.name);
      client.color = cleanColor(msg.color);
      client.shape = cleanShape(msg.shape);
      if (room && me) {
        me.name = client.name; me.color = client.color; me.shape = client.shape;
        if (room.world) room.world.updatePlayerProfile(me.pid, { name: me.name, color: me.color, shape: me.shape });
        room.broadcastInfo();
      }
      break;
    }
    case 'create': {
      if (room) leaveRoom(client);
      if (rooms.size >= MAX_ROOMS) return send(client, { t: 'error', msg: 'Сервер переполнен, попробуйте позже' });
      const r = new Room(newCode());
      rooms.set(r.code, r);
      const mode = validMode(msg.mode) ? msg.mode : 'arena';
      r.mode = mode;
      r.opts = cleanOpts(mode, msg.opts);
      r.addMember(client);
      break;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const r = rooms.get(code);
      if (!r) return send(client, { t: 'error', msg: 'Комната ' + code + ' не найдена', code: 'noroom' });
      if (room === r) return;
      if (room) leaveRoom(client);
      if (msg.token) {
        for (const m of r.members.values()) {
          if (m.token === msg.token) { m.name = client.name; m.color = client.color; m.shape = client.shape; r.reattach(client, m); return; }
        }
      }
      if (r.connected() >= C.MAX_PLAYERS) return send(client, { t: 'error', msg: 'Комната заполнена (макс. ' + C.MAX_PLAYERS + ')' });
      r.addMember(client);
      break;
    }
    case 'leave':
      leaveRoom(client);
      break;
    case 'setup':
      if (!isHost || room.state !== 'lobby') return;
      if (validMode(msg.mode)) room.mode = msg.mode;
      room.opts = cleanOpts(room.mode, msg.opts);
      room.broadcastInfo();
      break;
    case 'team':
      if (!me || !room) return;
      me.team = msg.team === 1 || msg.team === 2 ? msg.team : 0;
      room.broadcastInfo();
      break;
    case 'start':
      if (isHost && room.state === 'lobby') room.startRound();
      break;
    case 'post':
      if (!isHost || room.state !== 'post') return;
      if (msg.act === 'next' && room.mode === 'levels' && room.result && room.result.win) {
        room.opts.level = Math.min(20, room.opts.level + 1);
        room.startRound();
      } else if (msg.act === 'again') room.startRound();
      else if (msg.act === 'lobby') room.toLobby();
      break;
    case 'stop':
      if (isHost && room.state !== 'lobby') room.toLobby();
      break;
    case 'chat': {
      if (!room || !me) return;
      const now = Date.now();
      if (now - client.lastChat < 400) return;
      client.lastChat = now;
      const text = String(msg.text || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 140);
      if (text) room.say({ t: 'chat', name: me.name, color: me.color, text });
      break;
    }
  }
}

function leaveRoom(client) {
  const r = client.room, m = client.member;
  client.room = null; client.member = null;
  if (r && m) r.removeMember(m, 'вышел');
}

// =====================================================================
// Игровой цикл (фиксированный шаг 60 Гц)
// =====================================================================
let nextTick = performance.now();
let tickCount = 0;
function loop() {
  const now = performance.now();
  let n = 0;
  while (now >= nextTick && n < 6) {
    for (const r of rooms.values()) {
      try { r.step(); }
      catch (e) { console.error('Ошибка в комнате', r.code, e); r.toLobby(); }
    }
    nextTick += C.TICK_MS;
    n++;
    tickCount++;
  }
  if (now - nextTick > 200) nextTick = now; // сервер «проспал» — не пытаемся догонять
  const wait = nextTick - performance.now();
  if (wait > 2) setTimeout(loop, wait - 1);
  else setImmediate(loop);
}

// Обслуживание: пинги, удаление отключившихся, пустых комнат
setInterval(() => {
  const now = Date.now();
  for (const c of clients) if (now - c.lastSeen > 30000) c.ws.close(4001);
  for (const r of rooms.values()) {
    for (const m of Array.from(r.members.values())) {
      if (!m.conn && m.offSince && now - m.offSince > RECONNECT_GRACE_MS) r.removeMember(m, 'покинул игру');
    }
    if (r.members.size === 0) rooms.delete(r.code);
    else r.broadcast(JSON.stringify({ t: 'pings', p: Array.from(r.members.values()).map((m) => [m.pid, m.ping | 0]) }));
  }
}, 2000).unref();

process.on('uncaughtException', (e) => console.error('Необработанная ошибка:', e));

server.listen(PORT, HOST, () => {
  const addrs = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) addrs.push(a.address);
  }
  console.log('');
  console.log('  ████  TANK BATTLE ONLINE — сервер запущен  ████');
  console.log('');
  console.log('  Играть на этом компьютере:  http://localhost:' + PORT);
  for (const a of addrs) console.log('  Для друзей в той же сети:   http://' + a + ':' + PORT);
  console.log('');
  console.log('  Чтобы остановить сервер — закройте это окно или нажмите Ctrl+C');
  console.log('');
  loop();
  if (process.env.OPEN_BROWSER === '1') {
    try {
      const url = 'http://localhost:' + PORT;
      const cp = require('child_process');
      if (process.platform === 'win32') cp.exec('start "" "' + url + '"');
      else if (process.platform === 'darwin') cp.exec('open "' + url + '"');
      else cp.exec('xdg-open "' + url + '"');
    } catch (e) { /* не критично */ }
  }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Порт ${PORT} уже занят — скорее всего, сервер уже запущен в другом окне.\n  Можно пользоваться им, либо запустить на другом порту:  set PORT=3001 && node server.js\n`);
    if (process.env.OPEN_BROWSER === '1' && process.platform === 'win32') {
      try { require('child_process').exec('start "" "http://localhost:' + PORT + '"'); } catch (err) { /* не критично */ }
    }
  } else console.error(e);
  setTimeout(() => process.exit(1), 300);
});
