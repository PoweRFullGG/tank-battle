/* Игровые сессии:
   LocalSession — одиночная игра, симуляция прямо в браузере;
   NetSession   — мультиплеер: предсказание своего танка + интерполяция остальных. */
(function (TG) {
  'use strict';
  const C = TG.C, TMS = C.TICK_MS;
  const R = TG.Render, A = TG.Audio;
  const F = TG.TF;

  const lerp = (a, b, t) => a + (b - a) * t;
  function lerpAngle(a, b, t) {
    let d = b - a;
    if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // ---------- Общие функции ----------
  function interpolate(sess, a, b, t, out) {
    out.tanks.length = 0; out.bullets.length = 0;
    const amap = sess._amap; amap.clear();
    if (a && a !== b) for (const x of a.tanks) amap.set(x.id, x);
    for (const tb of b.tanks) {
      const ta = amap.get(tb.id);
      const alive = !!(tb.f & 1);
      if (ta && (ta.f & 1) && alive && Math.abs(ta.x - tb.x) + Math.abs(ta.y - tb.y) < 150) {
        out.tanks.push({ id: tb.id, pid: tb.pid, x: lerp(ta.x, tb.x, t), y: lerp(ta.y, tb.y, t), a: lerpAngle(ta.a, tb.a, t), r: lerp(ta.r, tb.r, t), hp: tb.hp, maxHp: tb.maxHp, lvl: tb.lvl, team: tb.team, f: tb.f, me: false });
      } else out.tanks.push({ id: tb.id, pid: tb.pid, x: tb.x, y: tb.y, a: tb.a, r: tb.r, hp: tb.hp, maxHp: tb.maxHp, lvl: tb.lvl, team: tb.team, f: tb.f, me: false });
    }
    const bmap = sess._bmap; bmap.clear();
    if (a && a !== b) for (const x of a.bullets) bmap.set(x.id, x);
    const dtb = (b.tick - (a ? a.tick : b.tick)) * (1 - t);
    for (const bb of b.bullets) {
      // свои (не самонаводящиеся) пули в сетевой игре рисуются «в настоящем» отдельно
      if (sess.skipOwner && bb.owner === sess.skipOwner && !(bb.fl & 2)) continue;
      const ba = bmap.get(bb.id);
      if (ba && Math.abs(ba.x - bb.x) + Math.abs(ba.y - bb.y) < 120) out.bullets.push({ id: bb.id, x: lerp(ba.x, bb.x, t), y: lerp(ba.y, bb.y, t), size: bb.size, owner: bb.owner, fl: bb.fl });
      else out.bullets.push({ id: bb.id, x: bb.x - bb.vx * dtb, y: bb.y - bb.vy * dtb, size: bb.size, owner: bb.owner, fl: bb.fl });
    }
    out.flags = b.flags.map((fb, i) => {
      const fa = a && a.flags[i];
      if (fa && !fb.carrier && !fa.carrier && Math.abs(fa.x - fb.x) + Math.abs(fa.y - fb.y) < 100) return Object.assign({}, fb, { x: lerp(fa.x, fb.x, t), y: lerp(fa.y, fb.y, t) });
      return fb;
    });
    out.boosts = b.boosts;
    return out;
  }

  function colorize(scene) {
    const cmap = new Map();
    for (const t of scene.tanks) cmap.set(t.id, R.tankColor(scene, t));
    for (const b of scene.bullets) {
      const c = cmap.get(b.owner) || scene.ownerColors.get(b.owner) || TG.BOT_COLOR;
      scene.ownerColors.set(b.owner, c);
      b.c = c; b.cs = R.cstr(c);
    }
    if (scene.ownerColors.size > 500) scene.ownerColors.clear();
  }

  // Эффекты от событий симуляции
  function playEvent(sess, e) {
    const myT = sess.myTankId;
    const set = TG.Render.settings;
    switch (e.k) {
      case 'boom':
        R.explosion(e.x, e.y, e.c, e.n || 30, (e.n || 30) >= 50 ? 1.2 : 1);
        A.play('boom', { x: e.x, y: e.y, big: e.big });
        if (e.tid && e.tid === myT) { R.hurt(true); A.buzz([80, 40, 120]); } else R.shake(e.big ? 12 : 4);
        break;
      case 'hit':
        R.explosion(e.x, e.y, e.c, 14, 0.8);
        A.play('hit', { x: e.x, y: e.y });
        if (e.tid === myT) { R.hurt(false); A.buzz(40); }
        if (set.dmgNums && e.d && !e.save) R.floatText(e.x + (Math.random() - 0.5) * 16, e.y - 24, '-' + e.d, e.sid === myT ? [255, 230, 90] : [255, 110, 110]);
        if (e.save && e.tid === myT) R.floatText(e.x, e.y - 30, 'Запасная жизнь!', [255, 150, 170], true);
        break;
      case 'pick': {
        const info = TG.BOOST_INFO[e.b];
        if (!info) break;
        R.explosion(e.x, e.y, info.c, 16, 0.7);
        if (e.tid === myT) { A.play('pick'); R.floatText(e.x, e.y - 20, info.name, info.c, true); }
        else A.play('pick', { x: e.x, y: e.y, vol: 0.4 });
        break;
      }
      case 'coin':
        if (e.tid === myT) { A.play('coin'); R.floatText(e.x, e.y - 14, '+' + e.v, e.v > 1 ? TG.ITEMS.gem.c : TG.ITEMS.crystal.c); }
        break;
      case 'shop':
        if (e.tid === myT) {
          if (e.ok) { A.play('buy'); if (TG.UI) TG.UI.toast('Куплено: ' + e.item, 1500); }
          else { A.play('deny'); if (TG.UI) TG.UI.toast(e.why || 'Нельзя купить', 1500); }
        }
        break;
      case 'place':
        A.play('place', { x: e.x, y: e.y, vol: 0.7 });
        R.spark(e.x, e.y, [150, 170, 255], 8);
        break;
      case 'break':
        R.explosion(e.x, e.y, e.c, e.core ? 90 : 18, e.core ? 1.6 : 0.8);
        A.play(e.core ? 'boom' : 'break', { x: e.x, y: e.y, big: e.core });
        if (e.core) R.shake(16);
        break;
      case 'emp':
        R.ring(e.x, e.y, [120, 200, 255], 290, 6);
        R.explosion(e.x, e.y, [120, 200, 255], 30, 1.5);
        A.play('emp', { x: e.x, y: e.y });
        if (e.tid === myT) R.flash('90,180,255', 0.4);
        break;
      case 'ring':
        R.ring(e.x, e.y, [255, 150, 60], 90, 4);
        A.play('ring', { x: e.x, y: e.y });
        break;
      case 'heal':
        R.explosion(e.x, e.y, [120, 255, 160], e.src ? 6 : 10, 0.5);
        if (!e.src) R.floatText(e.x, e.y - 26, '+1', [120, 255, 160]);
        A.play('heal', { x: e.x, y: e.y, vol: 0.5 });
        break;
      case 'streak':
        if (e.tid === myT) {
          const names = { 2: 'ДВОЙНОЕ УБИЙСТВО!', 3: 'ТРОЙНОЕ УБИЙСТВО!', 4: 'МЕГА-УБИЙСТВО!' };
          const txt = e.n ? (names[e.n] || 'НЕУДЕРЖИМ!') : `СЕРИЯ: ${e.s} УБИЙСТВ!`;
          R.message(txt, [255, 210, 60], true);
          A.play('streak');
        }
        break;
      case 'kill':
        R.killFeed(e);
        if (e.vid === myT) sess.onMyDeath(e);
        else if (e.sid === myT) R.floatText(sess.lastMe ? sess.lastMe.x : 0, sess.lastMe ? sess.lastMe.y - 30 : 0, '+1', [255, 220, 60]);
        break;
      case 'msg':
        if (e.team && e.team !== sess.myTeamNow()) break;
        R.message(e.text, e.c, e.big);
        if (e.cap) A.play('win'); else if (e.flag) A.play('flag'); else if (e.big) A.play('wave');
        if (e.team) A.buzz([60, 60, 60]);
        break;
      case 'lvl':
        R.explosion(e.x, e.y, [255, 210, 60], 40, 1.2);
        if (e.tid === myT) { R.message('НОВЫЙ УРОВЕНЬ ' + e.lv + '!', [255, 210, 60], true); A.play('lvl'); }
        break;
    }
  }

  // Сравнение пуль между кадрами: вспышки выстрелов и искры исчезновения
  function bulletDiff(sess, prev, cur) {
    if (!prev) return;
    const pm = sess._diffMap; pm.clear();
    for (const b of prev.bullets) pm.set(b.id, b);
    const myT = sess.myTankId;
    for (const b of cur.bullets) {
      if (pm.has(b.id)) { pm.delete(b.id); continue; }
      if (sess.isNet && b.owner === myT) continue; // свои выстрелы уже озвучены предсказанием
      const owner = cur.tanks.find((t) => t.id === b.owner);
      const c = owner ? R.tankColor(sess.sceneBase, owner) : TG.BOT_COLOR;
      R.muzzle(b.x, b.y, Math.atan2(b.vy, b.vx), c);
      A.play('shoot', { x: b.x, y: b.y, big: b.size > 9, vol: b.owner === myT ? 0.8 : 0.45 });
    }
    for (const b of pm.values()) {
      if (sess.isNet && b.owner === myT && !(b.fl & 2)) continue;
      const c = sess.sceneBase.ownerColors.get(b.owner);
      R.spark(b.x, b.y, c || [200, 200, 200], 6);
    }
  }

  function baseScene(info, players) {
    return { info, players, tanks: [], bullets: [], boosts: [], flags: [], dyn: [], ownerColors: new Map(), hud: null, pers: null, me: null, focus: null, tick: 0 };
  }

  // Разбор списка разрушаемых препятствий из сети
  function parseDyn(list) {
    const out = [];
    for (let i = 0; i + 8 < list.length; i += 9) {
      out.push({ id: list[i], x: list[i + 1], y: list[i + 2], w: list[i + 3], h: list[i + 4], hp: list[i + 5], maxHp: list[i + 6], team: list[i + 7], core: list[i + 8], dyn: 1 });
    }
    return out;
  }

  function respawnHint(sess, sc, mode) {
    sc.respawnIn = null;
    if (!sc.me || sc.me.alive) return;
    if (sc.pers && sc.pers.resp != null) sc.respawnIn = sc.pers.resp;
    else if ((mode === 'arena' || mode === 'ctf') && sess.deathAt) sc.respawnIn = Math.max(0, Math.ceil(((mode === 'arena' ? 3000 : 5000) - (performance.now() - sess.deathAt)) / 1000));
  }

  // ======================================================================
  // ОДИНОЧНАЯ ИГРА
  // ======================================================================
  class LocalSession {
    constructor(mode, options, profile, admin, game) {
      this.isNet = false;
      this.game = game;
      this.mode = mode;
      this.options = Object.assign({}, options);
      this.profile = profile;
      this.admin = admin;
      this._amap = new Map(); this._bmap = new Map(); this._diffMap = new Map();
      this.start();
    }
    start() {
      const w = this.world = new TG.World({ mode: this.mode, options: this.options, admin: this.admin });
      w.addPlayer({ id: 1, name: this.profile.name, color: this.profile.color, shape: this.profile.shape, team: this.profile.team || 0 });
      w.start();
      this.info = w.roundInfo();
      this.players = new Map([[1, { name: this.profile.name, color: this.profile.color, shape: this.profile.shape }]]);
      this.sceneBase = baseScene(this.info, this.players);
      this.seq = 0; this.acc = 0;
      this.prev = null; this.cur = this.snap();
      this.paused = false; this.overAt = 0; this.resultShown = false; this.deathAt = 0;
      this.myTankId = this.cur.me ? this.cur.me.id : 0;
      R.resetEffects();
    }
    snap() {
      const w = this.world, p = w.players.get(1);
      const s = w.snapshot(1, false);
      s.hud = w.mode.hud();
      s.pers = w.mode.personal(p);
      s.events = w.events.slice();
      w.events.length = 0;
      return s;
    }
    myTeamNow() { const p = this.world.players.get(1); return p ? p.team : 0; }
    update(dt) {
      if (this.paused) return;
      this.acc += dt;
      let n = 0;
      while (this.acc >= TMS && n < 5) {
        const inp = this.game.sampleInput(this);
        inp.seq = ++this.seq;
        TG.quantInput(inp);
        this.world.pushInput(1, inp);
        this.world.step();
        this.prev = this.cur;
        this.cur = this.snap();
        for (const e of this.cur.events) playEvent(this, e);
        bulletDiff(this, this.prev, this.cur);
        this.acc -= TMS; n++;
      }
      if (this.acc > TMS * 5) this.acc = 0;
      if (this.world.over && !this.overAt) this.overAt = this.world.tick;
      if (this.overAt && !this.resultShown && this.world.tick - this.overAt >= 150) {
        this.resultShown = true;
        this.game.showResult(this.world.result, true);
      }
    }
    onMyDeath() { this.deathAt = performance.now(); }
    scene() {
      const sc = this.sceneBase;
      const t = this.paused ? 1 : Math.min(1, this.acc / TMS);
      interpolate(this, this.prev || this.cur, this.cur, t, sc);
      sc.hud = this.cur.hud; sc.pers = this.cur.pers;
      sc.dyn = this.world.dyn;
      sc.tick = this.world.tick - 1 + t;
      sc.meTeam = this.myTeamNow();
      sc.me = null;
      for (const tk of sc.tanks) {
        if (tk.id === this.myTankId) {
          tk.me = true; sc.me = tk;
          tk.alive = !!(tk.f & 1);
          if (tk.alive && !this.paused && !(tk.f & F.stun)) tk.a = this.game.liveAim != null ? this.game.liveAim : tk.a;
        }
      }
      colorize(sc);
      sc.focus = sc.me;
      sc.over = this.world.over;
      respawnHint(this, sc, this.mode);
      if (sc.me && !sc.me.alive) {
        // наблюдение за союзником в кооперативе
        const mate = sc.tanks.find((x) => x.pid && x.id !== this.myTankId && (x.f & 1));
        if (mate) sc.focus = mate;
      }
      if (sc.me) this.lastMe = sc.me;
      sc.ping = null;
      return sc;
    }
    scoreboard() { return this.world.scoreboard(); }
    myTeam() { return this.myTeamNow(); }
    restart(nextLevel) {
      if (nextLevel && this.mode === 'levels') this.options.level = Math.min(TG.CAMPAIGN.length, (this.options.level || 1) + 1);
      this.start();
    }
    destroy() {}
  }

  // ======================================================================
  // СЕТЕВАЯ ИГРА
  // ======================================================================
  class NetSession {
    constructor(net, msg, game) {
      this.isNet = true;
      this.net = net;
      this.game = game;
      this.info = msg.info;
      this.pid = msg.pid;
      this.players = game.roomPlayers;
      this.sceneBase = baseScene(this.info, this.players);
      this.staticObs = this.info.obstacles;
      this.dyn = parseDyn(this.info.dyn || []);
      this.map = { w: this.info.w, h: this.info.h, obstacles: this.staticObs.concat(this.dyn) };
      this.snaps = [];
      this.pending = [];
      this.outbox = [];
      this.seq = net.seq || 0;
      this.pred = null;
      this.off = { x: 0, y: 0 };
      this.acc = 0;
      this.clockOff = null; this.jitter = 0; this.delay = 5; this.lastRt = 0;
      this.hud = null; this.pers = null; this.sb = null;
      this.events = [];
      this.baseSnap = null;
      this.myTankId = 0;
      this.myTeamV = 0;
      this.deathAt = 0;
      this.over = false;
      this._amap = new Map(); this._bmap = new Map(); this._diffMap = new Map();
      this._ownNow = new Map(); this._ownPrev = new Map();
      this.follow = 0;
      R.resetEffects();
    }

    myTeamNow() { return this.myTeamV || this.myTeam(); }

    onSnapshot(s) {
      const nowT = performance.now() / TMS;
      const sample = s.tick - nowT;
      if (this.clockOff == null || Math.abs(sample - this.clockOff) > 60) { this.clockOff = sample; this.jitter = 1; }
      else {
        if (sample > this.clockOff) this.clockOff = sample;
        else this.clockOff -= 0.003;
        this.jitter = this.jitter * 0.96 + (this.clockOff - sample) * 0.04;
      }
      const last = this.snaps[this.snaps.length - 1];
      if (last && s.tick <= last.tick) return;
      this.snaps.push(s);
      if (this.snaps.length > 90) this.snaps.splice(0, this.snaps.length - 90);
      if (s.me) {
        this.myTankId = s.me.id;
        const mt = s.tanks.find((x) => x.id === s.me.id);
        if (mt) this.myTeamV = mt.team;
      }
      if (s.extra) {
        if (s.extra.h) this.hud = s.extra.h;
        if ('p' in s.extra) this.pers = s.extra.p;
        if (s.extra.sb) this.sb = s.extra.sb;
        if (s.extra.ob) {
          this.dyn = parseDyn(s.extra.ob);
          this.map.obstacles = this.staticObs.concat(this.dyn);
        }
        if (s.extra.e) for (const e of s.extra.e) {
          if (e.k === 'over') this.over = true;
          // события своего танка — сразу (свой танк живёт «в настоящем»)
          if (e.tid && e.tid === this.myTankId && (e.k === 'pick' || e.k === 'hit' || e.k === 'coin' || e.k === 'shop' || e.k === 'place')) playEvent(this, e);
          else this.events.push(e);
        }
      }
      this.reconcile(s);
    }

    applyPred(p, inp, live) {
      if (!p.alive || p.stun) return;
      TG.moveTank(p, inp.mx, inp.my, this.map);
      if (p.cd > 0) p.cd--;
      if (inp.fire && p.cd <= 0) {
        p.cd = p.rate;
        if (live) {
          const x = p.x + Math.cos(inp.a) * (p.r + 6), y = p.y + Math.sin(inp.a) * (p.r + 6);
          const me = this.players.get(this.pid);
          R.muzzle(x, y, inp.a, this.info.teamColors && TG.TEAM_COLORS[this.myTeamNow()] ? TG.TEAM_COLORS[this.myTeamNow()] : (me ? me.color : [0, 255, 100]));
          A.play('shoot', { vol: 0.8 });
        }
      }
    }

    reconcile(s) {
      const me = s.me;
      if (!me) { this.pred = null; return; }
      const ack = s.ack;
      let i = 0;
      while (i < this.pending.length && this.pending[i].seq <= ack) i++;
      if (i) this.pending.splice(0, i);
      const old = this.pred && this.pred.alive ? { x: this.pred.x + this.off.x, y: this.pred.y + this.off.y } : null;
      const p = this.pred || (this.pred = {});
      p.x = me.x; p.y = me.y; p.r = me.r; p.speed = me.speed; p.cd = me.cd; p.rate = me.rate;
      p.alive = !!(me.alive & 1); p.stun = !!(me.alive & 2); p.id = me.id;
      for (const inp of this.pending) this.applyPred(p, inp, false);
      if (old && p.alive) {
        const ex = old.x - p.x, ey = old.y - p.y;
        if (Math.hypot(ex, ey) < 100) { this.off.x = ex; this.off.y = ey; }
        else { this.off.x = 0; this.off.y = 0; }
      } else { this.off.x = 0; this.off.y = 0; }
    }

    update(dt) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= TMS && n < 5) {
        const inp = this.game.sampleInput(this);
        inp.seq = ++this.seq;
        TG.quantInput(inp);
        this.pending.push(inp);
        this.outbox.push(inp);
        if (this.pred) this.applyPred(this.pred, inp, true);
        this.acc -= TMS; n++;
      }
      if (this.acc > TMS * 5) this.acc = 0;
      if (this.pending.length > 240) this.pending.splice(0, this.pending.length - 240);
      if (this.outbox.length) { this.net.sendInputs(this.outbox); this.outbox.length = 0; }
      this.net.seq = this.seq;
      const k = Math.exp(-dt / 70);
      this.off.x *= k; this.off.y *= k;
      if (Math.abs(this.off.x) < 0.01) this.off.x = 0;
      if (Math.abs(this.off.y) < 0.01) this.off.y = 0;
      const target = Math.max(3, Math.min(14, C.SNAP_EVERY + 1.5 + this.jitter * 2));
      this.delay += (target - this.delay) * Math.min(1, dt / 800);
    }

    renderTick() {
      if (this.clockOff == null) return 0;
      let rt = performance.now() / TMS + this.clockOff - this.delay;
      if (rt < this.lastRt && this.lastRt - rt < 30) rt = this.lastRt;
      this.lastRt = rt;
      return rt;
    }

    onMyDeath() { this.deathAt = performance.now(); }

    myTeam() { const m = this.players.get(this.pid); return m ? m.team : 0; }

    scene() {
      const sc = this.sceneBase;
      const snaps = this.snaps;
      if (!snaps.length) return null;
      const rt = this.renderTick();
      let a = snaps[0], b = snaps[0];
      if (rt >= snaps[snaps.length - 1].tick) {
        b = snaps[snaps.length - 1];
        a = snaps.length > 1 ? snaps[snaps.length - 2] : b;
      } else {
        for (let i = snaps.length - 1; i > 0; i--) {
          if (snaps[i - 1].tick <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
        }
      }
      let t = b.tick > a.tick ? (rt - a.tick) / (b.tick - a.tick) : 1;
      t = Math.max(0, Math.min(t, 1 + 3 / Math.max(1, b.tick - a.tick)));
      if (this.baseSnap !== a) {
        if (this.baseSnap && a.tick > this.baseSnap.tick) bulletDiff(this, this.baseSnap, a);
        this.baseSnap = a;
      }
      while (this.events.length && this.events[0].tk <= rt) playEvent(this, this.events.shift());
      if (this.events.length > 200) this.events.splice(0, this.events.length - 200);

      this.skipOwner = this.myTankId;
      interpolate(this, a, b, t, sc);
      this.skipOwner = 0;
      const latest = snaps[snaps.length - 1];
      // Свои пули — продвигаем вперёд до «настоящего» (детерминированная физика отскоков)
      const ownNow = this._ownNow, ownPrev = this._ownPrev;
      ownNow.clear();
      if (this.myTankId) {
        const ahead = Math.min(40, this.pending.length + this.acc / TMS);
        const steps = Math.floor(ahead), frac = ahead - steps;
        for (const b0 of latest.bullets) {
          if (b0.owner !== this.myTankId || (b0.fl & 2)) continue;
          const bb = { x: b0.x, y: b0.y, vx: b0.vx, vy: b0.vy, size: b0.size, hitObs: null };
          let gone = false;
          for (let i = 0; i < steps; i++) { TG.stepBullet(bb, this.map); if (bb.hitObs) { gone = true; break; } }
          if (gone) continue;
          const ob = { id: b0.id, x: bb.x + bb.vx * frac, y: bb.y + bb.vy * frac, size: bb.size, owner: b0.owner, fl: b0.fl };
          sc.bullets.push(ob);
          ownNow.set(ob.id, ob);
        }
      }
      for (const [id, ob] of ownPrev) if (!ownNow.has(id)) R.spark(ob.x, ob.y, ob.c || [220, 220, 220], 6);
      this._ownPrev = ownNow; this._ownNow = ownPrev;
      sc.hud = this.hud; sc.pers = this.pers;
      sc.dyn = this.dyn;
      sc.tick = rt;
      sc.meTeam = this.myTeamNow();
      sc.me = null;
      const latestMe = latest.tanks.find((x) => x.id === this.myTankId);
      for (const tk of sc.tanks) {
        if (tk.id !== this.myTankId) continue;
        tk.me = true; sc.me = tk;
        if (latestMe) { tk.f = latestMe.f; tk.hp = latestMe.hp; tk.maxHp = latestMe.maxHp; }
        tk.alive = !!(tk.f & 1);
        if (this.pred && this.pred.alive && tk.alive) {
          tk.x = this.pred.x + this.off.x; tk.y = this.pred.y + this.off.y; tk.r = this.pred.r;
          if (this.game.liveAim != null && !(tk.f & F.stun)) tk.a = this.game.liveAim;
        }
      }
      colorize(sc);
      sc.spectating = null;
      if (sc.me && sc.me.alive) sc.focus = sc.me;
      else {
        let f = sc.tanks.find((x) => x.id === this.follow && (x.f & 1));
        if (!f) {
          const myTeam = this.myTeamNow();
          f = sc.tanks.find((x) => x.pid && x.pid !== this.pid && (x.f & 1) && (myTeam === 0 || x.team === myTeam)) ||
              sc.tanks.find((x) => x.pid && x.pid !== this.pid && (x.f & 1)) || sc.tanks.find((x) => (x.f & 1));
          this.follow = f ? f.id : 0;
        }
        sc.focus = sc.me && !f ? sc.me : f || null;
        if (f && f.pid) { const pl = this.players.get(f.pid); sc.spectating = pl ? pl.name : null; }
      }
      sc.over = this.over;
      respawnHint(this, sc, this.info.mode);
      if (sc.me) this.lastMe = sc.me;
      sc.ping = this.net.rtt;
      return sc;
    }
    scoreboard() { return this.sb || []; }
    destroy() {}
  }

  // ======================================================================
  // ДЕМО — битва ботов на фоне главного меню (без звука)
  // ======================================================================
  class DemoSession {
    constructor() {
      this.isNet = false;
      this._amap = new Map(); this._bmap = new Map(); this._diffMap = new Map();
      const w = this.world = new TG.World({ mode: 'arena', options: { bots: 7, diff: 3, kills: 30 } });
      w.start();
      this.info = w.roundInfo();
      this.players = new Map();
      this.sceneBase = baseScene(this.info, this.players);
      this.acc = 0; this.prev = null; this.cur = this.snap();
      this.myTankId = 0; this.focusId = 0; this.focusT = 0;
      this.fx = this.info.w / 2; this.fy = this.info.h / 2;
    }
    snap() { const s = this.world.snapshot(null, false); s.events = this.world.events.slice(); this.world.events.length = 0; return s; }
    onMyDeath() {}
    myTeamNow() { return 0; }
    update(dt) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= TMS && n < 3) {
        this.world.step();
        if (this.world.over) { const d = new DemoSession(); Object.assign(this, d); return; }
        this.prev = this.cur; this.cur = this.snap();
        for (const e of this.cur.events) {
          if (e.k === 'boom') R.explosion(e.x, e.y, e.c, e.n || 30);
          else if (e.k === 'hit') R.explosion(e.x, e.y, e.c, 10, 0.8);
          else if (e.k === 'emp') R.ring(e.x, e.y, [120, 200, 255], 290, 6);
        }
        bulletDiff(this, this.prev, this.cur);
        this.acc -= TMS; n++;
      }
      if (this.acc > TMS * 3) this.acc = 0;
    }
    scene() {
      const sc = this.sceneBase;
      interpolate(this, this.prev || this.cur, this.cur, Math.min(1, this.acc / TMS), sc);
      colorize(sc);
      sc.dyn = this.world.dyn;
      const now = performance.now();
      let f = sc.tanks.find((t) => t.id === this.focusId && (t.f & 1));
      if (!f || now > this.focusT) {
        const alive = sc.tanks.filter((t) => t.f & 1);
        f = alive.length ? alive[Math.floor(Math.random() * alive.length)] : null;
        this.focusId = f ? f.id : 0; this.focusT = now + 7000;
      }
      if (f) { this.fx += (f.x - this.fx) * 0.02; this.fy += (f.y - this.fy) * 0.02; }
      sc.focus = { x: this.fx, y: this.fy };
      sc.me = null; sc.hud = null; sc.pers = null; sc.demo = true; sc.meTeam = null;
      return sc;
    }
  }

  TG.DemoSession = DemoSession;
  TG.LocalSession = LocalSession;
  TG.NetSession = NetSession;

  // ======================================================================
  // Сетевое соединение (WebSocket) с автопереподключением
  // ======================================================================
  const Net = TG.Net = {
    ws: null, connected: false, rtt: null, seq: 0, handlers: {}, want: false, code: null, token: null, retry: 0, profile: null
  };
  Net.url = function () {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + location.host + '/ws';
  };
  Net.available = function () { return location.protocol === 'http:' || location.protocol === 'https:'; };
  Net.on = function (t, fn) { Net.handlers[t] = fn; };
  Net.emit = function (t, d) { const h = Net.handlers[t]; if (h) h(d); };

  Net.connect = function () {
    if (!Net.available()) return;
    Net.want = true;
    if (Net.ws && (Net.ws.readyState === 0 || Net.ws.readyState === 1)) return;
    let ws;
    try { ws = new WebSocket(Net.url()); } catch (e) { Net.scheduleRetry(); return; }
    ws.binaryType = 'arraybuffer';
    Net.ws = ws;
    ws.onopen = () => {
      Net.connected = true; Net.retry = 0;
      Net.send({ t: 'hello', name: Net.profile.name, color: Net.profile.color, shape: Net.profile.shape });
      if (Net.code) Net.send({ t: 'join', code: Net.code, token: Net.token });
      Net.emit('open');
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') {
        let s;
        try { s = TG.decodeSnapshot(ev.data); } catch (e) { return; }
        Net.emit('snap', s);
        return;
      }
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'pong') { const r = performance.now() - m.c; Net.rtt = Net.rtt == null ? Math.round(r) : Math.round(Net.rtt * 0.7 + r * 0.3); return; }
      if (m.t === 'joined') { Net.code = m.code; Net.token = m.token; try { sessionStorage.setItem('tbo_tok_' + m.code, m.token); } catch (e) { /* игнор */ } }
      Net.emit(m.t, m);
    };
    ws.onclose = (ev) => {
      const was = Net.connected;
      Net.connected = false;
      if (Net.ws === ws) Net.ws = null;
      if (ev && ev.code === 4000) { // эту же сессию открыли в другой вкладке
        Net.want = false; Net.code = null; Net.token = null;
        Net.emit('replaced');
        return;
      }
      Net.emit('close', was);
      if (Net.want) Net.scheduleRetry();
    };
    ws.onerror = () => { /* обработается в onclose */ };
  };
  Net.scheduleRetry = function () {
    clearTimeout(Net._rt);
    Net.retry++;
    Net._rt = setTimeout(() => { if (Net.want) Net.connect(); }, Math.min(3000, 400 * Net.retry));
  };
  Net.disconnect = function () { Net.want = false; Net.code = null; Net.token = null; if (Net.ws) Net.ws.close(); };
  Net.send = function (obj) { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(JSON.stringify(obj)); };
  Net.sendInputs = function (arr) { if (Net.ws && Net.ws.readyState === 1) Net.ws.send(TG.encodeInputs(arr)); };
  Net.leaveRoom = function () {
    Net.send({ t: 'leave' });
    if (Net.code) try { sessionStorage.removeItem('tbo_tok_' + Net.code); } catch (e) { /* игнор */ }
    Net.code = null; Net.token = null;
  };
  setInterval(() => { if (Net.connected) Net.send({ t: 'ping', c: performance.now(), rtt: Net.rtt }); }, 1000);
})(self.TG);
