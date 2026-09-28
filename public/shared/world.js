/* Tank Battle Online — мир симуляции (авторитетный на сервере, локальный в одиночной игре). */
(function (TG) {
  'use strict';
  const C = TG.C, U = TG.U;

  const HIST = 32; // длина истории позиций (тики)

  // Флаги танка в снапшоте
  const F = TG.TF = {
    alive: 1, shield: 2, iframe: 4, extra: 8, speed: 16, big: 32, rapid: 64, triple: 128,
    homing: 256, flag: 512, damage: 1024, invis: 2048, stun: 4096
  };

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
      this.dyn = [];
      this.dynRev = 0;
      this.dynStructRev = 0;
      this.nextDynId = 1;
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
        pending: 0, upOpts: [], joinTick: this.tick, respawnAt: 0, rewind: 0
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
        x: o.x, y: o.y, a: o.a || 0, r: o.r || C.TANK_R, baseR: o.r || C.TANK_R,
        baseSpeed: o.speed == null ? 3 : o.speed, speed: o.speed == null ? 3 : o.speed,
        hp: o.hp || 1, maxHp: o.maxHp || o.hp || 1, team: o.team || 0, kind: o.kind || 0,
        alive: true, respawnAt: 0, cd: o.cd == null ? 30 : o.cd, rate: o.rate || C.PLAYER_RATE,
        bs: o.bs || C.BULLET_SPEED, bsize: o.bsize || 1,
        extraLife: false, shieldUntil: 0, iframeUntil: 0, speedUntil: 0, bigUntil: 0, rapidUntil: 0,
        tripleUntil: 0, homingUntil: 0, damageUntil: 0, invisUntil: 0, stunUntil: 0,
        bulletSpeedMod: 1, sizeMult: 1, reloadMult: 1, dmgBonus: 0, multi: 0, regen: 0, regenT: 0,
        vx: 0, vy: 0, kills: 0, deaths: 0, score: 0, ai: {}, noBoosts: !!o.noBoosts,
        carrying: null, xp: 0, level: 1, coins: 0, blocks: 0, bw: {}, streak: 0, multiKill: 0, lastKill: -9999,
        sk: o.sk || null, kd: o.kind ? TG.BOT_KINDS[o.kind] : null, shots: 0, hblocks: 0, bombs: 0,
        hs: this.tick, hx: new Float32Array(HIST), hy: new Float32Array(HIST)
      };
      if (!t.isBot && this.admin) {
        t.baseSpeed = t.speed = +this.admin.player_speed || 3;
        t.bulletSpeedMod = +this.admin.bullet_speed || 1;
      }
      this.tanks.push(t);
      this.tankMap.set(t.id, t);
      return t;
    }

    // Бот определённого типа из кампании (kind — ключ или номер)
    createBot(kind, pos, team, extra) {
      const id = typeof kind === 'string' ? TG.KIND[kind] : kind;
      const k = TG.BOT_KINDS[id];
      extra = extra || {};
      const hp = Math.max(1, Math.round(k.hp * (extra.hpMul || 1)));
      return this.createTank({
        x: pos.x, y: pos.y, team, kind: id, name: extra.name || k.name, speed: k.speed, hp, maxHp: hp, r: k.r,
        rate: k.rate, bs: k.bs, bsize: k.bsize || 1, sk: k.sk, cd: extra.cd == null ? k.rate + 40 + U.randInt(0, 40) : extra.cd,
        noBoosts: !!(k.god || k.turret)
      });
    }

    // Бот для командных режимов с профилем сложности
    createTacticalBot(pos, team, diff, hp, name) {
      const D = TG.DIFF[diff] || TG.DIFF[2];
      return this.createTank({ x: pos.x, y: pos.y, team, hp, maxHp: hp, rate: D.rate, sk: D.sk, cd: 60, name });
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
        p.tank = this.createTank({ pid: p.id, name: p.name, x: pos.x, y: pos.y, hp: o.hp || 3, maxHp: o.maxHp || o.hp || 3, team: p.team, cd: 20 });
      } else {
        this.revive(p.tank, pos, o.shield || 0);
        if (o.hp) { p.tank.maxHp = Math.max(p.tank.maxHp, o.maxHp || o.hp); p.tank.hp = p.tank.maxHp; }
      }
      p.tank.team = p.team;
      if (o.shield) p.tank.shieldUntil = this.tick + o.shield;
      TG.unstick(p.tank, this.map);
      return p.tank;
    }

    revive(t, pos, shield) {
      t.x = pos.x; t.y = pos.y; t.alive = true; t.hp = t.maxHp; t.r = t.baseR;
      t.speedUntil = t.bigUntil = t.rapidUntil = t.tripleUntil = t.homingUntil = t.damageUntil = t.invisUntil = t.stunUntil = 0;
      t.iframeUntil = 0; t.shieldUntil = shield ? this.tick + shield : 0;
      t.extraLife = false; t.cd = 20; t.vx = t.vy = 0; t.carrying = null; t.speed = t.baseSpeed;
      t.streak = 0;
      t.hs = this.tick;
      if (t.isBot) { t.ai = {}; t.shots = 0; }
      TG.unstick(t, this.map);
    }

    isInvincible(t) {
      if (!t.isBot && this.admin && this.admin.god_mode) return true;
      return t.shieldUntil > this.tick || t.iframeUntil > this.tick;
    }

    isHostile(a, b) { return a !== b && (a.team === 0 || b.team === 0 || a.team !== b.team); }

    rateOf(t) {
      let r;
      if (t.isBot) r = Math.max(3, Math.round(t.rate * t.reloadMult));
      else {
        r = this.admin ? TG.msToTicks(+this.admin.fire_rate || 470) : C.PLAYER_RATE;
        r = Math.max(3, Math.round(r * t.reloadMult));
      }
      if (t.rapidUntil > this.tick) r = Math.min(r, C.RAPID_RATE);
      return r;
    }

    bulletSpeed(t) { return t.isBot ? t.bs * t.bulletSpeedMod : C.BULLET_SPEED * t.bulletSpeedMod; }

    fire(t, seq, angleOverride) {
      if (this.bullets.length >= C.MAX_BULLETS) return false;
      t.cd = this.rateOf(t);
      const big = t.bigUntil > this.tick;
      const size = C.BULLET_SIZE * t.sizeMult * t.bsize * (big ? 2 : 1);
      const spd = this.bulletSpeed(t);
      const dmg = (1 + (t.dmgBonus || 0)) * (t.damageUntil > this.tick ? 2 : 1);
      const homing = t.homingUntil > this.tick;
      const base = angleOverride == null ? t.a : angleOverride;
      let n = 1, step = 0;
      const extra = (t.multi || 0) + (t.tripleUntil > this.tick ? 1 : 0);
      if (extra > 0) { n = Math.min(7, 1 + 2 * extra); step = 0.2; }
      if (t.kd && t.kd.spread && t.kd.spread.n > n) { n = t.kd.spread.n; step = t.kd.spread.a; }
      let ok = false;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * step;
        if (this.spawnBullet(t, a, spd, size, dmg, homing, seq)) ok = true;
      }
      return ok;
    }

    spawnBullet(t, a, spd, size, dmg, homing, seq) {
      if (this.bullets.length >= C.MAX_BULLETS) return false;
      const cos = Math.cos(a), sin = Math.sin(a);
      let bx = t.x + cos * (t.r + 4), by = t.y + sin * (t.r + 4);
      if (TG.bulletBlocked(bx, by, size, this.map) || !TG.lineOfSight(this.map, t.x, t.y, bx, by, 0)) {
        bx = t.x; by = t.y;
        const hit = TG.bulletBlocked(bx, by, size, this.map);
        if (hit) {
          // выстрел вплотную в разрушаемый блок — сразу наносим урон
          if (hit !== true && hit.dyn) this.hitDyn(hit, dmg, t);
          return false;
        }
      }
      const id = this.nextBulletId++;
      if (this.nextBulletId > 65000) this.nextBulletId = 1;
      this.bullets.push({
        id, x: bx, y: by, vx: cos * spd, vy: sin * spd, size, owner: t.id, team: t.team,
        big: size > 9, dmg, homing, life: C.BULLET_LIFE, seq: seq || 0, nc: !!(t.kd && t.kd.boss),
        rw: t.pid ? ((this.players.get(t.pid) || {}).rewind | 0) : 0
      });
      return true;
    }

    applyInput(p, inp) {
      const t = p.tank;
      p.ackSeq = inp.seq;
      const act = inp.up | 0;
      if (act >= 1 && act <= 3) this.chooseUpgrade(p, act - 1);
      if (!t || !t.alive || this.over || this.mode.frozen) return;
      if (act === 4) this.placeBlock(t);
      else if (act === 5) this.placeBomb(t);
      else if (act >= 16 && act < 48 && this.mode.buy) this.mode.buy(t, act - 16);
      if (t.stunUntil > this.tick) return;
      t.a = inp.a;
      TG.moveTank(t, inp.mx, inp.my, this.map);
      if (t.cd > 0) t.cd--;
      if (inp.fire && t.cd <= 0) this.fire(t, inp.seq);
    }

    chooseUpgrade(p, idx) {
      if (this.mode.chooseUpgrade) this.mode.chooseUpgrade(p, idx);
    }

    // ---------- Урон ----------
    damage(t, src, dmg) {
      if (!t.alive) return;
      dmg = dmg || 1;
      if (t.hp > dmg) {
        t.hp -= dmg;
        t.iframeUntil = this.tick + (t.isBot ? 6 : 45);
        this.emit({ k: 'hit', x: t.x, y: t.y, c: this.tankColor(t), tid: t.id, d: dmg, sid: src ? src.id || 0 : 0 });
        if (this.mode.onHit) this.mode.onHit(t, src);
      } else if (t.extraLife) {
        t.extraLife = false;
        t.hp = 1;
        t.iframeUntil = this.tick + 60;
        this.emit({ k: 'hit', x: t.x, y: t.y, c: [255, 200, 200], tid: t.id, save: 1, d: dmg });
      } else {
        this.kill(t, src);
      }
    }

    kill(t, src) {
      t.alive = false;
      t.hp = 0;
      t.deaths++;
      t.vx = t.vy = 0;
      t.streak = 0;
      if (src && src.id && src !== t) {
        src.kills++;
        src.streak++;
        src.multiKill = this.tick - src.lastKill < 300 ? src.multiKill + 1 : 1;
        src.lastKill = this.tick;
        if (src.pid && src.multiKill >= 2) this.emit({ k: 'streak', tid: src.id, n: src.multiKill });
        else if (src.pid && src.streak >= 5 && src.streak % 5 === 0) this.emit({ k: 'streak', tid: src.id, s: src.streak });
      }
      for (const f of this.flags) if (f.carrier === t) this.dropFlag(f, t.x, t.y);
      const big = t.kd && t.kd.boss;
      this.emit({ k: 'boom', x: t.x, y: t.y, c: this.tankColor(t), n: big ? 120 : 50, tid: t.id, big: big ? 1 : 0 });
      const killer = src && src.id ? src : null;
      this.emit({
        k: 'kill', v: t.name, vc: this.tankColor(t), vid: t.id,
        s: killer ? killer.name : '', sc: killer ? this.tankColor(killer) : null, sid: killer ? killer.id : 0
      });
      this.mode.onKill(t, killer);
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
      if (t.kd) return t.kd.c;
      return TG.BOT_COLOR;
    }

    emit(e) { e.tk = this.tick; this.events.push(e); }

    // ---------- Разрушаемые препятствия (блоки, ядра) ----------
    addDyn(o) {
      o.id = this.nextDynId++;
      o.dyn = 1;
      this.map.obstacles.push(o);
      this.dyn.push(o);
      this.dynChanged(o, true);
      return o;
    }

    removeDyn(o) {
      let i = this.map.obstacles.indexOf(o);
      if (i >= 0) this.map.obstacles.splice(i, 1);
      i = this.dyn.indexOf(o);
      if (i >= 0) this.dyn.splice(i, 1);
      o.dead = true;
      this.dynChanged(o, true);
    }

    dynChanged(o, structural) {
      this.dynRev++;
      if (structural) {
        this.dynStructRev++;
        if (this.nav) this.nav.update(o);
      }
    }

    hitDyn(o, dmg, src) {
      if (o.dead) return;
      if (src && o.team && src.team === o.team) return; // свои блоки не ломаются
      o.hp -= dmg;
      if (o.hp <= 0) {
        this.removeDyn(o);
        this.emit({ k: 'break', x: o.x + o.w / 2, y: o.y + o.h / 2, c: o.team ? TG.TEAM_COLORS[o.team] : [160, 160, 180], core: o.core ? 1 : 0 });
        if (this.mode.onDynDestroyed) this.mode.onDynDestroyed(o, src);
      } else {
        this.dynChanged(o, false);
        if (o.core && this.mode.onCoreHit) this.mode.onCoreHit(o, src);
      }
    }

    // Можно ли поставить блок в клетку rect
    canPlaceRect(r, t) {
      const B = C.BLOCK;
      if (r.x < 0 || r.y < 0 || r.x + B > this.map.w || r.y + B > this.map.h) return false;
      for (const o of this.map.obstacles) if (TG.rectsGap(r, o, -0.5)) return false;
      for (const k of this.tanks) if (k.alive && TG.circleRect(k.x, k.y, k.r + 2, r)) return false;
      for (const b of this.boosts) if (b.type === 'bomb' && TG.circleRect(b.x, b.y, 12, r)) return false;
      if (this.mode.canPlace && !this.mode.canPlace(r, t)) return false;
      return true;
    }

    // Поставить блок перед танком (сначала обычный, если их нет — бронеблок)
    placeBlock(t, angle) {
      if (!this.mode.allowBlocks || (t.blocks <= 0 && t.hblocks <= 0)) return false;
      const B = C.BLOCK;
      const a = angle == null ? t.a : angle;
      // пробуем клетки по направлению прицела: ближняя занята — ставим чуть дальше
      for (const dist of [t.r + 28, t.r + 44, t.r + 62]) {
        const tx = t.x + Math.cos(a) * dist, ty = t.y + Math.sin(a) * dist;
        const r = { x: Math.floor(tx / B) * B, y: Math.floor(ty / B) * B, w: B, h: B };
        if (this.canPlaceRect(r, t)) return this.placeBlockAt(t, r);
      }
      return false;
    }

    placeBlockAt(t, r) {
      if (!this.mode.allowBlocks || !this.canPlaceRect(r, t)) return false;
      let hp;
      if (t.blocks > 0) { t.blocks--; hp = 4; } else if (t.hblocks > 0) { t.hblocks--; hp = 12; } else return false;
      this.addDyn({ x: r.x, y: r.y, w: r.w, h: r.h, hp, maxHp: hp, team: t.team });
      this.emit({ k: 'place', x: r.x + r.w / 2, y: r.y + r.h / 2, tid: t.id });
      return true;
    }

    // Бомба (Бедварс): взрывается через TG.BOMB_TIME тиков
    placeBomb(t) {
      if (!this.mode.allowBlocks || t.bombs <= 0) return false;
      const x = U.clamp(t.x + Math.cos(t.a) * (t.r + 14), 12, this.map.w - 12);
      const y = U.clamp(t.y + Math.sin(t.a) * (t.r + 14), 12, this.map.h - 12);
      t.bombs--;
      const b = this.addBoost(x, y, 'bomb');
      b.team = t.team; b.owner = t.id; b.at = this.tick + TG.BOMB_TIME;
      this.emit({ k: 'place', x, y, tid: t.id, bomb: 1 });
      return true;
    }

    updateBombs() {
      for (let i = this.boosts.length - 1; i >= 0; i--) {
        const b = this.boosts[i];
        if (b.type !== 'bomb' || this.tick < b.at) continue;
        this.boosts.splice(i, 1);
        const R = TG.BOMB_RADIUS, src = this.tankMap.get(b.owner) || { team: b.team };
        for (const o of this.dyn.slice()) {
          if (o.team === b.team) continue;
          if (!TG.circleRect(b.x, b.y, R, o)) continue;
          this.hitDyn(o, o.core ? 8 : 12, src);
        }
        for (const t of this.tanks) {
          if (!t.alive || t.team === b.team || this.isInvincible(t)) continue;
          if (U.dist2(t.x, t.y, b.x, b.y) < (R + t.r) * (R + t.r)) this.damage(t, src.id ? src : null, 2);
        }
        this.emit({ k: 'boom', x: b.x, y: b.y, c: [255, 170, 60], n: 80, big: 1, bomb: 1 });
      }
    }

    dynList() {
      const out = [];
      for (const o of this.dyn) out.push(o.id, o.x, o.y, o.w, o.h, Math.max(0, Math.ceil(o.hp)), o.maxHp, o.team || 0, o.core ? 1 : 0);
      return out;
    }

    // ---------- Бусты и предметы ----------
    randomBoostType() {
      const pool = this.mode.boostPool || TG.BOOSTS;
      return U.weighted(pool, (k) => TG.BOOST_INFO[k].w);
    }

    spawnBoost(region, avoidRects, type) {
      const spot = TG.findSpot(this.map, { r: 16, region, avoidRects });
      for (const b of this.boosts) if (U.dist2(b.x, b.y, spot.x, spot.y) < 900) return null;
      return this.addBoost(spot.x, spot.y, type || this.randomBoostType());
    }

    addBoost(x, y, type) {
      const b = { id: this.nextBoostId++, x: Math.round(x), y: Math.round(y), type };
      if (this.nextBoostId > 65000) this.nextBoostId = 1;
      this.boosts.push(b);
      return b;
    }

    applyBoost(t, type) {
      const tk = this.tick;
      const info = TG.BOOST_INFO[type];
      switch (type) {
        case 'speed': t.speedUntil = tk + info.dur; break;
        case 'shield': t.shieldUntil = Math.max(t.shieldUntil, tk + info.dur); break;
        case 'rapid': t.rapidUntil = tk + info.dur; break;
        case 'big': t.bigUntil = tk + info.dur; break;
        case 'triple': t.tripleUntil = tk + info.dur; break;
        case 'homing': t.homingUntil = tk + info.dur; break;
        case 'damage': t.damageUntil = tk + info.dur; break;
        case 'invis': t.invisUntil = tk + info.dur; break;
        case 'emp': this.emp(t); break;
        case 'health':
          if (t.hp < t.maxHp) t.hp++;
          else t.extraLife = true;
          break;
      }
    }

    emp(src) {
      const R2 = 290 * 290;
      for (const t of this.tanks) {
        if (!t.alive || !this.isHostile(src, t)) continue;
        if (U.dist2(t.x, t.y, src.x, src.y) > R2) continue;
        if (t.shieldUntil > this.tick) continue;
        t.stunUntil = this.tick + 90;
      }
      for (const b of this.bullets) {
        if (b.team !== 0 && b.team === src.team) continue;
        if (b.owner === src.id) continue;
        if (U.dist2(b.x, b.y, src.x, src.y) < R2) b.dead = true;
      }
      this.emit({ k: 'emp', x: src.x, y: src.y, tid: src.id });
    }

    // ---------- Основной шаг симуляции ----------
    step() {
      this.tick++;
      const tick = this.tick;
      if (this.over) return;
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
          if (t.stunUntil > tick) { t.vx = t.vy = 0; continue; }
          this.mode.botThink(t);
          t.vx = t.vx * 0.4 + (t.x - ox) * 0.6; t.vy = t.vy * 0.4 + (t.y - oy) * 0.6;
        }
      }

      // Статусы танков
      for (const t of this.tanks) {
        if (!t.alive) continue;
        t.speed = t.baseSpeed * (t.speedUntil > tick ? 1.7 : 1);
        if (t.regen && t.hp < t.maxHp) {
          if (++t.regenT >= Math.round(540 / t.regen)) { t.hp++; t.regenT = 0; }
        } else t.regenT = 0;
      }

      // история позиций — для компенсации пинга (сервер «отматывает» цели на задержку стрелка)
      const hi = tick % HIST;
      for (const t of this.tanks) { t.hx[hi] = t.x; t.hy[hi] = t.y; }

      this.updateBullets();
      if (this.mode.allowBlocks) this.updateBombs();
      this.pickBoosts();

      // Спавн бустов
      const bi = this.mode.boostInterval;
      if (bi && ++this.boostTimer >= bi) {
        this.boostTimer = 0;
        let nb = 0;
        for (const b of this.boosts) if (TG.BOOST_INFO[b.type]) nb++;
        if (nb < (this.mode.maxBoosts || 8)) this.spawnBoost(this.mode.boostRegion, this.mode.boostAvoid);
      }

      if (this.mode.postTick) this.mode.postTick();
    }

    homingTarget(b) {
      let best = null, bd = 380 * 380;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      for (const t of this.tanks) {
        if (!t.alive || t.id === b.owner) continue;
        if (b.team !== 0 && b.team === t.team) continue;
        if (t.invisUntil > this.tick) continue;
        const dx = t.x - b.x, dy = t.y - b.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= bd) continue;
        if ((dx * b.vx + dy * b.vy) / (Math.sqrt(d2) * sp + 1e-6) < 0.25) continue;
        bd = d2; best = t;
      }
      return best;
    }

    updateBullets() {
      const map = this.map, bullets = this.bullets;
      // движение
      let w = 0;
      for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        if (b.dead || --b.life <= 0) continue;
        if (b.homing) {
          const tg = this.homingTarget(b);
          if (tg) {
            const sp = Math.hypot(b.vx, b.vy);
            const cur = Math.atan2(b.vy, b.vx);
            const want = Math.atan2(tg.y - b.y, tg.x - b.x);
            const na = cur + U.clamp(U.angDiff(want, cur), -0.06, 0.06);
            b.vx = Math.cos(na) * sp; b.vy = Math.sin(na) * sp;
          }
        }
        TG.stepBullet(b, map);
        if (b.hitObs) {
          const src = this.tankMap.get(b.owner);
          this.hitDyn(b.hitObs, b.dmg, src || { team: b.team });
          continue;
        }
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
          if (b.dead || a.owner === b.owner || a.nc || b.nc) continue;
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
          let px = t.x, py = t.y;
          if (b.rw) {
            // позиция цели, какой её видел стрелок (с учётом его пинга и задержки интерполяции)
            const pt = this.tick - b.rw;
            if (pt >= t.hs && pt > this.tick - HIST) { px = t.hx[pt % HIST]; py = t.hy[pt % HIST]; }
          }
          const dx = b.x - px, dy = b.y - py;
          if (dx * dx + dy * dy >= rr * rr) continue;
          b.dead = true;
          if (!this.isInvincible(t)) this.damage(t, this.tankMap.get(b.owner) || null, b.dmg || 1);
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
        if (!t.alive) continue;
        for (let i = this.boosts.length - 1; i >= 0; i--) {
          const b = this.boosts[i];
          if (b.type === 'bomb') continue;
          const item = TG.ITEMS[b.type];
          if (!item && t.noBoosts) continue;
          if (item && t.kd && t.kd.turret) continue;
          const rr = t.r + (item ? 18 : 15);
          if (U.dist2(t.x, t.y, b.x, b.y) >= rr * rr) continue;
          this.boosts.splice(i, 1);
          if (item) {
            t.coins += item.v;
            this.emit({ k: 'coin', x: b.x, y: b.y, tid: t.id, v: item.v });
          } else {
            this.applyBoost(t, b.type);
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
        if (t.isBot && (!this.mode.botsOnBoard || (t.kd && t.kd.turret))) continue;
        const p = t.pid ? this.players.get(t.pid) : null;
        rows.push({ id: t.id, pid: t.pid, name: t.name, c: this.tankColor(t), team: t.team, k: t.kills, d: t.deaths, s: t.score, lvl: t.level, bot: t.isBot ? 1 : 0, off: p && !p.connected ? 1 : 0 });
      }
      rows.sort((a, b) => (b.s - a.s) || (b.k - a.k) || (a.d - b.d));
      return rows;
    }

    // ---------- Снапшот (для сети и локального рендера) ----------
    tankFlags(t) {
      const tick = this.tick;
      let f = 0;
      if (t.alive) f |= F.alive;
      if (t.shieldUntil > tick || (!t.isBot && this.admin && this.admin.god_mode)) f |= F.shield;
      if (t.iframeUntil > tick) f |= F.iframe;
      if (t.extraLife) f |= F.extra;
      if (t.speedUntil > tick) f |= F.speed;
      if (t.bigUntil > tick) f |= F.big;
      if (t.rapidUntil > tick) f |= F.rapid;
      if (t.tripleUntil > tick) f |= F.triple;
      if (t.homingUntil > tick) f |= F.homing;
      if (t.carrying) f |= F.flag;
      if (t.damageUntil > tick) f |= F.damage;
      if (t.invisUntil > tick) f |= F.invis;
      if (t.stunUntil > tick) f |= F.stun;
      return f;
    }

    snapshot(pid, cull) {
      const tick = this.tick;
      const p = pid != null ? this.players.get(pid) : null;
      const me = p && p.tank ? p.tank : null;
      const tanks = [];
      const cullT = cull && me && me.alive;
      for (const t of this.tanks) {
        // на больших картах далёких ботов противника не отправляем (экономия трафика)
        if (cullT && t.isBot && !t.carrying && !(t.kd && t.kd.boss) && (t.team === 0 || t.team !== me.team) && (Math.abs(t.x - me.x) > 1500 || Math.abs(t.y - me.y) > 1100)) continue;
        tanks.push({ id: t.id, pid: t.pid, x: t.x, y: t.y, a: t.a, r: t.r, hp: t.hp, maxHp: t.maxHp, lvl: t.kind, team: t.team, f: this.tankFlags(t) });
      }
      const bullets = [];
      const cx = me ? me.x : 0, cy = me ? me.y : 0;
      for (const b of this.bullets) {
        if (cullT && b.owner !== me.id && (Math.abs(b.x - cx) > 1500 || Math.abs(b.y - cy) > 1100)) continue;
        bullets.push({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, size: b.size, owner: b.owner, fl: (b.big ? 1 : 0) | (b.homing ? 2 : 0) | (b.dmg > 1 ? 4 : 0) });
      }
      const flags = this.flags.map((fl) => ({
        x: fl.x, y: fl.y, team: fl.team, carrier: fl.carrier ? fl.carrier.id : 0,
        home: fl.x === fl.homeX && fl.y === fl.homeY && !fl.carrier ? 1 : 0,
        ret: fl.returnStart ? Math.min(255, Math.floor(((tick - fl.returnStart) / fl.returnTime) * 255)) : 0
      }));
      const boosts = [];
      for (const b of this.boosts) {
        const item = TG.ITEMS[b.type];
        boosts.push({ id: b.id, x: b.x, y: b.y, type: b.type === 'bomb' ? TG.BOMB_ID : item ? item.id : TG.BOOSTS.indexOf(b.type) });
      }
      return {
        tick, ack: p ? p.ackSeq : 0,
        me: me ? { id: me.id, x: me.x, y: me.y, speed: me.speed, r: me.r, cd: me.cd, rate: this.rateOf(me), alive: (me.alive ? 1 : 0) | (me.stunUntil > tick ? 2 : 0) } : null,
        tanks, bullets, boosts, flags
      };
    }

    roundInfo() {
      return {
        mode: this.modeId, options: this.options, w: this.map.w, h: this.map.h,
        obstacles: this.map.obstacles.filter((o) => !o.dyn), bases: this.map.bases, teamColors: !!this.mode.teamColors,
        title: this.mode.title(), tick: this.tick, big: this.map.w > 1300 || this.map.h > 1000,
        dyn: this.dynList(), dynRev: this.dynRev, pads: this.map.pads || null
      };
    }
  }

  TG.World = World;
  TG.MODES = TG.MODES || {};
})(typeof globalThis !== 'undefined' ? (globalThis.TG = globalThis.TG || {}) : (self.TG = self.TG || {}));
