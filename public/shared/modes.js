/* Tank Battle Online — игровые режимы. Все режимы поддерживают одиночную игру и мультиплеер. */
(function (TG) {
  'use strict';
  const C = TG.C, U = TG.U;
  const BOT_NAMES = ['Альфа', 'Браво', 'Чарли', 'Дельта', 'Эхо', 'Фокс', 'Гольф', 'Хантер', 'Индиго', 'Джет', 'Кило', 'Лима', 'Майк', 'Нова', 'Оскар', 'Папа', 'Ромео', 'Сьерра', 'Танго', 'Виктор', 'Ураган', 'Вектор', 'Гром', 'Шторм'];
  const fmtTime = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  function campaignSize(n) {
    if (n <= 2) return [1000, 720];
    if (n <= 4) return [1200, 860];
    return [1400, 1000];
  }

  function styledObstacles(style, W, H) {
    const ratio = (W * H) / (1000 * 720);
    switch (style) {
      case 'open': return TG.genObstacles(W, H, { count: Math.round(U.randInt(3, 5) * ratio), gap: 70, margin: 70 });
      case 'maze': return TG.genObstacles(W, H, { count: Math.round(U.randInt(13, 17) * ratio), minW: 45, maxW: 150, minH: 40, maxH: 90, gap: 55, margin: 45 });
      case 'fort': return TG.genSymmetric(W, H, { count: U.randInt(2, 3), minW: 60, maxW: 150, minH: 40, maxH: 90, gap: 60, margin: 80 });
      case 'arena': return TG.genSymmetric(W, H, { count: U.randInt(3, 4), minW: 50, maxW: 140, minH: 40, maxH: 90, gap: 60, margin: 70 });
      default: return TG.genObstacles(W, H, { count: Math.round(U.randInt(6, 9) * ratio), gap: 55, margin: 55 });
    }
  }

  class BaseMode {
    constructor(world, opts) {
      this.w = world;
      this.o = opts;
      this.frozen = false;
      this.teamColors = false;
      this.botsOnBoard = false;
      this.boostInterval = C.BOOST_INTERVAL;
      this.maxBoosts = 8;
      this.boostRegion = null;
      this.boostAvoid = null;
      this.startTick = 0;
      this.allowBlocks = false;
    }
    humans() { return Array.from(this.w.players.values()); }
    aliveHumans() { let n = 0; for (const p of this.w.players.values()) if (p.tank && p.tank.alive) n++; return n; }
    humanPositions() { const r = []; for (const p of this.w.players.values()) if (p.tank && p.tank.alive) r.push(p.tank); return r; }
    aliveBots() { let n = 0; for (const t of this.w.tanks) if (t.isBot && t.alive && !(t.kd && t.kd.turret)) n++; return n; }
    cleanupDeadBots() {
      const w = this.w;
      for (let i = w.tanks.length - 1; i >= 0; i--) {
        const t = w.tanks[i];
        if (t.isBot && !t.alive) { w.tanks.splice(i, 1); w.tankMap.delete(t.id); }
      }
    }
    spotFar(r, minDist, far, region) {
      return TG.findSpot(this.w.map, { r, far: far || this.humanPositions(), minDist, avoidTanks: this.w.tanks, region });
    }
    onJoin() {}
    onLeave() {}
    tick() {}
    postTick() {}
    onKill() {}
    onHit(t, src) { TG.AI.alert(t, src, this.w.tick); }
    botThink(t) { TG.AI.brain(this.w, t, null); }
    hud() { return {}; }
    personal() { return null; }
    title() { return ''; }
    // Кооперативное возрождение: если жив хотя бы один союзник
    coopRespawn(delay) {
      const w = this.w;
      const alive = this.humanPositions();
      if (!alive.length) return;
      for (const p of w.players.values()) {
        if (!p.tank || p.tank.alive || !p.respawnAt || w.tick < p.respawnAt) continue;
        const m = U.choice(alive);
        const pos = TG.findSpot(w.map, { r: 25, region: { x: m.x - 200, y: m.y - 200, w: 400, h: 400 }, avoidTanks: w.tanks });
        w.spawnPlayer(p, pos, { shield: 150 });
        p.respawnAt = 0;
      }
    }
  }

  // ======================================================================
  // КАМПАНИЯ: 30 уровней (кооператив)
  // ======================================================================
  class LevelsMode extends BaseMode {
    constructor(w, o) {
      super(w, o);
      this.level = U.clamp(o.level | 0 || 1, 1, TG.CAMPAIGN.length);
      this.L = TG.CAMPAIGN[this.level - 1];
      this.cd = TG.CAMPAIGN_DIFF[o.cdiff | 0] || TG.CAMPAIGN_DIFF[2];
      this.maxBoosts = 6;
    }
    title() { return `Уровень ${this.level}: ${this.L.n}`; }
    setup() {
      const w = this.w, n = Math.max(1, w.players.size);
      const [W, H] = campaignSize(n);
      w.map = { w: W, h: H, bases: [], obstacles: styledObstacles(this.L.m, W, H) };
      for (const p of w.players.values()) {
        p.team = 1;
        const pos = TG.findSpot(w.map, { r: 25, region: { x: 40, y: H * 0.68, w: W - 80, h: H * 0.32 - 10 }, avoidTanks: w.tanks });
        w.spawnPlayer(p, pos, { hp: Math.max(2, (this.level <= 10 ? 4 : this.level <= 20 ? 5 : 6) + this.cd.hp), shield: 90 });
        p.tank.a = -Math.PI / 2;
      }
      this.scale = 1 + 0.5 * (n - 1);
      this.hpMul = 1 + 0.7 * (n - 1);
      const region = { x: 30, y: 20, w: W - 60, h: H * 0.5 };
      if (this.L.obj === 'survive') {
        this.keep = Math.round(this.L.keep * this.scale);
        for (let i = 0; i < this.keep; i++) this.spawnEnemy(U.choice(this.L.pool), region);
        this.endTick = w.tick + this.L.time * 60;
      } else {
        for (const [kind, cnt] of this.L.e) {
          const k = TG.BOT_KINDS[TG.KIND[kind]];
          const c = k.boss ? cnt : Math.max(1, Math.round(cnt * this.scale));
          for (let i = 0; i < c; i++) this.spawnEnemy(kind, region);
        }
      }
      w.spawnBoost(); w.spawnBoost();
      this.startTick = w.tick;
      this.spawnT = 0;
    }
    spawnEnemy(kind, region) {
      const k = TG.BOT_KINDS[TG.KIND[kind]];
      const pos = this.spotFar(k.r + 6, 420, null, region);
      const t = this.w.createBot(kind, pos, 2, { hpMul: k.boss ? this.hpMul * (this.L.bossHp || 1) : 1 });
      t.a = Math.PI / 2;
      const D = this.cd;
      if (D.aim !== 1 || D.dodge) t.sk = Object.assign({}, t.sk, { aimErr: t.sk.aimErr * D.aim + (D.aim > 1 ? 0.02 : 0), dodge: U.clamp(t.sk.dodge + D.dodge, 0, 1) });
      t.reloadMult = D.rate;
      return t;
    }
    onJoin(p) { p.team = 1; }
    onHit(t, src) {
      super.onHit(t, src);
      // фазы босса: на 75%, 50% и 25% HP босс роняет ремкомплект
      if (t.kd && t.kd.boss) {
        const ph = t.hp <= t.maxHp * 0.25 ? 3 : t.hp <= t.maxHp * 0.5 ? 2 : t.hp <= t.maxHp * 0.75 ? 1 : 0;
        if (ph > (t.ai.phase || 0)) {
          t.ai.phase = ph;
          const a = Math.random() * Math.PI * 2;
          const spot = TG.findSpot(this.w.map, { r: 16, region: { x: t.x + Math.cos(a) * 160 - 90, y: t.y + Math.sin(a) * 160 - 90, w: 180, h: 180 } });
          this.w.addBoost(spot.x, spot.y, ph === 2 ? 'shield' : 'health');
          this.w.emit({ k: 'msg', text: `${t.name}: броня пробита!`, c: t.kd.c });
        }
      }
    }
    onKill(v) {
      if (!v.isBot) { const p = this.w.players.get(v.pid); if (p) p.respawnAt = this.w.tick + 720; }
    }
    tick() {
      const w = this.w;
      if (this.L.obj === 'survive') {
        if (w.tick >= this.endTick && this.aliveHumans() > 0) { this.win(`Вы продержались ${this.L.time} секунд`); return; }
        if (++this.spawnT >= 100 && this.aliveBots() < this.keep) {
          this.spawnT = 0;
          this.spawnEnemy(U.choice(this.L.pool), { x: 20, y: 20, w: w.map.w - 40, h: w.map.h - 40 });
        }
      }
      if (w.players.size > 1) this.coopRespawn();
    }
    win(sub) {
      let best = 0;
      for (const p of this.w.players.values()) if (p.tank && p.tank.alive) best = Math.max(best, p.tank.hp / p.tank.maxHp);
      const stars = best >= 0.99 ? 3 : best >= 0.6 ? 2 : 1;
      this.w.finish({ win: true, title: 'ПОБЕДА!', sub: sub || this.title() + ' пройден', next: this.level < TG.CAMPAIGN.length, stars, level: this.level });
    }
    postTick() {
      const w = this.w;
      this.cleanupDeadBots();
      if (w.over) return;
      if (this.L.obj !== 'survive' && this.aliveBots() === 0) this.win();
      else if (this.aliveHumans() === 0) w.finish({ win: false, title: 'ПОРАЖЕНИЕ', sub: this.title(), level: this.level });
    }
    hud() {
      const w = this.w;
      const h = { t: this.title(), bots: this.aliveBots() };
      if (this.L.obj === 'survive') h.surv = Math.max(0, Math.ceil((this.endTick - w.tick) / 6) / 10);
      if (this.L.tip && w.tick - this.startTick < 480) h.tip = this.L.tip;
      return h;
    }
  }

  // ======================================================================
  // БЕСКОНЕЧНЫЕ ВОЛНЫ (кооператив)
  // ======================================================================
  const WAVE_UNLOCK = { scout: 1, soldier: 1, rusher: 2, sniper: 3, gunner: 4, heavy: 5, medic: 6, elite: 8 };
  class WavesMode extends BaseMode {
    title() { return 'Бесконечные волны'; }
    setup() {
      const w = this.w, n = Math.max(1, w.players.size);
      const [W, H] = campaignSize(n);
      w.map = { w: W, h: H, bases: [], obstacles: styledObstacles('normal', W, H) };
      for (const p of w.players.values()) {
        p.team = 1;
        w.spawnPlayer(p, TG.findSpot(w.map, { r: 25, avoidTanks: w.tanks }), { hp: 3 });
      }
      w.spawnBoost();
      this.wave = 0;
      this.state = 'inter';
      this.timer = 150;
      this.startTick = w.tick;
    }
    onJoin(p) {
      p.team = 1;
      if (this.state === 'inter') this.w.spawnPlayer(p, TG.findSpot(this.w.map, { r: 25, avoidTanks: this.w.tanks }), { hp: 3, shield: 90 });
    }
    spawnWave() {
      const w = this.w;
      this.wave++;
      for (const p of w.players.values()) {
        if (!p.tank || !p.tank.alive) w.spawnPlayer(p, TG.findSpot(w.map, { r: 25, avoidTanks: w.tanks }), { hp: 3, shield: 120 });
        else if (p.tank.hp < p.tank.maxHp) p.tank.hp++;
      }
      const n = Math.max(1, w.players.size);
      let budget = (4 + this.wave * 3) * (1 + 0.55 * (n - 1));
      const hpMul = 1 + Math.max(0, this.wave - 10) * 0.08;
      const list = [];
      if (this.wave % 5 === 0) {
        const bosses = 1 + Math.floor(this.wave / 15);
        for (let i = 0; i < bosses; i++) list.push('boss');
        budget *= 0.45;
      }
      const pool = Object.keys(WAVE_UNLOCK).filter((k) => WAVE_UNLOCK[k] <= this.wave);
      let guard = 0;
      while (budget >= 2 && list.length < 32 && guard++ < 200) {
        const k = U.choice(pool);
        const cost = TG.BOT_KINDS[TG.KIND[k]].cost;
        if (cost > budget) continue;
        budget -= cost;
        list.push(k);
      }
      for (const k of list) {
        const kd = TG.BOT_KINDS[TG.KIND[k]];
        const pos = this.spotFar(kd.r + 6, 400);
        w.createBot(k, pos, 2, { hpMul: kd.boss ? hpMul * (1 + 0.6 * (n - 1)) : hpMul });
      }
      this.state = 'fight';
      w.emit({ k: 'msg', text: this.wave % 5 === 0 ? `ВОЛНА ${this.wave} — БОСС!` : 'ВОЛНА ' + this.wave, c: this.wave % 5 === 0 ? [255, 120, 40] : [0, 200, 255], big: 1 });
    }
    onKill(v, k) {
      if (v.isBot && k && !k.isBot) k.score += v.kd ? v.kd.cost : 1;
    }
    tick() {
      if (this.state === 'inter' && --this.timer <= 0) this.spawnWave();
    }
    postTick() {
      const w = this.w;
      this.cleanupDeadBots();
      if (w.over) return;
      if (this.aliveHumans() === 0 && this.state === 'fight') {
        w.finish({ win: false, title: 'ВАС УНИЧТОЖИЛИ', sub: 'Пройдено волн: ' + (this.wave - 1), score: this.wave - 1 });
        return;
      }
      if (this.state === 'fight' && this.aliveBots() === 0) {
        this.state = 'inter';
        this.timer = 210;
        w.emit({ k: 'msg', text: 'ВОЛНА ' + this.wave + ' ПРОЙДЕНА', c: [0, 255, 120], big: 1 });
      }
    }
    hud() {
      const h = { t: 'Волна ' + Math.max(1, this.wave), bots: this.aliveBots() };
      if (this.state === 'inter') h.next = Math.ceil(this.timer / 60);
      return h;
    }
  }

  // ======================================================================
  // ВЫЖИВАНИЕ (RPG, кооператив)
  // ======================================================================
  const SURV_UNLOCK = { scout: 1, soldier: 1, rusher: 2, sniper: 3, gunner: 4, heavy: 5, medic: 5, elite: 7 };
  class SurvivalMode extends BaseMode {
    title() { return 'Выживание (RPG)'; }
    setup() {
      const w = this.w, n = Math.max(1, w.players.size);
      const S = Math.min(3200, 2000 + 400 * (n - 1));
      w.map = { w: S, h: S, bases: [], obstacles: [] };
      const ratio = (S * S) / 4000000;
      w.map.obstacles = TG.genObstacles(S, S, { count: Math.round(U.randInt(32, 46) * ratio), gap: 55, margin: 50 });
      let first = null;
      for (const p of w.players.values()) {
        p.team = 1;
        const pos = first
          ? TG.findSpot(w.map, { r: 25, region: { x: first.x - 200, y: first.y - 200, w: 400, h: 400 }, avoidTanks: w.tanks })
          : TG.findSpot(w.map, { r: 25, region: { x: S / 2 - 400, y: S / 2 - 400, w: 800, h: 800 } });
        const t = w.spawnPlayer(p, pos, { hp: 3, shield: 120 });
        if (!first) first = t;
      }
      this.maxBoosts = 18 + 4 * (n - 1);
      for (let i = 0; i < Math.round(10 * ratio); i++) w.spawnBoost();
      this.botTarget = 9 + 4 * (n - 1);
      this.startTick = w.tick;
      this.botKills = 0;
      this.nextBoss = w.tick + 3 * 3600;
    }
    onJoin(p) {
      p.team = 1;
      const mate = this.humanPositions()[0];
      const pos = mate
        ? TG.findSpot(this.w.map, { r: 25, region: { x: mate.x - 250, y: mate.y - 250, w: 500, h: 500 }, avoidTanks: this.w.tanks })
        : this.spotFar(25, 0);
      this.w.spawnPlayer(p, pos, { hp: 3, shield: 180 });
    }
    avgLevel() {
      let s = 0, n = 0;
      for (const p of this.w.players.values()) if (p.tank) { s += p.tank.level; n++; }
      return n ? s / n : 1;
    }
    spawnBot(kind) {
      const lvl = this.avgLevel();
      if (!kind) {
        const pool = Object.keys(SURV_UNLOCK).filter((k) => SURV_UNLOCK[k] <= lvl);
        kind = U.weighted(pool, (k) => (k === 'scout' || k === 'soldier' ? 3 : k === 'elite' ? 0.6 : 1.4));
      }
      const kd = TG.BOT_KINDS[TG.KIND[kind]];
      const pos = this.spotFar(kd.r + 6, 650);
      return this.w.createBot(kind, pos, 2, { hpMul: 1 + (lvl - 1) * 0.1 });
    }
    tick() {
      const w = this.w;
      let guard = 0;
      while (this.aliveBots() < this.botTarget && guard++ < 3) this.spawnBot();
      if (w.tick >= this.nextBoss) {
        this.nextBoss = w.tick + 3 * 3600;
        this.spawnBot('boss');
        w.emit({ k: 'msg', text: 'ПРИБЛИЖАЕТСЯ БОСС!', c: [255, 120, 40], big: 1 });
      }
      this.coopRespawn();
    }
    botThink(t) {
      let near = false;
      for (const p of this.w.players.values()) {
        const h = p.tank;
        if (h && h.alive && Math.abs(h.x - t.x) < 1100 && Math.abs(h.y - t.y) < 1100) { near = true; break; }
      }
      if (near || (t.kd && t.kd.boss)) TG.AI.brain(this.w, t, null);
    }
    grantXp(t, amount) {
      t.xp += amount;
      const p = this.w.players.get(t.pid);
      while (t.xp >= t.level * 100) {
        t.xp -= t.level * 100;
        t.level++;
        if (p) {
          p.pending++;
          if (!p.upOpts.length) p.upOpts = this.rollUpgrades(t);
        }
        this.w.emit({ k: 'lvl', tid: t.id, x: t.x, y: t.y, lv: t.level });
      }
    }
    rollUpgrades(t) {
      const keys = Object.keys(TG.UPGRADES).filter((k) => TG.UPGRADES[k].ok(t));
      return U.shuffle(keys).slice(0, 3);
    }
    chooseUpgrade(p, idx) {
      const t = p.tank;
      if (!t || p.pending <= 0) return;
      const key = p.upOpts[idx];
      if (!key) return;
      TG.UPGRADES[key].apply(t);
      p.pending--;
      p.upOpts = p.pending > 0 ? this.rollUpgrades(t) : [];
    }
    onKill(v, k) {
      const w = this.w;
      if (v.isBot) {
        this.botKills++;
        if (k && !k.isBot) {
          const xp = (v.kd ? v.kd.cost : 2) * 12;
          k.score += xp;
          this.grantXp(k, xp);
          for (const p of w.players.values()) if (p.tank && p.tank !== k && p.tank.alive) this.grantXp(p.tank, Math.round(xp * 0.3));
        }
      } else {
        const p = w.players.get(v.pid);
        if (p) p.respawnAt = w.tick + 600;
      }
    }
    postTick() {
      const w = this.w;
      this.cleanupDeadBots();
      if (w.over) return;
      if (w.players.size && this.aliveHumans() === 0) {
        let best = 1;
        for (const p of w.players.values()) if (p.tank) best = Math.max(best, p.tank.level);
        const secs = Math.floor((w.tick - this.startTick) / 60);
        w.finish({ win: false, title: 'ВЫ ПОГИБЛИ', sub: `Уровень ${best} · Уничтожено ботов: ${this.botKills} · Время ${fmtTime(secs)}`, lvl: best });
      }
    }
    hud() {
      const secs = Math.floor((this.w.tick - this.startTick) / 60);
      return { t: 'Выживание', time: secs, bots: this.aliveBots(), kills: this.botKills };
    }
    personal(p) {
      const t = p.tank;
      if (!t) return null;
      const res = { lvl: t.level, xp: t.xp, next: t.level * 100, pend: p.pending, opts: p.upOpts.map((k) => TG.UPGRADES[k].name) };
      if (!t.alive && p.respawnAt) res.resp = Math.max(0, Math.ceil((p.respawnAt - this.w.tick) / 60));
      return res;
    }
  }

  // ======================================================================
  // ЗАХВАТ ФЛАГА (команды)
  // ======================================================================
  class CTFMode extends BaseMode {
    constructor(w, o) {
      super(w, o);
      this.teamColors = true;
      this.botsOnBoard = true;
      this.teamSize = U.clamp(o.teamSize | 0 || 5, 1, 10);
      this.diff = U.clamp(o.diff | 0 || 2, 1, 4);
      this.caps = [1, 3, 5].includes(o.caps | 0) ? o.caps | 0 : 3;
      this.limit = ([5, 10, 15].includes(o.time | 0) ? o.time | 0 : 10) * 3600;
      this.boostInterval = 300;
      this.maxBoosts = 18;
      this.score = { 1: 0, 2: 0 };
    }
    title() { return 'Захват флага'; }
    balanceTeams() {
      const cnt = { 1: 0, 2: 0 };
      for (const p of this.w.players.values()) if (p.team === 1 || p.team === 2) cnt[p.team]++;
      for (const p of this.w.players.values()) {
        if (p.team !== 1 && p.team !== 2) { p.team = cnt[1] <= cnt[2] ? 1 : 2; cnt[p.team]++; }
      }
      return cnt;
    }
    setup() {
      const w = this.w;
      const cnt = this.balanceTeams();
      this.ts = Math.max(this.teamSize, cnt[1], cnt[2]);
      const W = this.ts >= 7 ? 1400 : 1000, H = 2400, BH = 320;
      const bases = [{ x: 0, y: H - BH, w: W, h: BH, team: 1 }, { x: 0, y: 0, w: W, h: BH, team: 2 }];
      w.map = { w: W, h: H, bases, obstacles: [] };
      w.map.obstacles = TG.genPointSymmetric(W, H, {
        count: U.randInt(7, 10), minW: 50, maxW: 150, minH: 40, maxH: 100, gap: 60, margin: 40,
        avoid: [{ x: 0, y: 0, w: W, h: BH + 60 }]
      });
      this.boostRegion = { x: 0, y: BH, w: W, h: H - 2 * BH };
      w.flags = [1, 2].map((team) => {
        const hy = team === 1 ? H - BH / 2 : BH / 2;
        return { team, x: W / 2, y: hy, homeX: W / 2, homeY: hy, carrier: null, returnStart: 0, droppedAt: 0, returnTime: 240 };
      });
      for (const p of w.players.values()) w.spawnPlayer(p, this.basePos(p.team), { hp: 3, maxHp: 3, shield: 120 });
      for (const team of [1, 2]) {
        let have = 0;
        for (const p of w.players.values()) if (p.team === team) have++;
        for (let i = have; i < this.ts; i++) this.addBot(team);
      }
      for (let i = 0; i < 5; i++) w.spawnBoost(this.boostRegion);
      this.startTick = w.tick;
    }
    basePos(team) {
      const b = this.w.map.bases.find((x) => x.team === team);
      return TG.findSpot(this.w.map, { r: 25, region: { x: b.x + 60, y: b.y + 30, w: b.w - 120, h: b.h - 60 }, avoidTanks: this.w.tanks });
    }
    addBot(team) {
      const pos = this.basePos(team);
      const n = this.w.tanks.filter((t) => t.isBot && t.team === team).length;
      const t = this.w.createTacticalBot(pos, team, this.diff, 3, 'Бот ' + BOT_NAMES[(n + (team === 2 ? 12 : 0)) % BOT_NAMES.length]);
      t.role = n % 4 === 3 ? 'def' : 'atk';
      t.lane = [-0.32, 0.32, 0, -0.2, 0.2][n % 5];
      return t;
    }
    onJoin(p) {
      const w = this.w;
      if (p.team !== 1 && p.team !== 2) {
        let c1 = 0, c2 = 0;
        for (const q of w.players.values()) if (q !== p) { if (q.team === 1) c1++; else if (q.team === 2) c2++; }
        p.team = c1 <= c2 ? 1 : 2;
      }
      const bot = w.tanks.find((t) => t.isBot && t.team === p.team && !t.carrying);
      if (bot) w.removeTank(bot);
      w.spawnPlayer(p, this.basePos(p.team), { hp: 3, maxHp: 3, shield: 120 });
    }
    onLeave(p) {
      if (!this.w.over && (p.team === 1 || p.team === 2)) this.addBot(p.team);
    }
    tick() {
      const w = this.w;
      if (w.tick - this.startTick >= this.limit) {
        const a = this.score[1], b = this.score[2];
        if (a === b) w.finish({ draw: true, title: 'НИЧЬЯ', sub: `Время вышло · Счёт ${a} : ${b}` });
        else { const wt = a > b ? 1 : 2; w.finish({ winTeam: wt, title: `ПОБЕДА ${TG.TEAM_ADJ[wt]} КОМАНДЫ!`, sub: `Время вышло · Счёт ${a} : ${b}` }); }
        return;
      }
      for (const t of w.tanks) {
        if (!t.alive && w.tick >= t.respawnAt) w.revive(t, this.basePos(t.team), 120);
      }
      for (const f of w.flags) {
        const atHome = f.x === f.homeX && f.y === f.homeY;
        if (f.carrier || atHome) { f.returnStart = 0; continue; }
        let defender = false;
        for (const t of w.tanks) if (t.alive && t.team === f.team && U.dist2(t.x, t.y, f.x, f.y) < 6400) { defender = true; break; }
        if (defender) {
          if (!f.returnStart) f.returnStart = w.tick;
          else if (w.tick - f.returnStart >= f.returnTime) this.returnFlag(f, 'возвращён защитником');
        } else f.returnStart = 0;
        if (f.droppedAt && w.tick - f.droppedAt > 1800) this.returnFlag(f, 'вернулся на базу');
      }
    }
    returnFlag(f, why) {
      f.x = f.homeX; f.y = f.homeY; f.returnStart = 0; f.droppedAt = 0;
      if (f.carrier) f.carrier.carrying = null;
      f.carrier = null;
      this.w.emit({ k: 'boom', x: f.x, y: f.y, c: [255, 255, 255], n: 30 });
      if (why) this.w.emit({ k: 'msg', text: `Флаг ${TG.TEAM_GEN[f.team]} ${why}`, c: TG.TEAM_COLORS[f.team] });
    }
    postTick() {
      const w = this.w;
      if (w.over) return;
      for (const t of w.tanks) {
        if (!t.alive) continue;
        const enemyFlag = w.flags[t.team === 1 ? 1 : 0];
        const ownFlag = w.flags[t.team === 1 ? 0 : 1];
        if (!enemyFlag.carrier && U.dist2(t.x, t.y, enemyFlag.x, enemyFlag.y) < (t.r + 20) ** 2) {
          enemyFlag.carrier = t; t.carrying = enemyFlag; enemyFlag.returnStart = 0; enemyFlag.droppedAt = 0;
          w.emit({ k: 'msg', text: `${t.name} взял флаг!`, c: TG.TEAM_COLORS[t.team], flag: 1 });
        }
        if (t.carrying && U.dist2(t.x, t.y, ownFlag.homeX, ownFlag.homeY) < 10000) {
          this.score[t.team]++;
          t.score += 1;
          const f = t.carrying;
          t.carrying = null; f.carrier = null;
          f.x = f.homeX; f.y = f.homeY; f.returnStart = 0; f.droppedAt = 0;
          w.emit({ k: 'msg', text: `${TG.TEAM_NAMES[t.team]} ЗАХВАТИЛИ ФЛАГ! (${this.score[1]}:${this.score[2]})`, c: TG.TEAM_COLORS[t.team], big: 1, cap: 1 });
          w.emit({ k: 'boom', x: t.x, y: t.y, c: TG.TEAM_COLORS[t.team], n: 60 });
          if (this.score[t.team] >= this.caps) {
            w.finish({ winTeam: t.team, title: `ПОБЕДА ${TG.TEAM_ADJ[t.team]} КОМАНДЫ!`, sub: `Счёт ${this.score[1]} : ${this.score[2]}` });
            return;
          }
        }
      }
      for (const f of w.flags) if (f.carrier) { f.x = f.carrier.x; f.y = f.carrier.y; }
    }
    onKill(v) { v.respawnAt = this.w.tick + 300; }
    botThink(t) {
      const w = this.w;
      const enemyFlag = w.flags[t.team === 1 ? 1 : 0];
      const ownFlag = w.flags[t.team === 1 ? 0 : 1];
      const vis = TG.AI.perceive(w, t);
      let orders;
      if (enemyFlag.carrier === t) {
        orders = { goal: { x: ownFlag.homeX, y: ownFlag.homeY, stop: 10 }, urgent: true };
      } else if (ownFlag.carrier) {
        const thief = ownFlag.carrier;
        orders = { goal: { x: thief.x, y: thief.y, stop: 60 }, focus: thief, urgent: !vis.some((v) => v.t === thief) };
      } else if (!(ownFlag.x === ownFlag.homeX && ownFlag.y === ownFlag.homeY) && U.dist2(t.x, t.y, ownFlag.x, ownFlag.y) < 700 * 700) {
        orders = { goal: { x: ownFlag.x, y: ownFlag.y, stop: 25 }, urgent: U.dist2(t.x, t.y, ownFlag.x, ownFlag.y) > 90 * 90 };
      } else if (t.role === 'def') {
        if (!t.ai.patrol || w.tick > t.ai.patrolT) {
          t.ai.patrol = { x: ownFlag.homeX + U.rand(-250, 250), y: ownFlag.homeY + (t.team === 1 ? -1 : 1) * U.rand(150, 450), stop: 20 };
          t.ai.patrolT = w.tick + 240;
        }
        orders = { goal: t.ai.patrol, hold: 350 };
      } else if (!enemyFlag.carrier) {
        const g = this.attackGoal(t, enemyFlag);
        orders = { goal: g, urgent: U.dist2(t.x, t.y, enemyFlag.x, enemyFlag.y) < 280 * 280 };
      } else {
        const c = enemyFlag.carrier; // сопровождаем своего носителя
        orders = { goal: { x: c.x + U.rand(-60, 60), y: c.y + (t.team === 1 ? -90 : 90), stop: 60 } };
      }
      TG.AI.brain(w, t, orders);
    }
    attackGoal(t, flag) {
      // Атака по флангам: до середины вражеской половины двигаемся по своей «линии»
      const W = this.w.map.w, H = this.w.map.h;
      if (t.lane != null && Math.abs(flag.y - t.y) > H * 0.3) {
        const dir = flag.y > t.y ? 1 : -1;
        return { x: U.clamp(W / 2 + t.lane * W, 60, W - 60), y: U.clamp(t.y + dir * 350, 60, H - 60), stop: 30 };
      }
      return { x: flag.x, y: flag.y, stop: 2 };
    }
    hud() {
      return { t: 'Захват флага', score: [this.score[1], this.score[2]], caps: this.caps, left: Math.max(0, Math.ceil((this.limit - (this.w.tick - this.startTick)) / 60)) };
    }
  }

  // ======================================================================
  // АРЕНА (все против всех / команды)
  // ======================================================================
  class ArenaMode extends BaseMode {
    constructor(w, o) {
      super(w, o);
      this.teams = !!o.teams;
      this.teamColors = this.teams;
      this.botsOnBoard = true;
      this.bots = U.clamp(o.bots == null ? 3 : o.bots | 0, 0, 10);
      this.diff = U.clamp(o.diff | 0 || 2, 1, 4);
      this.target = [5, 10, 20, 30].includes(o.kills | 0) ? o.kills | 0 : 10;
      if (this.teams) this.target *= 2;
      this.boostInterval = 300;
      this.maxBoosts = 12;
      this.score = { 1: 0, 2: 0 };
    }
    title() { return this.teams ? 'Арена: команды' : 'Арена: все против всех'; }
    setup() {
      const w = this.w;
      const total = w.players.size + this.bots;
      const [W, H] = total <= 4 ? [1400, 1000] : total <= 8 ? [1800, 1300] : [2200, 1600];
      w.map = { w: W, h: H, bases: [], obstacles: [] };
      const q = total <= 4 ? U.randInt(3, 4) : total <= 8 ? U.randInt(4, 6) : U.randInt(6, 8);
      w.map.obstacles = TG.genSymmetric(W, H, { count: q, minW: 60, maxW: 170, minH: 40, maxH: 100, gap: 60, margin: 70 });
      const cnt = { 1: 0, 2: 0 };
      for (const p of w.players.values()) {
        if (this.teams) {
          if (p.team !== 1 && p.team !== 2) p.team = cnt[1] <= cnt[2] ? 1 : 2;
          cnt[p.team]++;
        } else p.team = 0;
      }
      for (const p of w.players.values()) w.spawnPlayer(p, this.spawnPos(p.team), { hp: 3, maxHp: 3, shield: 120 });
      for (let i = 0; i < this.bots; i++) {
        let team = 0;
        if (this.teams) { team = cnt[1] <= cnt[2] ? 1 : 2; cnt[team]++; }
        this.addBot(team, i);
      }
      for (let i = 0; i < 4; i++) w.spawnBoost();
      this.startTick = w.tick;
    }
    addBot(team, i) {
      return this.w.createTacticalBot(this.spawnPos(team), team, this.diff, 3, 'Бот ' + BOT_NAMES[i % BOT_NAMES.length]);
    }
    enemiesOf(team) {
      const r = [];
      for (const t of this.w.tanks) if (t.alive && (team === 0 || t.team !== team)) r.push(t);
      return r;
    }
    spawnPos(team) {
      return TG.findSpot(this.w.map, { r: 25, far: this.enemiesOf(team), minDist: 500, avoidTanks: this.w.tanks });
    }
    onJoin(p) {
      const w = this.w;
      if (this.teams) {
        if (p.team !== 1 && p.team !== 2) {
          let c1 = 0, c2 = 0;
          for (const t of w.tanks) { if (t.team === 1) c1++; else if (t.team === 2) c2++; }
          p.team = c1 <= c2 ? 1 : 2;
        }
      } else p.team = 0;
      w.spawnPlayer(p, this.spawnPos(p.team), { hp: 3, maxHp: 3, shield: 120 });
    }
    tick() {
      const w = this.w;
      for (const t of w.tanks) if (!t.alive && w.tick >= t.respawnAt) w.revive(t, this.spawnPos(t.team), 120);
    }
    onKill(v, k) {
      const w = this.w;
      v.respawnAt = w.tick + 180;
      if (!k || k === v) return;
      k.score++;
      if (this.teams) {
        if (k.team === v.team) return;
        this.score[k.team]++;
        if (this.score[k.team] >= this.target) w.finish({ winTeam: k.team, title: `ПОБЕДА ${TG.TEAM_ADJ[k.team]} КОМАНДЫ!`, sub: `Счёт ${this.score[1]} : ${this.score[2]}` });
      } else if (k.score >= this.target) {
        w.finish({ winTank: k.id, title: `ПОБЕДИЛ ${k.name.toUpperCase()}!`, sub: `${k.score} убийств` });
      }
    }
    botThink(t) {
      const w = this.w, ai = t.ai;
      const vis = TG.AI.perceive(w, t);
      let orders = null;
      if (!vis.length) {
        // охота: идём к случайному врагу (боты на арене знают примерное положение)
        if (!ai.hunt || w.tick > ai.huntT || !ai.hunt.alive) {
          const en = this.enemiesOf(t.team).filter((o) => o !== t);
          ai.hunt = en.length ? U.choice(en) : null;
          ai.huntT = w.tick + 300;
        }
        if (ai.hunt) orders = { goal: { x: ai.hunt.x, y: ai.hunt.y, stop: 200 } };
      }
      TG.AI.brain(w, t, orders);
    }
    hud() {
      const h = { t: this.title(), target: this.target };
      if (this.teams) h.score = [this.score[1], this.score[2]];
      else {
        let lead = null;
        for (const t of this.w.tanks) if (!lead || t.score > lead.score) lead = t;
        if (lead) h.lead = [lead.name, lead.score];
      }
      return h;
    }
  }

  // ======================================================================
  // БЕДВАРС: ядра команд, разрушаемые блоки, генераторы, магазин, бомбы, турели
  // ======================================================================
  const shopIdx = (key) => TG.SHOP.findIndex((s) => s.key === key);
  class BedwarsMode extends BaseMode {
    constructor(w, o) {
      super(w, o);
      this.teamColors = true;
      this.botsOnBoard = true;
      this.allowBlocks = true;
      this.nTeams = (o.teams | 0) === 4 ? 4 : 2;
      this.size = U.clamp(o.size | 0 || 2, 1, 4);
      this.diff = U.clamp(o.diff | 0 || 2, 1, 4);
      this.limit = ([10, 15, 20].includes(o.time | 0) ? o.time | 0 : 15) * 3600;
      this.boostInterval = 480;
      this.maxBoosts = 5;
      this.cores = {};
      this.ring = {};
      this.turrets = {};
      this.forge = {};
      this.alertT = {};
    }
    title() { return 'Бедварс'; }
    setup() {
      const w = this.w, T = this.nTeams;
      const W = T === 2 ? 2400 : 2200, H = T === 2 ? 1360 : 2200;
      const bases = T === 2
        ? [{ x: 280, y: 680 }, { x: W - 280, y: 680 }]
        : [{ x: 280, y: 280 }, { x: W - 280, y: 280 }, { x: W - 280, y: H - 280 }, { x: 280, y: H - 280 }];
      this.baseC = {};
      w.map = { w: W, h: H, bases: [], obstacles: [], pads: [] };
      const avoid = [];
      const gemPads = T === 2
        ? [{ x: W / 2, y: H / 2 }, { x: W / 2, y: 200 }, { x: W / 2, y: H - 200 }]
        : [{ x: W / 2, y: H / 2 }, { x: W / 2, y: 260 }, { x: W / 2, y: H - 260 }, { x: 260, y: H / 2 }, { x: W - 260, y: H / 2 }];
      bases.forEach((b, i) => {
        const team = i + 1;
        this.baseC[team] = b;
        avoid.push({ x: b.x - 250, y: b.y - 250, w: 500, h: 500 });
        const dx = W / 2 - b.x, dy = H / 2 - b.y, dl = Math.hypot(dx, dy);
        // генератор кристаллов вынесен за пределы базы — его приходится защищать
        const gx = Math.round(b.x + dx / dl * 340 - dy / dl * 70), gy = Math.round(b.y + dy / dl * 340 + dx / dl * 70);
        w.map.pads.push({ x: gx, y: gy, team, gen: 'crystal', t: 0 });
        avoid.push({ x: gx - 80, y: gy - 80, w: 160, h: 160 });
      });
      gemPads.forEach((g, i) => { w.map.pads.push({ x: g.x, y: g.y, team: 0, gen: 'gem', t: i * 90, main: i === 0 }); avoid.push({ x: g.x - 110, y: g.y - 110, w: 220, h: 220 }); });
      const gen = TG.genSymmetric(W, H, { count: U.randInt(5, 7), minW: 50, maxW: 150, minH: 40, maxH: 100, gap: 60, margin: 60 });
      w.map.obstacles = gen.filter((o) => !avoid.some((a) => TG.rectsGap(o, a, 0)));
      // базы: ядро + кольцо блоков
      for (let team = 1; team <= T; team++) {
        const b = this.baseC[team];
        w.map.bases.push({ x: b.x - 230, y: b.y - 230, w: 460, h: 460, team, round: 1 });
        this.cores[team] = w.addDyn({ x: b.x - 28, y: b.y - 28, w: 56, h: 56, hp: 36, maxHp: 36, team, core: 1 });
        this.ring[team] = [];
        for (let gx = b.x - 80; gx < b.x + 80; gx += 40) {
          for (let gy = b.y - 80; gy < b.y + 80; gy += 40) {
            if (gx >= b.x - 40 && gx < b.x + 40 && gy >= b.y - 40 && gy < b.y + 40) continue;
            this.ring[team].push({ x: gx, y: gy, w: 40, h: 40 });
            w.addDyn({ x: gx, y: gy, w: 40, h: 40, hp: 4, maxHp: 4, team });
          }
        }
        this.turrets[team] = 0;
        this.forge[team] = 0;
      }
      this.boostRegion = { x: W / 2 - 500, y: H / 2 - 400, w: 1000, h: 800 };
      const cnt = {};
      for (let i = 1; i <= T; i++) cnt[i] = 0;
      for (const p of w.players.values()) if (p.team >= 1 && p.team <= T) cnt[p.team]++;
      for (const p of w.players.values()) {
        if (!(p.team >= 1 && p.team <= T)) {
          let best = 1;
          for (let i = 2; i <= T; i++) if (cnt[i] < cnt[best]) best = i;
          p.team = best; cnt[best]++;
        }
      }
      this.ts = Math.max(this.size, ...Object.values(cnt));
      for (const p of w.players.values()) this.spawnHuman(p);
      for (let team = 1; team <= T; team++) {
        for (let i = cnt[team]; i < this.ts; i++) this.addBot(team, i);
      }
      this.startTick = w.tick;
    }
    spawnHuman(p) {
      const t = this.w.spawnPlayer(p, this.spawnPos(p.team), { hp: 3, maxHp: 3, shield: 120 });
      t.blocks = 4;
      return t;
    }
    addBot(team, i) {
      const t = this.w.createTacticalBot(this.spawnPos(team), team, this.diff, 3, 'Бот ' + BOT_NAMES[(i + team * 5) % BOT_NAMES.length]);
      t.blocks = 4;
      const mates = this.w.tanks.filter((o) => o.team === team && !o.kd && o !== t).length;
      t.role = mates === 1 && this.ts >= 2 ? 'def' : 'atk';
      return t;
    }
    spawnPos(team) {
      const b = this.baseC[team];
      const W = this.w.map.w, H = this.w.map.h;
      const dx = W / 2 - b.x, dy = H / 2 - b.y, dl = Math.hypot(dx, dy);
      const cx = b.x + dx / dl * 160, cy = b.y + dy / dl * 160;
      return TG.findSpot(this.w.map, { r: 24, region: { x: cx - 80, y: cy - 80, w: 160, h: 160 }, avoidTanks: this.w.tanks });
    }
    canPlace(rect) {
      for (const p of this.w.map.pads) if (TG.circleRect(p.x, p.y, 38, rect)) return false;
      return true;
    }
    missingRing(team) {
      const out = [];
      if (!this.cores[team]) return out;
      for (const c of this.ring[team]) {
        let has = false;
        for (const o of this.w.dyn) if (o.x === c.x && o.y === c.y && !o.core) { has = true; break; }
        if (!has) out.push(c);
      }
      return out;
    }
    onJoin(p) {
      const w = this.w, T = this.nTeams;
      if (!(p.team >= 1 && p.team <= T)) {
        const cnt = {};
        for (let i = 1; i <= T; i++) cnt[i] = 0;
        for (const q of w.players.values()) if (q !== p && q.team >= 1 && q.team <= T) cnt[q.team]++;
        let best = 1;
        for (let i = 2; i <= T; i++) if (cnt[i] < cnt[best]) best = i;
        p.team = best;
      }
      const bot = w.tanks.find((t) => t.isBot && !t.kd && t.team === p.team);
      if (bot) w.removeTank(bot);
      if (this.cores[p.team]) this.spawnHuman(p);
    }
    onLeave(p) {
      if (!this.w.over && this.cores[p.team]) this.addBot(p.team, U.randInt(0, 20));
    }
    buy(t, idx) {
      const item = TG.SHOP[idx];
      if (!item) return false;
      const bw = t.bw, w = this.w;
      const fail = (why) => { if (t.pid) w.emit({ k: 'shop', tid: t.id, ok: 0, why }); return false; };
      if (t.coins < item.price) return fail('Не хватает кристаллов');
      const lvl = item.team ? this.forge[t.team] : (bw[item.key] || 0);
      if (item.max && lvl >= item.max) return fail('Максимальный уровень');
      const core = this.cores[t.team];
      switch (item.key) {
        case 'blocks': t.blocks += 4; break;
        case 'hblocks': t.hblocks += 2; break;
        case 'bomb': if (t.bombs >= 3) return fail('Не больше 3 бомб'); t.bombs++; break;
        case 'walls': {
          if (!core) return fail('Ядро разрушено');
          let fixed = 0;
          for (const c of this.missingRing(t.team)) {
            if (!w.canPlaceRect(c, t)) continue;
            w.addDyn({ x: c.x, y: c.y, w: 40, h: 40, hp: 4, maxHp: 4, team: t.team });
            fixed++;
          }
          if (!fixed && core.hp >= core.maxHp) return fail('Защита и так цела');
          core.hp = Math.min(core.maxHp, core.hp + 10); w.dynChanged(core, false);
          break;
        }
        case 'armor': t.maxHp++; t.hp++; break;
        case 'dmg': t.dmgBonus++; break;
        case 'rate': t.reloadMult *= 0.85; break;
        case 'speed': t.baseSpeed = +(t.baseSpeed * 1.12).toFixed(3); break;
        case 'heal': if (t.hp >= t.maxHp) return fail('HP и так полное'); t.hp = Math.min(t.maxHp, t.hp + 2); break;
        case 'shield': t.shieldUntil = Math.max(t.shieldUntil, w.tick + 360); break;
        case 'turret': {
          if (this.turrets[t.team] >= 2) return fail('Максимум 2 турели');
          const pos = TG.findSpot(w.map, { r: 24, region: { x: t.x - 90, y: t.y - 90, w: 180, h: 180 }, avoidTanks: w.tanks });
          const tur = w.createBot('turret', pos, t.team, { cd: 30 });
          tur.name = 'Турель';
          this.turrets[t.team]++;
          break;
        }
        case 'forge':
          this.forge[t.team]++;
          w.emit({ k: 'msg', text: `Кузница: генератор ускорен (ур. ${this.forge[t.team]})`, c: TG.TEAM_COLORS[t.team], team: t.team });
          break;
      }
      if (!item.team) bw[item.key] = (bw[item.key] || 0) + 1;
      t.coins -= item.price;
      w.emit({ k: 'shop', tid: t.id, ok: 1, item: item.name });
      return true;
    }
    tick() {
      const w = this.w, tick = w.tick;
      if (tick - this.startTick >= this.limit) { this.timeUp(); return; }
      for (const p of w.map.pads) {
        const every = p.gen === 'gem' ? (p.main ? 420 : 600) : Math.round(55 / (1 + 0.5 * (this.forge[p.team] || 0)));
        const cap = p.gen === 'gem' ? 3 : 12;
        if (++p.t < every) continue;
        p.t = 0;
        if (p.team && !this.cores[p.team] && !w.tanks.some((t) => t.alive && t.team === p.team)) continue;
        let near = 0;
        for (const b of w.boosts) if (b.type === p.gen && U.dist2(b.x, b.y, p.x, p.y) < 50 * 50) near++;
        if (near < cap) w.addBoost(p.x + U.rand(-20, 20), p.y + U.rand(-20, 20), p.gen);
      }
      for (const t of w.tanks) {
        if (t.alive || (t.kd && t.kd.turret) || !t.respawnAt) continue;
        if (!this.cores[t.team]) continue;
        if (tick >= t.respawnAt) { w.revive(t, this.spawnPos(t.team), 120); t.respawnAt = 0; }
      }
    }
    teamAlive(team) {
      if (this.cores[team]) return true;
      for (const t of this.w.tanks) if (t.alive && t.team === team && !(t.kd && t.kd.turret)) return true;
      return false;
    }
    postTick() {
      const w = this.w;
      if (w.over) return;
      for (let i = w.tanks.length - 1; i >= 0; i--) {
        const t = w.tanks[i];
        if (!t.alive && t.kd && t.kd.turret) { this.turrets[t.team] = Math.max(0, this.turrets[t.team] - 1); w.tanks.splice(i, 1); w.tankMap.delete(t.id); }
      }
      const alive = [];
      for (let team = 1; team <= this.nTeams; team++) if (this.teamAlive(team)) alive.push(team);
      if (alive.length <= 1) {
        if (alive.length === 1) w.finish({ winTeam: alive[0], title: `ПОБЕДА ${TG.TEAM_ADJ[alive[0]]} КОМАНДЫ!`, sub: 'Все вражеские ядра уничтожены' });
        else w.finish({ draw: true, title: 'НИЧЬЯ', sub: 'Все команды уничтожены' });
      }
    }
    timeUp() {
      let best = 0, bestScore = -1, tie = false;
      for (let team = 1; team <= this.nTeams; team++) {
        const core = this.cores[team];
        let s = core ? core.hp * 10 : 0;
        for (const t of this.w.tanks) if (t.alive && t.team === team) s += 1;
        if (s > bestScore) { bestScore = s; best = team; tie = false; } else if (s === bestScore) tie = true;
      }
      if (tie) this.w.finish({ draw: true, title: 'НИЧЬЯ', sub: 'Время вышло' });
      else this.w.finish({ winTeam: best, title: `ПОБЕДА ${TG.TEAM_ADJ[best]} КОМАНДЫ!`, sub: 'Время вышло — у них самое целое ядро' });
    }
    onKill(v, k) {
      v.respawnAt = this.w.tick + 300;
      if (k && k !== v) {
        k.score++;
        if (v.coins) { k.coins += v.coins; v.coins = 0; }
      }
      if (!this.cores[v.team] && !(v.kd && v.kd.turret) && v.pid) {
        this.w.emit({ k: 'msg', text: `${v.name} выбывает (ядро уничтожено)`, c: TG.TEAM_COLORS[v.team] });
      }
    }
    onCoreHit(o) {
      const tick = this.w.tick;
      if (!this.alertT[o.team] || tick - this.alertT[o.team] > 300) {
        this.alertT[o.team] = tick;
        this.w.emit({ k: 'msg', text: 'ВАШЕ ЯДРО АТАКУЮТ!', c: TG.TEAM_COLORS[o.team], team: o.team });
      }
    }
    onDynDestroyed(o, src) {
      if (!o.core) return;
      this.cores[o.team] = null;
      if (src && src.id) src.score += 5;
      this.w.emit({ k: 'msg', text: `ЯДРО ${TG.TEAM_GEN[o.team].toUpperCase()} УНИЧТОЖЕНО!`, c: TG.TEAM_COLORS[o.team], big: 1, cap: 1 });
      this.w.emit({ k: 'boom', x: o.x + o.w / 2, y: o.y + o.h / 2, c: TG.TEAM_COLORS[o.team], n: 120, big: 1 });
    }
    botBuy(t) {
      const core = this.cores[t.team];
      const missing = this.missingRing(t.team).length;
      const order = [];
      if (t.role === 'def' && core) {
        if (core.hp < core.maxHp * 0.6 || missing >= 3) order.push('walls');
        if (t.hp < t.maxHp - 1) order.push('heal');
        if (t.blocks + t.hblocks < 3) order.push('hblocks');
        order.push('armor', 'rate', 'turret', 'forge', 'dmg');
      } else {
        if (t.hp < t.maxHp - 1) order.push('heal');
        order.push('armor');
        if (t.bombs < 1 && (t.bw.armor || 0) >= 1) order.push('bomb');
        order.push('dmg', 'rate', 'speed');
        if (t.blocks + t.hblocks < 2) order.push('blocks');
      }
      for (const key of order) {
        const item = TG.SHOP[shopIdx(key)];
        if (t.coins < item.price) continue;
        const lvl = item.team ? this.forge[t.team] : (t.bw[key] || 0);
        if (item.max && lvl >= item.max) continue;
        if (key === 'turret' && this.turrets[t.team] >= 2) continue;
        if (this.buy(t, shopIdx(key))) return;
      }
    }
    botThink(t) {
      const w = this.w, ai = t.ai, tick = w.tick;
      if (t.kd && t.kd.turret) { TG.AI.brain(w, t, { noChase: true }); return; }
      if ((tick + t.id) % 90 === 0) this.botBuy(t);
      const base = this.baseC[t.team];
      const pad = w.map.pads.find((p) => p.team === t.team);
      const vis = TG.AI.perceive(w, t);
      // укрытие из блока, когда бот ранен под огнём
      if ((t.blocks + t.hblocks) > 0 && t.hp <= Math.max(1, t.maxHp / 3) && vis.length && vis[0].d < 420 && tick > (ai.coverBlockT || 0)) {
        const en = vis[0].t;
        if (w.placeBlock(t, Math.atan2(en.y - t.y, en.x - t.x))) ai.coverBlockT = tick + 240;
      }
      let orders;
      if (t.role === 'def' && this.cores[t.team]) {
        const missing = (t.blocks + t.hblocks) > 0 ? this.missingRing(t.team) : [];
        if (missing.length) {
          // защитник чинит кольцо вокруг ядра
          let best = null, bd = Infinity;
          for (const c of missing) { const d = U.dist2(c.x + 20, c.y + 20, t.x, t.y); if (d < bd) { bd = d; best = c; } }
          const cx = best.x + 20, cy = best.y + 20;
          const ox = cx - base.x, oy = cy - base.y, ol = Math.hypot(ox, oy) || 1;
          orders = { goal: { x: cx + ox / ol * 55, y: cy + oy / ol * 55, stop: 12 }, urgent: !vis.length };
          if (bd < 85 * 85 && w.canPlaceRect(best, t)) w.placeBlockAt(t, best);
        } else {
          const cr = w.boosts.find((b) => b.type === 'crystal' && U.dist2(b.x, b.y, pad.x, pad.y) < 60 * 60);
          orders = { goal: cr ? { x: cr.x, y: cr.y, stop: 2 } : { x: (pad.x + base.x) / 2, y: (pad.y + base.y) / 2, stop: 40 }, hold: 380 };
        }
      } else {
        if (!ai.enemy || !this.teamAlive(ai.enemy) || tick > (ai.enemyT || 0)) {
          let best = null, bd = Infinity;
          for (let team = 1; team <= this.nTeams; team++) {
            if (team === t.team || !this.teamAlive(team)) continue;
            const b = this.baseC[team];
            const d = Math.hypot(b.x - t.x, b.y - t.y) + (this.cores[team] ? 0 : 400);
            if (d < bd) { bd = d; best = team; }
          }
          ai.enemy = best; ai.enemyT = tick + 900;
        }
        const et = ai.enemy;
        if (ai.retreatUntil > tick && ai.retreatTo) {
          orders = { goal: ai.retreatTo, urgent: true };
        } else if (et && this.cores[et]) {
          const core = this.cores[et];
          const cx = core.x + core.w / 2, cy = core.y + core.h / 2;
          const dc = Math.hypot(cx - t.x, cy - t.y);
          orders = { goal: { x: cx, y: cy, stop: 110 }, structure: { x: cx, y: cy, obs: core } };
          // бомба у вражеского кольца — и отход
          if (t.bombs > 0 && dc < 175 && tick > (ai.bombT || 0)) {
            t.a = Math.atan2(cy - t.y, cx - t.x);
            if (w.placeBomb(t)) {
              ai.bombT = tick + 300;
              ai.retreatUntil = tick + 130;
              ai.retreatTo = { x: U.clamp(t.x - (cx - t.x) / dc * 220, 40, w.map.w - 40), y: U.clamp(t.y - (cy - t.y) / dc * 220, 40, w.map.h - 40), stop: 20 };
            }
          }
          const gem = w.boosts.find((b) => b.type === 'gem' && U.dist2(b.x, b.y, t.x, t.y) < 260 * 260);
          if (gem) orders.goal = { x: gem.x, y: gem.y, stop: 2 };
        } else if (et) {
          const b = this.baseC[et];
          orders = { goal: { x: b.x, y: b.y, stop: 150 } };
        } else orders = { goal: { x: base.x, y: base.y, stop: 150 } };
      }
      TG.AI.brain(w, t, orders);
    }
    hud() {
      const cores = [], alive = [];
      for (let team = 1; team <= this.nTeams; team++) {
        const c = this.cores[team];
        cores.push(c ? Math.ceil(c.hp) : -1);
        let n = 0;
        for (const t of this.w.tanks) if (t.alive && t.team === team && !(t.kd && t.kd.turret)) n++;
        alive.push(n);
      }
      return { t: 'Бедварс', cores, coreMax: 36, alive, left: Math.max(0, Math.ceil((this.limit - (this.w.tick - this.startTick)) / 60)) };
    }
    personal(p) {
      const t = p.tank;
      if (!t) return null;
      const res = { coins: t.coins, blocks: t.blocks, hblocks: t.hblocks, bombs: t.bombs, bw: t.bw, forge: this.forge[t.team] || 0, shop: 1 };
      if (!t.alive) {
        if (this.cores[t.team] && t.respawnAt) res.resp = Math.max(0, Math.ceil((t.respawnAt - this.w.tick) / 60));
        else res.out = 1;
      }
      return res;
    }
  }

  // ======================================================================
  // КОРОЛЕВСКАЯ БИТВА: сужающаяся зона, без возрождений, последний выживший побеждает
  // ======================================================================
  class RoyaleMode extends BaseMode {
    constructor(w, o) {
      super(w, o);
      this.botsOnBoard = true;
      this.total = [6, 10, 16, 24].includes(o.total | 0) ? o.total | 0 : 10;
      this.diff = U.clamp(o.diff | 0 || 2, 1, 4);
      this.fast = !!o.fast;
      this.boostInterval = 200;
      this.aliveCount = 0;
    }
    title() { return 'Королевская битва'; }
    setup() {
      const w = this.w;
      const total = Math.max(this.total, w.players.size + 1);
      this.total = total;
      const S = total <= 10 ? 2400 : total <= 16 ? 2900 : 3400;
      w.map = { w: S, h: S, bases: [], obstacles: [] };
      const ratio = (S * S) / 4000000;
      w.map.obstacles = TG.genObstacles(S, S, { count: Math.round(U.randInt(30, 40) * ratio), gap: 60, margin: 60 });
      this.maxBoosts = total * 3;
      for (const p of w.players.values()) p.team = 0;
      const pts = [];
      const place = () => { const pos = TG.findSpot(w.map, { r: 25, far: pts, minDist: S / Math.sqrt(total) * 0.7, avoidTanks: w.tanks }); pts.push(pos); return pos; };
      for (const p of w.players.values()) w.spawnPlayer(p, place(), { hp: 5, maxHp: 5, shield: 180 });
      for (let i = w.players.size; i < total; i++) {
        const t = w.createTacticalBot(place(), 0, this.diff, 5, 'Бот ' + BOT_NAMES[i % BOT_NAMES.length]);
        t.shieldUntil = w.tick + 180;
      }
      for (let i = 0; i < total * 2; i++) w.spawnBoost();
      const k = this.fast ? 0.6 : 1;
      this.phases = [[35, 25, 0.68], [25, 25, 0.44], [20, 20, 0.26], [15, 18, 0.12], [12, 22, 0]].map(([a, b, f]) => [Math.round(a * k * 60), Math.round(b * k * 60), f]);
      const R0 = S * 0.75;
      this.zone = { x0: S / 2, y0: S / 2, r0: R0, x1: S / 2, y1: S / 2, r1: R0, t0: 0, t1: 0 };
      this.phase = -1;
      this.nextPhase(w.tick);
      this.startTick = w.tick;
      this.place = total;
    }
    nextPhase(now) {
      this.phase++;
      const z = this.zone;
      const cur = this.circleAt(now);
      if (this.phase >= this.phases.length) { z.x0 = z.x1 = cur.x; z.y0 = z.y1 = cur.y; z.r0 = z.r1 = cur.r; z.t0 = z.t1 = now; this.waitUntil = Infinity; return; }
      const [wait, shrink, frac] = this.phases[this.phase];
      const S = this.w.map.w;
      const r1 = S * 0.75 * frac;
      const maxOff = Math.max(0, cur.r - r1) * 0.8;
      const a = Math.random() * Math.PI * 2, d = Math.random() * maxOff;
      let x1 = cur.x + Math.cos(a) * d, y1 = cur.y + Math.sin(a) * d;
      x1 = U.clamp(x1, Math.min(S / 2, r1 + 100), Math.max(S / 2, S - r1 - 100));
      y1 = U.clamp(y1, Math.min(S / 2, r1 + 100), Math.max(S / 2, S - r1 - 100));
      z.x0 = cur.x; z.y0 = cur.y; z.r0 = cur.r;
      z.x1 = x1; z.y1 = y1; z.r1 = r1;
      z.t0 = now + wait; z.t1 = now + wait + shrink;
      this.w.emit({ k: 'msg', text: this.phase === 0 ? 'Зона начнёт сужаться через ' + Math.round(wait / 60) + ' с' : 'Зона снова сужается!', c: [255, 80, 200] });
    }
    circleAt(tick) {
      const z = this.zone;
      const k = z.t1 > z.t0 ? U.clamp((tick - z.t0) / (z.t1 - z.t0), 0, 1) : (tick >= z.t1 ? 1 : 0);
      return { x: z.x0 + (z.x1 - z.x0) * k, y: z.y0 + (z.y1 - z.y0) * k, r: z.r0 + (z.r1 - z.r0) * k };
    }
    onJoin(p) { p.team = 0; } // опоздавшие наблюдают
    tick() {
      const w = this.w;
      if (w.tick >= this.zone.t1 && this.zone.t1 !== 0 && this.phase < this.phases.length) this.nextPhase(w.tick);
      if (w.tick % 60 === 0) {
        const c = this.circleAt(w.tick);
        for (const t of w.tanks) {
          if (!t.alive) continue;
          if (Math.hypot(t.x - c.x, t.y - c.y) > c.r) {
            t.iframeUntil = 0;
            this.w.damage(t, null, this.phase >= 3 ? 2 : 1);
          }
        }
      }
    }
    onKill(v, k) {
      v.place = this.aliveTanks() + 1;
      if (k && k !== v) k.score++;
    }
    aliveTanks() { let n = 0; for (const t of this.w.tanks) if (t.alive) n++; return n; }
    postTick() {
      const w = this.w;
      if (w.over) return;
      const alive = this.aliveTanks();
      this.aliveCount = alive;
      if (alive <= 1) {
        const last = w.tanks.find((t) => t.alive);
        if (last) { last.place = 1; w.finish({ winTank: last.id, title: last.pid ? `ПОБЕДА! ${last.name.toUpperCase()} — ТОП-1` : `ПОБЕДИЛ ${last.name.toUpperCase()}`, sub: `Выжил последним из ${this.total}` }); }
        else w.finish({ draw: true, title: 'НИЧЬЯ', sub: 'Никто не выжил' });
        return;
      }
      // все игроки выбыли — завершаем матч, показывая места
      if (w.players.size && this.aliveHumans() === 0) {
        let best = null;
        for (const p of w.players.values()) if (p.tank && (!best || p.tank.place < best.place)) best = p.tank;
        w.finish({ win: false, title: best ? `ВЫ ВЫБЫЛИ — МЕСТО ${best.place}` : 'ВЫ ВЫБЫЛИ', sub: `Осталось в живых: ${alive}` });
      }
    }
    botThink(t) {
      const w = this.w, ai = t.ai;
      const c = this.circleAt(w.tick);
      const z = this.zone;
      const next = { x: z.x1, y: z.y1, r: Math.max(60, z.r1) };
      const dNow = Math.hypot(t.x - c.x, t.y - c.y);
      const dNext = Math.hypot(t.x - next.x, t.y - next.y);
      let orders;
      const soon = z.t0 - w.tick < 600;
      if (dNow > c.r - 60 || (soon && dNext > next.r - 40)) {
        const tx = next.x + (t.x - next.x) / (dNext || 1) * next.r * 0.5, ty = next.y + (t.y - next.y) / (dNext || 1) * next.r * 0.5;
        orders = { goal: { x: tx, y: ty, stop: 30 }, urgent: dNow > c.r - 20 };
      } else {
        if (!ai.roam || w.tick > ai.roamT) {
          const a = Math.random() * Math.PI * 2, d = Math.random() * next.r * 0.8;
          ai.roam = { x: U.clamp(next.x + Math.cos(a) * d, 40, w.map.w - 40), y: U.clamp(next.y + Math.sin(a) * d, 40, w.map.h - 40), stop: 40 };
          ai.roamT = w.tick + 400;
        }
        orders = { goal: ai.roam, hold: next.r };
      }
      TG.AI.brain(w, t, orders);
    }
    hud() {
      const z = this.zone, w = this.w;
      const toShrink = Math.max(0, Math.ceil((z.t0 - w.tick) / 60));
      const shrinking = w.tick >= z.t0 && w.tick < z.t1;
      return { t: 'Королевская битва', alive: this.aliveCount || this.aliveTanks(), total: this.total, z: [Math.round(z.x0), Math.round(z.y0), Math.round(z.r0), Math.round(z.x1), Math.round(z.y1), Math.round(z.r1), z.t0, z.t1], zt: shrinking ? -1 : toShrink };
    }
  }

  TG.MODES = TG.MODES || {};
  TG.MODES.levels = LevelsMode;
  TG.MODES.waves = WavesMode;
  TG.MODES.survival = SurvivalMode;
  TG.MODES.ctf = CTFMode;
  TG.MODES.arena = ArenaMode;
  TG.MODES.bedwars = BedwarsMode;
  TG.MODES.royale = RoyaleMode;

  TG.MODE_LIST = ['levels', 'waves', 'survival', 'arena', 'ctf', 'bedwars', 'royale'];
  TG.MODE_INFO = {
    levels:   { name: 'Кампания',           icon: '🎯', desc: '30 уровней: 10 типов врагов и боссы. С друзьями — кооператив.' },
    waves:    { name: 'Бесконечные волны',  icon: '🌊', desc: 'Волны врагов растут, каждая 5-я — с боссом. Сколько продержитесь?' },
    survival: { name: 'Выживание (RPG)',    icon: '⭐', desc: 'Большая карта, опыт, уровни и 8 видов прокачки танка.' },
    arena:    { name: 'Арена (PvP)',        icon: '⚔️', desc: 'Все против всех или команда на команду. Лучший режим для друзей!' },
    ctf:      { name: 'Захват флага',       icon: '🚩', desc: 'Две команды (игроки + боты) сражаются за флаги.' },
    bedwars:  { name: 'Бедварс',            icon: '🛡️', desc: 'Защищай ядро базы блоками, копи кристаллы, покупай улучшения и турели, ломай ядра врагов!' },
    royale:   { name: 'Королевская битва',  icon: '👑', desc: 'Выживает последний! Зона сужается, собирай усиления и побеждай.' }
  };
})(typeof globalThis !== 'undefined' ? (globalThis.TG = globalThis.TG || {}) : (self.TG = self.TG || {}));
