/* Tank Battle Online — компактный бинарный протокол (снапшоты и ввод). */
(function (TG) {
  'use strict';
  const PS = TG.C.POS_SCALE;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const MSG_SNAP = 1, MSG_INPUT = 2;
  TG.MSG_SNAP = MSG_SNAP;
  TG.MSG_INPUT = MSG_INPUT;

  let buf = new ArrayBuffer(1 << 16);
  let dv = new DataView(buf);
  function ensure(n) {
    if (n <= buf.byteLength) return;
    let s = buf.byteLength;
    while (s < n) s *= 2;
    buf = new ArrayBuffer(s);
    dv = new DataView(buf);
  }
  const qp = (v) => { v = Math.round(v * PS); return v < 0 ? 0 : v > 65535 ? 65535 : v; };
  const qs = (v, k) => { v = Math.round(v * k); return v < -32767 ? -32767 : v > 32767 ? 32767 : v; };

  // snap: объект из World.snapshot(); extra: {hud, pers, ev} (JSON, может быть null)
  TG.encodeSnapshot = function (snap, extra) {
    const json = extra ? enc.encode(JSON.stringify(extra)) : null;
    const size = 64 + snap.tanks.length * 18 + snap.bullets.length * 15 + snap.boosts.length * 7 + snap.flags.length * 9 + (json ? json.length : 0);
    ensure(size);
    let o = 0;
    dv.setUint8(o, MSG_SNAP); o += 1;
    dv.setUint32(o, snap.tick, true); o += 4;
    dv.setUint32(o, snap.ack >>> 0, true); o += 4;
    const me = snap.me;
    dv.setUint8(o, me ? 1 : 0); o += 1;
    if (me) {
      dv.setUint16(o, me.id, true); o += 2;
      dv.setFloat64(o, me.x, true); o += 8;
      dv.setFloat64(o, me.y, true); o += 8;
      dv.setFloat32(o, me.speed, true); o += 4;
      dv.setUint8(o, me.r); o += 1;
      dv.setInt16(o, me.cd, true); o += 2;
      dv.setUint16(o, me.rate, true); o += 2;
      dv.setUint8(o, me.alive); o += 1;
    }
    dv.setUint16(o, snap.tanks.length, true); o += 2;
    for (const t of snap.tanks) {
      dv.setUint16(o, t.id, true);
      dv.setUint16(o + 2, t.pid, true);
      dv.setUint16(o + 4, qp(t.x), true);
      dv.setUint16(o + 6, qp(t.y), true);
      dv.setInt16(o + 8, qs(t.a, 10000), true);
      dv.setUint8(o + 10, t.r);
      dv.setUint8(o + 11, Math.min(255, t.hp));
      dv.setUint8(o + 12, Math.min(255, t.maxHp));
      dv.setUint8(o + 13, t.lvl);
      dv.setUint8(o + 14, t.team);
      dv.setUint16(o + 15, t.f, true);
      o += 18;
    }
    dv.setUint16(o, snap.bullets.length, true); o += 2;
    for (const b of snap.bullets) {
      dv.setUint16(o, b.id, true);
      dv.setUint16(o + 2, qp(b.x), true);
      dv.setUint16(o + 4, qp(b.y), true);
      dv.setInt16(o + 6, qs(b.vx, 100), true);
      dv.setInt16(o + 8, qs(b.vy, 100), true);
      dv.setUint8(o + 10, Math.min(255, Math.round(b.size * 4)));
      dv.setUint16(o + 11, b.owner, true);
      dv.setUint8(o + 13, b.fl || 0);
      o += 15;
    }
    const nb = Math.min(255, snap.boosts.length);
    dv.setUint8(o, nb); o += 1;
    for (let i = 0; i < nb; i++) {
      const b = snap.boosts[i];
      dv.setUint16(o, b.id, true);
      dv.setUint16(o + 2, b.x, true);
      dv.setUint16(o + 4, b.y, true);
      dv.setUint8(o + 6, b.type);
      o += 7;
    }
    dv.setUint8(o, snap.flags.length); o += 1;
    for (const f of snap.flags) {
      dv.setUint16(o, qp(f.x), true);
      dv.setUint16(o + 2, qp(f.y), true);
      dv.setUint16(o + 4, f.carrier, true);
      dv.setUint8(o + 6, f.team);
      dv.setUint8(o + 7, f.home);
      dv.setUint8(o + 8, f.ret);
      o += 9;
    }
    dv.setUint32(o, json ? json.length : 0, true); o += 4;
    if (json) { new Uint8Array(buf, o, json.length).set(json); o += json.length; }
    return new Uint8Array(buf, 0, o).slice();
  };

  TG.decodeSnapshot = function (ab) {
    const d = new DataView(ab);
    let o = 1;
    const snap = { tick: d.getUint32(o, true), ack: d.getUint32(o + 4, true), me: null, tanks: [], bullets: [], boosts: [], flags: [], extra: null };
    o += 8;
    const hasMe = d.getUint8(o); o += 1;
    if (hasMe) {
      snap.me = {
        id: d.getUint16(o, true), x: d.getFloat64(o + 2, true), y: d.getFloat64(o + 10, true),
        speed: d.getFloat32(o + 18, true), r: d.getUint8(o + 22), cd: d.getInt16(o + 23, true),
        rate: d.getUint16(o + 25, true), alive: d.getUint8(o + 27)
      };
      o += 28;
    }
    let n = d.getUint16(o, true); o += 2;
    for (let i = 0; i < n; i++) {
      snap.tanks.push({
        id: d.getUint16(o, true), pid: d.getUint16(o + 2, true),
        x: d.getUint16(o + 4, true) / PS, y: d.getUint16(o + 6, true) / PS,
        a: d.getInt16(o + 8, true) / 10000, r: d.getUint8(o + 10), hp: d.getUint8(o + 11),
        maxHp: d.getUint8(o + 12), lvl: d.getUint8(o + 13), team: d.getUint8(o + 14), f: d.getUint16(o + 15, true)
      });
      o += 18;
    }
    n = d.getUint16(o, true); o += 2;
    for (let i = 0; i < n; i++) {
      snap.bullets.push({
        id: d.getUint16(o, true), x: d.getUint16(o + 2, true) / PS, y: d.getUint16(o + 4, true) / PS,
        vx: d.getInt16(o + 6, true) / 100, vy: d.getInt16(o + 8, true) / 100,
        size: d.getUint8(o + 10) / 4, owner: d.getUint16(o + 11, true), fl: d.getUint8(o + 13)
      });
      o += 15;
    }
    n = d.getUint8(o); o += 1;
    for (let i = 0; i < n; i++) {
      snap.boosts.push({ id: d.getUint16(o, true), x: d.getUint16(o + 2, true), y: d.getUint16(o + 4, true), type: d.getUint8(o + 6) });
      o += 7;
    }
    n = d.getUint8(o); o += 1;
    for (let i = 0; i < n; i++) {
      snap.flags.push({ x: d.getUint16(o, true) / PS, y: d.getUint16(o + 2, true) / PS, carrier: d.getUint16(o + 4, true), team: d.getUint8(o + 6), home: d.getUint8(o + 7), ret: d.getUint8(o + 8) });
      o += 9;
    }
    const jl = d.getUint32(o, true); o += 4;
    if (jl) snap.extra = JSON.parse(dec.decode(new Uint8Array(ab, o, jl)));
    return snap;
  };

  // Ввод: [type u8][count u8] + count * (seq u32, mx i8, my i8, a i16, btn u8, up u8)
  TG.encodeInputs = function (inputs) {
    const n = Math.min(inputs.length, 255);
    const out = new ArrayBuffer(2 + n * 10);
    const d = new DataView(out);
    d.setUint8(0, MSG_INPUT);
    d.setUint8(1, n);
    let o = 2;
    for (let i = inputs.length - n; i < inputs.length; i++) {
      const inp = inputs[i];
      d.setUint32(o, inp.seq, true);
      d.setInt8(o + 4, Math.round(inp.mx * 127));
      d.setInt8(o + 5, Math.round(inp.my * 127));
      d.setInt16(o + 6, Math.round(inp.a * 10000), true);
      d.setUint8(o + 8, inp.fire ? 1 : 0);
      d.setUint8(o + 9, inp.up || 0);
      o += 10;
    }
    return out;
  };

  TG.decodeInputs = function (u8) {
    const d = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const n = d.getUint8(1);
    if (u8.byteLength < 2 + n * 10) return [];
    const res = [];
    let o = 2;
    for (let i = 0; i < n; i++) {
      const up = d.getUint8(o + 9);
      res.push({
        seq: d.getUint32(o, true), mx: d.getInt8(o + 4) / 127, my: d.getInt8(o + 5) / 127,
        a: d.getInt16(o + 6, true) / 10000, fire: (d.getUint8(o + 8) & 1) === 1, up: up < 48 ? up : 0
      });
      o += 10;
    }
    return res;
  };
})(typeof globalThis !== 'undefined' ? (globalThis.TG = globalThis.TG || {}) : (self.TG = self.TG || {}));
