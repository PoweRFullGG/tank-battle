/* Tank Battle Online — мир симуляции (авторитетный на сервере, локальный в одиночной игре). */
(function (TG) {
  'use strict';
  const C = TG.C, U = TG.U;

  class World {
    // opts: {mode, options, admin}
    constructor(opts) {
      this.modeId = opts.mode;
      this.options = opts.options || {};
      this.admin = opts.admin || null;
      this.tick = 0;
      this.tanks = [];
      this.tankMap = new Map();
      this.bullets = [];
      this.boosts = [];
      this.players = new Map();
      this.map = { w: 800, h: 600, obstacles: [], bases: [] };
      this.flags = [];
      this.events = [];
      this.nextId = 1;
      this.nextBulletId = 1;
      this.nextBoostId = 1;
      this.over = false;
      this.result = null;
      this.started = false;
      this.boostTimer = 0;
      const M = Object.prototype.hasOwnProperty.call(TG.MODES, opts.mode) ? TG.MODES[opts.mode] : null;
      if (!M) throw new Error('Unknown mode ' + opts.mode);
      this.mode = new M(this, this.options);
    }

    // ---------- Игроки ----------
    addPlayer(d) {
      const p = {
        id: d.id, name: d.name || 'Игрок', color: d.color || [0, 255, 100], shape: d.shape || 'Circle',
        team: d.team || 0, tank: null, inputs: [], credits: 0, ackSeq: 0, connected: true,
        pending: 0, upOpts: [], joinTick: this.tick, respawnAt: 0
      };
      this.players.set(p.id, p);
      if (this.started) this.mode.onJoin(p);
      return p;
    }

    removePlayer(pid) {
      const p = this.players.get(pid);
      if (!p) return;
      this.mode.onLeave(p);
      if (p.tank) this.removeTank(p.tank);
      this.players.delete(pid);
    }

    updatePlayerProfile(pid, d) {
      const p = this.players.get(pid);
      if (!p) return;
      if (d.name) { p.name = d.name; if (p.tank) p.tank.name = d.name; }
      if (d.color) p.color = d.color;
      if (d.shape) p.shape = d.shape;
    }

    pushInput(pid, inp) {
      const p = this.players.get(pid);
      if (!p) return;
      if (inp.seq <= p.ackSeq) return; // устаревший
      const last = p.inputs.length ? p.inputs[p.inputs.length - 1].seq : 0;
      if (inp.seq <= last) return;
      p.inputs.push(inp);
      if (p.inputs.length > 40) p.inputs.splice(0, p.inputs.length - 40);
    }

    start() {
      this.mode.setup();
      this.started = true;
      // навигационная сетка для ботов строится заранее, чтобы не было подтормаживания на первом тике
      if (TG.NavGrid && this.tanks.some((t) => t.isBot)) this.nav = new TG.NavGrid(this.map);
    }

    // ---------- Танки ----------
    newId() {
      let id = this.nextId;
      for (let i = 0; i < 70000; i++) {
        if (id > 65000) id = 1;
        if (!this.tankMap.has(id)) break;
        id++;
      }
      this.nextId = id + 1;
      return id;
    }

    createTank(o) {
      const t = {
        id: this.newId(), pid: o.pid || 0, isBot: !o.pid, name: o.name || 'Бот',
        x: o.x, y: o.y, a: o.a || 0, r: C.TANK_R, baseR: C.TANK_R,
        baseSpeed: o.speed || 3, speed: o.speed || 3,
        hp: o.hp || 1, maxHp: o.maxHp || o.hp || 1, team: o.team || 0, lvl: o.lvl || 0,
        alive: true, respawnAt: 0, cd: o.cd == null ? 30 : o.cd, rate: o.rate || C.PLAYER_RATE,
        extraLife: false, shieldUntil: 0, iframeUntil: 0, speedUntil: 0, bigUntil: 0,
        gatlingUntil: 0, miniUntil: 0, fastUntil: 0,
        bulletSpeedMod: o.bulletSpeedMod || 1, sizeMult: 1, reloadMult: 1,
        vx: 0, vy: 0, kills: 0, deaths: 0, score: 0, ai: {}, noBoosts: !!o.noBoosts,
        carrying: null, xp: 0, level: 1
      };
      if (!t.isBot && this.admin) {
        t.baseSpeed = t.speed = +this.admin.player_speed || 3;
        t.bulletSpeedMod = +this.admin.bullet_speed || 1;
      }
      this.tanks.push(t);
      this.tankMap.set(t.id, t);
      return t;
    }

    removeTank(t) {
      const i = this.tanks.indexOf(t);
      if (i >= 0) this.tanks.splice(i, 1);
      this.tankMap.delete(t.id);
      for (const f of this.flags) if (f.carrier === t) this.dropFlag(f, t.x, t.y);
    }

    spawnPlayer(p, pos, o) {
      o = o || {};
      if (!p.tank) {
        p.tank = this.createTank({ pid: p.id, name: p.name, x: pos.x, y: pos.y, hp: o.hp || 1, maxHp: o.maxHp || o.hp || 1, team: p.team, cd: 20 });
      } else {
        this.revive(p.tank, pos, o.shield || 0);
        if (o.hp) { p.tank.maxHp = Math.max(p.tank.maxHp, o.maxHp || o.hp); p.tank.hp = p.tank.maxHp; }
      }
      p.tank.team = p.team;
      if (o.shield) p.tank.shieldUntil = this.tick + o.shield;
      return p.tank;
    }

    revive(t, pos, shield) {
      t.x = pos.x; t.y = pos.y; t.alive = true; t.hp = t.maxHp; t.r = t.baseR;
      t.speedUntil = t.bigUntil = t.gatlingUntil = t.miniUntil = t.fastUntil = 0;
      t.iframeUntil = 0; t.shieldUntil = shield ? this.tick + shield : 0;
      t.extraLife = false; t.cd = 20; t.vx = t.vy = 0; t.carrying = null; t.speed = t.baseSpeed;
      if (t.isBot) t.ai = {};
      TG.unstick(t, this.map);
    }

    isInvincible(t) {
      if (!t.isBot && this.admin && this.admin.god_mode) return true;
      return t.shieldUntil > this.tick || t.iframeUntil > this.tick;
    }

    hostile(a, b) { // a,b — объекты с team и id/owner
      return a.team === 0 || b.team === 0 ? true : a.team !== b.team;
    }

    rateOf(t) {
      let r;
      if (t.isBot) r = t.rate;
      else {
        r = this.admin ? TG.msToTicks(+this.admin.fire_rate || 500) : C.PLAYER_RATE;
        r = Math.max(3, Math.round(r * t.reloadMult));
      }
      if (t.gatlingUntil > this.tick) r = Math.min(r, C.GATLING_RATE);
      return r;
    }

    fire(t, seq) {
      if (this.bullets.length >= C.MAX_BULLETS) return false;
      const rate = this.rateOf(t);
      t.cd = rate;
      const cos = Math.cos(t.a), sin = Math.sin(t.a);
      const big = t.bigUntil > this.tick;
      const size = C.BULLET_SIZE * t.sizeMult * (big ? 2 : 1);
      let spd = t.lvl === 20 ? 12 : C.BULLET_SPEED * t.bulletSpeedMod;
      if (t.fastUntil > this.tick) spd *= 3;
      let bx = t.x + cos * (t.r + 4), by = t.y + sin * (t.r + 4);
      if (TG.bulletBlocked(bx, by, size, this.map) || !TG.lineOfSight(this.map, t.x, t.y, bx, by, 0)) {
        bx = t.x; by = t.y;
        if (TG.bulletBlocked(bx, by, size, this.map)) return false;
      }
      let id = this.nextBulletId++;
      if (this.nextBulletId > 65000) this.nextBulletId = 1;
      this.bullets.push({
        id, x: bx, y: by, vx: cos * spd, vy: sin * spd, size, owner: t.id, team: t.team,
        big: size > 9, life: C.BULLET_LIFE, seq: seq || 0
      });
      return true;
    }

    applyInput(p, inp) {
      const t = p.tank;
      p.ackSeq = inp.seq;
      if (inp.up) this.chooseUpgrade(p, inp.up - 1);
      if (!t || !t.alive || this.over || this.mode.frozen) return;
      t.a = inp.a;
      TG.moveTank(t, inp.mx, inp.my, this.map);
      if (t.cd > 0) t.cd--;
      if (inp.fire && t.cd <= 0) this.fire(t, inp.seq);
    }

    chooseUpgrade(p, idx) {
      if (this.mode.chooseUpgrade) this.mode.chooseUpgrade(p, idx);
    }

    // ---------- Урон ----------
    damage(t, src) {
      if (!t.alive) return;
      if (t.hp > 1) {
        t.hp--;
        t.iframeUntil = this.tick + (t.isBot ? 8 : 40);
        this.emit({ k: 'hit', x: t.x, y: t.y, c: this.tankColor(t), tid: t.id });
        if (this.mode.onHit) this.mode.onHit(t, src);
      } else if (t.extraLife) {
        t.extraLife = false;
        t.iframeUntil = this.tick + 60;
        this.emit({ k: 'hit', x: t.x, y: t.y, c: [255, 200, 200], tid: t.id, save: 1 });
      } else {
        this.kill(t, src);
      }
    }

    kill(t, src) {
      t.alive = false;
      t.hp = 0;
      t.deaths++;
      t.vx = t.vy = 0;
      if (src && src !== t) { src.kills++; }
      for (const f of this.flags) if (f.carrier === t) this.dropFlag(f, t.x, t.y);
      this.emit({ k: 'boom', x: t.x, y: t.y, c: this.tankColor(t), n: 50, tid: t.id });
      this.emit({
        k: 'kill', v: t.name, vc: this.tankColor(t), vid: t.id,
        s: src ? src.name : '', sc: src ? this.tankColor(src) : null, sid: src ? src.id : 0
      });
      this.mode.onKill(t, src);
    }

    dropFlag(f, x, y) {
      if (f.carrier) f.carrier.carrying = null;
      f.carrier = null;
      f.x = U.clamp(x, 10, this.map.w - 10);
      f.y = U.clamp(y, 10, this.map.h - 10);
      f.droppedAt = this.tick;
      f.returnStart = 0;
    }

    tankColor(t) {
      if (this.mode.teamColors && TG.TEAM_COLORS[t.team]) return TG.TEAM_COLORS[t.team];
      if (t.pid) { const p = this.players.get(t.pid); if (p) return p.color; }
      return TG.BOT_COLOR;
    }

    emit(e) { e.tk = this.tick; this.events.push(e); }

    // ---------- Бусты ----------
    spawnBoost(region, avoidRects) {
      const spot = TG.findSpot(this.map, { r: 16, region, avoidRects });
      for (const b of this.boosts) if (U.dist2(b.x, b.y, spot.x, spot.y) < 900) return null;
      const b = { id: this.nextBoostId++, x: Math.round(spot.x), y: Math.round(spot.y), type: U.choice(TG.BOOSTS) };
      if (this.nextBoostId > 65000) this.nextBoostId = 1;
      this.boosts.push(b);
      return b;
    }

    applyBoost(t, type) {
      const tk = this.tick;
      switch (type) {
        case 'speed': t.speedUntil = tk + C.BOOST_TIME; break;
        case 'bullet': t.bigUntil = tk + C.BOOST_TIME; break;
        case 'shield': t.shieldUntil = Math.max(t.shieldUntil, tk + C.SHIELD_TIME); break;
        case 'gatling': t.gatlingUntil = tk + C.GATLING_TIME; break;
        case 'mini': t.miniUntil = tk + C.MINI_TIME; t.r = C.MINI_R; break;
        case 'fast_bullet': t.fastUntil = tk + C.FAST_TIME; break;
        case 'health':
          if (t.maxHp > 1 && t.hp < t.maxHp) t.hp++;
          else if (t.maxHp > 1) t.hp = t.maxHp;
          else t.extraLife = true;
          break;
      }
    }

    // ---------- Основной шаг симуляции ----------
    step() {
      this.tick++;
      const tick = this.tick;
      if (this.over) return;
      const map = this.map;
      this.mode.tick();
      if (this.over) return;

      // Игроки: обработка ввода
      for (const p of this.players.values()) {
        const t = p.tank;
        const ox = t ? t.x : 0, oy = t ? t.y : 0;
        p.credits = Math.min(p.credits + 1, 4);
        let n = 0;
        while (p.inputs.length && p.credits >= 1 && n < 3) {
          const inp = p.inputs.shift();
          p.credits--; n++;
          this.applyInput(p, inp);
        }
        if (t) { t.vx = t.vx * 0.5 + (t.x - ox) * 0.5; t.vy = t.vy * 0.5 + (t.y - oy) * 0.5; }
      }

      // Боты
      if (!this.mode.frozen) {
        for (let i = 0; i < this.tanks.length; i++) {
          const t = this.tanks[i];
          if (!t.isBot || !t.alive) continue;
          const ox = t.x, oy = t.y;
          if (t.cd > 0) t.cd--;
          this.mode.botThink(t);
          t.vx = t.x - ox; t.vy = t.y - oy;
        }
      }

      // Статусы танков
      for (const t of this.tanks) {
        if (!t.alive) continue;
        t.speed = t.baseSpeed * (t.speedUntil > tick ? 2 : 1);
        if (t.miniUntil && t.miniUntil <= tick) {
          t.miniUntil = 0; t.r = t.baseR; TG.unstick(t, map);
        }
      }

      this.updateBullets();
      this.pickBoosts();

      // Спавн бустов
      const bi = this.mode.boostInterval;
      if (bi && ++this.boostTimer >= bi) {
        this.boostTimer = 0;
        if (this.boosts.length < (this.mode.maxBoosts || 8)) this.spawnBoost(this.mode.boostRegion, this.mode.boostAvoid);
      }

      this.mode.postTick && this.mode.postTick();
    }

    updateBullets() {
      const map = this.map, bullets = this.bullets;
      // движение
      let w = 0;
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        if (--b.life <= 0) continue;
        TG.stepBullet(b, map);
        bullets[w++] = b;
      }
      bullets.length = w;

      // пуля против пули (только враждебные)
      const n = bullets.length;
      for (let i = 0; i < n; i++) {
        const a = bullets[i];
        if (a.dead) continue;
        for (let j = i + 1; j < n; j++) {
          const b = bullets[j];
          if (b.dead || a.owner === b.owner) continue;
          if (a.team !== 0 && a.team === b.team) continue;
          const dx = a.x - b.x, dy = a.y - b.y;
          if (dx * dx + dy * dy >= 400) continue;
          if (a.big && !b.big) b.dead = true;
          else if (b.big && !a.big) a.dead = true;
          else { a.dead = true; b.dead = true; }
          if (a.dead) break;
        }
      }

      // пуля против танков
      const tanks = this.tanks;
      for (let i = 0; i < n; i++) {
        const b = bullets[i];
        if (b.dead) continue;
        for (let k = 0; k < tanks.length; k++) {
          const t = tanks[k];
          if (!t.alive || t.id === b.owner) continue;
          if (b.team !== 0 && b.team === t.team) continue;
          const rr = t.r + b.size;
          const dx = b.x - t.x, dy = b.y - t.y;
          if (dx * dx + dy * dy >= rr * rr) continue;
          b.dead = true;
          if (!this.isInvincible(t)) this.damage(t, this.tankMap.get(b.owner) || null);
          break;
        }
      }

      w = 0;
      for (let i = 0; i < bullets.length; i++) if (!bullets[i].dead) bullets[w++] = bullets[i];
      bullets.length = w;
    }

    pickBoosts() {
      if (!this.boosts.length) return;
      for (const t of this.tanks) {
        if (!t.alive || t.noBoosts) continue;
        for (let i = this.boosts.length - 1; i >= 0; i--) {
          const b = this.boosts[i];
          const rr = t.r + 15;
          if (U.dist2(t.x, t.y, b.x, b.y) < rr * rr) {
            this.applyBoost(t, b.type);
            this.boosts.splice(i, 1);
            this.emit({ k: 'pick', x: b.x, y: b.y, b: b.type, tid: t.id });
          }
        }
      }
    }

    finish(result) {
      if (this.over) return;
      this.over = true;
      this.result = result;
      result.board = this.scoreboard();
      this.emit({ k: 'over' });
    }

    scoreboard() {
      const rows = [];
      for (const t of this.tanks) {
        if (t.isBot && !this.mode.botsOnBoard) continue;
        const p = t.pid ? this.players.get(t.pid) : null;
        rows.push({ id: t.id, pid: t.pid, name: t.name, c: this.tankColor(t), team: t.team, k: t.kills, d: t.deaths, s: t.score, lvl: t.level, bot: t.isBot ? 1 : 0, off: p && !p.connected ? 1 : 0 });
      }
      rows.sort((a, b) => (b.s - a.s) || (b.k - a.k) || (a.d - b.d));
      return rows;
    }

    // ---------- Снапшот (для сети и локального рендера) ----------
    snapshot(pid, cull) {
      const tick = this.tick;
      const p = pid != null ? this.players.get(pid) : null;
      const me = p && p.tank ? p.tank : null;
      const tanks = [];
      const cullT = cull && me && me.alive;
      for (const t of this.tanks) {
        // на больших картах далёких ботов противника не отправляем (экономия трафика)
        if (cullT && t.isBot && !t.carrying && (t.team === 0 || t.team !== me.team) && (Math.abs(t.x - me.x) > 1500 || Math.abs(t.y - me.y) > 1100)) continue;
        let f = 0;
        if (t.alive) f |= 1;
        if (t.shieldUntil > tick || (!t.isBot && this.admin && this.admin.god_mode)) f |= 2;
        if (t.iframeUntil > tick) f |= 4;
        if (t.extraLife) f |= 8;
        if (t.speedUntil > tick) f |= 16;
        if (t.bigUntil > tick) f |= 32;
        if (t.gatlingUntil > tick) f |= 64;
        if (t.fastUntil > tick) f |= 128;
        if (t.miniUntil > tick) f |= 256;
        if (t.carrying) f |= 512;
        tanks.push({ id: t.id, pid: t.pid, x: t.x, y: t.y, a: t.a, r: t.r, hp: t.hp, maxHp: t.maxHp, lvl: t.lvl, team: t.team, f });
      }
      const bullets = [];
      const cx = me ? me.x : 0, cy = me ? me.y : 0;
      const useCull = cull && me && me.alive;
      for (const b of this.bullets) {
        if (useCull && b.owner !== me.id && (Math.abs(b.x - cx) > 1500 || Math.abs(b.y - cy) > 1100)) continue;
        bullets.push({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, size: b.size, owner: b.owner });
      }
      const flags = this.flags.map((fl) => ({
        x: fl.x, y: fl.y, team: fl.team, carrier: fl.carrier ? fl.carrier.id : 0,
        home: fl.x === fl.homeX && fl.y === fl.homeY && !fl.carrier ? 1 : 0,
        ret: fl.returnStart ? Math.min(255, Math.floor(((tick - fl.returnStart) / fl.returnTime) * 255)) : 0
      }));
      return {
        tick, ack: p ? p.ackSeq : 0,
        me: me ? { id: me.id, x: me.x, y: me.y, speed: me.speed, r: me.r, cd: me.cd, rate: this.rateOf(me), alive: me.alive ? 1 : 0 } : null,
        tanks, bullets, boosts: this.boosts.map((b) => ({ id: b.id, x: b.x, y: b.y, type: TG.BOOSTS.indexOf(b.type) })), flags
      };
    }

    roundInfo() {
      return {
        mode: this.modeId, options: this.options, w: this.map.w, h: this.map.h,
        obstacles: this.map.obstacles, bases: this.map.bases, teamColors: !!this.mode.teamColors,
        title: this.mode.title(), tick: this.tick, big: this.map.w > 1300 || this.map.h > 1000
      };
    }
  }

  TG.World = World;
  TG.MODES = TG.MODES || {};
})(typeof globalThis !== 'undefined' ? (globalThis.TG = globalThis.TG || {}) : (self.TG = self.TG || {}));
