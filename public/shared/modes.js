/* Tank Battle Online — игровые режимы. Все режимы поддерживают одиночную игру и мультиплеер. */
(function (TG) {
  'use strict';
  const C = TG.C, U = TG.U;
  const BOT_NAMES = ['Альфа', 'Браво', 'Чарли', 'Дельта', 'Эхо', 'Фокс', 'Гольф', 'Хантер', 'Индиго', 'Джет', 'Кило', 'Лима', 'Майк', 'Нова', 'Оскар', 'Папа', 'Ромео', 'Сьерра', 'Танго', 'Виктор'];

  function smallMapSize(n) {
    if (n <= 2) return [800, 600];
    if (n <= 4) return [1000, 750];
    return [1200, 900];
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
    }
    humans() { return Array.from(this.w.players.values()); }
    aliveHumans() { let n = 0; for (const p of this.w.players.values()) if (p.tank && p.tank.alive) n++; return n; }
    humanPositions() { const r = []; for (const p of this.w.players.values()) if (p.tank && p.tank.alive) r.push(p.tank); return r; }
    aliveBots() { let n = 0; for (const t of this.w.tanks) if (t.isBot && t.alive) n++; return n; }
    cleanupDeadBots() {
      const w = this.w;
      for (let i = w.tanks.length - 1; i >= 0; i--) {
        const t = w.tanks[i];
        if (t.isBot && !t.alive) { w.tanks.splice(i, 1); w.tankMap.delete(t.id); }
      }
    }
    spotFar(r, minDist, far) {
      return TG.findSpot(this.w.map, { r, far: far || this.humanPositions(), minDist, avoidTanks: this.w.tanks });
    }
    onJoin() {}
    onLeave() {}
    tick() {}
    postTick() {}
    onKill() {}
    botThink(t) { TG.AI.levelBot(this.w, t); }
    hud() { return {}; }
    personal() { return null; }
    title() { return ''; }
  }

  // ============ УРОВНИ (кооператив) ============
  class LevelsMode extends BaseMode {
    constructor(w, o) {
      super(w, o);
      this.level = U.clamp(o.level | 0 || 1, 1, 20);
      this.cfg = TG.LEVELS[this.level];
    }
    title() { return this.level === 20 ? 'GOD MODE' : 'Уровень ' + this.level; }
    setup() {
      const w = this.w, n = Math.max(1, w.players.size);
      const [W, H] = smallMapSize(n);
      w.map = { w: W, h: H, bases: [], obstacles: [] };
      const ratio = (W * H) / (800 * 600);
      w.map.obstacles = TG.genObstacles(W, H, { count: Math.round(U.randInt(5, 9) * ratio), gap: 50, margin: 50 });
      for (const p of w.players.values()) {
        p.team = 1;
        const pos = TG.findSpot(w.map, { r: 25, avoidTanks: w.tanks });
        w.spawnPlayer(p, pos, { hp: 1 });
      }
      const nb = Math.max(1, n);
      for (let i = 0; i < nb; i++) {
        const pos = this.spotFar(25, 400);
        w.createTank({
          x: pos.x, y: pos.y, hp: 1, team: 2, lvl: this.level, rate: this.cfg.rate, cd: this.cfg.rate + 30,
          name: this.level === 20 ? 'GOD' : 'Бот L' + this.level, speed: this.level === 20 ? 5 : 3, noBoosts: this.level === 20
        });
      }
      if (this.level === 20) this.boostInterval = 0;
      else w.spawnBoost();
      this.startTick = w.tick;
    }
    onJoin(p) { p.team = 1; }
    tick() {
      const w = this.w;
      if (this.cfg.survive && w.tick - this.startTick >= 1200 && this.aliveHumans() > 0) {
        w.finish({ win: true, title: 'ПОБЕДА!', sub: 'Вы продержались 20 секунд', next: this.level < 20 });
      }
    }
    postTick() {
      const w = this.w;
      if (w.over) return;
      if (this.aliveBots() === 0) w.finish({ win: true, title: 'ПОБЕДА!', sub: this.title() + ' пройден', next: this.level < 20 });
      else if (this.aliveHumans() === 0) w.finish({ win: false, title: 'ПОРАЖЕНИЕ', sub: this.title() });
    }
    hud() {
      const h = { t: this.title(), bots: this.aliveBots() };
      if (this.cfg.survive) h.surv = Math.max(0, Math.ceil((1200 - (this.w.tick - this.startTick)) / 6) / 10);
      return h;
    }
  }

  // ============ ВОЛНЫ (бесконечный режим, кооператив) ============
  class WavesMode extends BaseMode {
    title() { return 'Бесконечные волны'; }
    setup() {
      const w = this.w, n = Math.max(1, w.players.size);
      const [W, H] = smallMapSize(n);
      w.map = { w: W, h: H, bases: [], obstacles: [] };
      const ratio = (W * H) / (800 * 600);
      w.map.obstacles = TG.genObstacles(W, H, { count: Math.round(U.randInt(5, 9) * ratio), gap: 50, margin: 50 });
      for (const p of w.players.values()) {
        p.team = 1;
        w.spawnPlayer(p, TG.findSpot(w.map, { r: 25, avoidTanks: w.tanks }), { hp: 1 });
      }
      w.spawnBoost();
      this.wave = 0;
      this.state = 'inter';
      this.timer = 120;
      this.startTick = w.tick;
    }
    onJoin(p) {
      p.team = 1;
      if (this.state === 'inter') this.w.spawnPlayer(p, TG.findSpot(this.w.map, { r: 25, avoidTanks: this.w.tanks }), { hp: 1, shield: 90 });
    }
    spawnWave() {
      const w = this.w;
      this.wave++;
      for (const p of w.players.values()) {
        if (!p.tank || !p.tank.alive) w.spawnPlayer(p, TG.findSpot(w.map, { r: 25, avoidTanks: w.tanks }), { hp: 1, shield: 90 });
      }
      const n = Math.max(1, w.players.size);
      const count = Math.min(40, Math.round(this.wave * (1 + 0.6 * (n - 1))));
      const lvl = Math.min(12, 6 + Math.floor((this.wave - 1) / 3));
      const cfg = TG.LEVELS[lvl];
      for (let i = 0; i < count; i++) {
        const pos = this.spotFar(25, 400);
        w.createTank({ x: pos.x, y: pos.y, hp: 1, team: 2, lvl, rate: cfg.rate, cd: cfg.rate + 30 + U.randInt(0, 30), name: 'Бот L' + lvl });
      }
      this.state = 'fight';
      w.emit({ k: 'msg', text: 'ВОЛНА ' + this.wave, c: [0, 200, 255], big: 1 });
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
        this.timer = 180;
        w.emit({ k: 'msg', text: 'ВОЛНА ' + this.wave + ' ПРОЙДЕНА', c: [0, 255, 120], big: 1 });
      }
    }
    hud() {
      const h = { t: 'Волна ' + Math.max(1, this.wave), bots: this.aliveBots() };
      if (this.state === 'inter') h.next = Math.ceil(this.timer / 60);
      return h;
    }
  }

  // ============ ВЫЖИВАНИЕ (RPG, кооператив) ============
  const UPGRADES = {
    speed:  { name: '+Скорость танка', ok: (t) => t.baseSpeed < 7,       apply: (t) => { t.baseSpeed = +(t.baseSpeed + 0.4).toFixed(2); } },
    bspeed: { name: '+Скорость пуль',  ok: (t) => t.bulletSpeedMod < 3, apply: (t) => { t.bulletSpeedMod = +(t.bulletSpeedMod + 0.2).toFixed(2); } },
    bsize:  { name: '+Размер пуль',    ok: (t) => t.sizeMult < 2.4,     apply: (t) => { t.sizeMult = +(t.sizeMult + 0.2).toFixed(2); } },
    hp:     { name: '+1 Макс. HP',     ok: (t) => t.maxHp < 10,         apply: (t) => { t.maxHp++; t.hp = Math.min(t.maxHp, t.hp + 1); } },
    reload: { name: 'Быстрая перезарядка', ok: (t) => t.reloadMult > 0.36, apply: (t) => { t.reloadMult = +(t.reloadMult * 0.88).toFixed(3); } }
  };

  class SurvivalMode extends BaseMode {
    title() { return 'Выживание (RPG)'; }
    setup() {
      const w = this.w, n = Math.max(1, w.players.size);
      const S = Math.min(3200, 2000 + 400 * (n - 1));
      w.map = { w: S, h: S, bases: [], obstacles: [] };
      const ratio = (S * S) / 4000000;
      w.map.obstacles = TG.genObstacles(S, S, { count: Math.round(U.randInt(30, 50) * ratio), gap: 50, margin: 50 });
      let first = null;
      for (const p of w.players.values()) {
        p.team = 1;
        const pos = first
          ? TG.findSpot(w.map, { r: 25, region: { x: first.x - 200, y: first.y - 200, w: 400, h: 400 }, avoidTanks: w.tanks })
          : TG.findSpot(w.map, { r: 25, region: { x: S / 2 - 400, y: S / 2 - 400, w: 800, h: 800 } });
        const t = w.spawnPlayer(p, pos, { hp: 3, shield: 120 });
        if (!first) first = t;
      }
      this.maxBoosts = 20 + 5 * (n - 1);
      for (let i = 0; i < Math.round(10 * ratio); i++) w.spawnBoost();
      this.botTarget = 10 + 4 * (n - 1);
      this.startTick = w.tick;
      this.botKills = 0;
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
    spawnBot() {
      const w = this.w;
      const maxL = U.clamp(Math.round(4 + 2 * this.avgLevel()), 5, 15);
      const levels = [], weights = [];
      for (let i = 1; i <= maxL; i++) { levels.push(i); weights.push(16 - i); }
      let tot = weights.reduce((a, b) => a + b, 0), r = Math.random() * tot, lvl = 1;
      for (let i = 0; i < levels.length; i++) { r -= weights[i]; if (r <= 0) { lvl = levels[i]; break; } }
      const pos = this.spotFar(25, 600);
      const cfg = TG.LEVELS[lvl];
      const hp = 1 + Math.floor(lvl / 5);
      w.createTank({ x: pos.x, y: pos.y, hp, maxHp: hp, team: 2, lvl, rate: cfg.rate, cd: cfg.rate + 30, name: 'Бот L' + lvl });
    }
    tick() {
      const w = this.w;
      let guard = 0;
      while (this.aliveBots() < this.botTarget && guard++ < 3) this.spawnBot();
      const alive = this.humanPositions();
      for (const p of w.players.values()) {
        if (p.tank && !p.tank.alive && p.respawnAt && w.tick >= p.respawnAt && alive.length) {
          const m = U.choice(alive);
          const pos = TG.findSpot(w.map, { r: 25, region: { x: m.x - 250, y: m.y - 250, w: 500, h: 500 }, avoidTanks: w.tanks });
          w.spawnPlayer(p, pos, { shield: 180 });
          p.respawnAt = 0;
        }
      }
    }
    botThink(t) {
      let near = false;
      for (const p of this.w.players.values()) {
        const h = p.tank;
        if (h && h.alive && Math.abs(h.x - t.x) < 1000 && Math.abs(h.y - t.y) < 1000) { near = true; break; }
      }
      if (near) TG.AI.levelBot(this.w, t);
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
      const keys = Object.keys(UPGRADES).filter((k) => UPGRADES[k].ok(t));
      return U.shuffle(keys).slice(0, 3);
    }
    chooseUpgrade(p, idx) {
      const t = p.tank;
      if (!t || p.pending <= 0) return;
      const key = p.upOpts[idx];
      if (!key) return;
      UPGRADES[key].apply(t);
      p.pending--;
      p.upOpts = p.pending > 0 ? this.rollUpgrades(t) : [];
    }
    onKill(v, k) {
      const w = this.w;
      if (v.isBot) {
        this.botKills++;
        if (k && !k.isBot) {
          k.score += v.lvl * 10;
          this.grantXp(k, v.lvl * 10);
          // Союзники получают часть опыта
          for (const p of w.players.values()) if (p.tank && p.tank !== k && p.tank.alive) this.grantXp(p.tank, Math.round(v.lvl * 3));
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
        w.finish({ win: false, title: 'ВЫ ПОГИБЛИ', sub: `Уровень ${best} · Уничтожено ботов: ${this.botKills} · Время ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` });
      }
    }
    hud() {
      const secs = Math.floor((this.w.tick - this.startTick) / 60);
      return { t: 'Выживание', time: secs, bots: this.aliveBots(), kills: this.botKills };
    }
    personal(p) {
      const t = p.tank;
      if (!t) return null;
      const res = { lvl: t.level, xp: t.xp, next: t.level * 100, pend: p.pending, opts: p.upOpts.map((k) => UPGRADES[k].name) };
      if (!t.alive && p.respawnAt) res.resp = Math.max(0, Math.ceil((p.respawnAt - this.w.tick) / 60));
      return res;
    }
  }

  // ============ ЗАХВАТ ФЛАГА (команды) ============
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
      this.maxBoosts = 20;
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
      const W = this.ts >= 7 ? 1400 : 1000, H = 3000, BH = 350;
      this.BH = BH;
      const bases = [{ x: 0, y: H - BH, w: W, h: BH, team: 1 }, { x: 0, y: 0, w: W, h: BH, team: 2 }];
      w.map = { w: W, h: H, bases, obstacles: [] };
      w.map.obstacles = TG.genPointSymmetric(W, H, {
        count: U.randInt(6, 9), minW: 50, maxW: 150, minH: 40, maxH: 100, gap: 55, margin: 40,
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
      const S = TG.AI.DIFF[this.diff];
      const n = this.w.tanks.filter((t) => t.isBot && t.team === team).length;
      const t = this.w.createTank({ x: pos.x, y: pos.y, hp: 3, maxHp: 3, team, rate: S.rate, cd: 60, name: 'Бот ' + BOT_NAMES[(n + (team === 2 ? 10 : 0)) % BOT_NAMES.length] });
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
        else { const wt = a > b ? 1 : 2; w.finish({ winTeam: wt, title: `ПОБЕДА ${wt === 1 ? 'СИНЕЙ' : 'КРАСНОЙ'} КОМАНДЫ!`, sub: `Время вышло · Счёт ${a} : ${b}` }); }
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
      if (why) this.w.emit({ k: 'msg', text: `Флаг ${f.team === 1 ? 'синих' : 'красных'} ${why}`, c: TG.TEAM_COLORS[f.team] });
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
            w.finish({ winTeam: t.team, title: `ПОБЕДА ${t.team === 1 ? 'СИНЕЙ' : 'КРАСНОЙ'} КОМАНДЫ!`, sub: `Счёт ${this.score[1]} : ${this.score[2]}` });
            return;
          }
        }
      }
      for (const f of w.flags) if (f.carrier) { f.x = f.carrier.x; f.y = f.carrier.y; }
    }
    onKill(v, k) {
      v.respawnAt = this.w.tick + 300;
      if (k && k !== v) k.score += 0; // счёт — захваты, убийства видны в таблице
    }
    botThink(t) {
      const w = this.w;
      const S = TG.AI.DIFF[this.diff];
      const enemyFlag = w.flags[t.team === 1 ? 1 : 0];
      const ownFlag = w.flags[t.team === 1 ? 0 : 1];
      const vis = TG.AI.visibleEnemies(w, t, S.view);
      let goal = null, shoot = null;
      if (enemyFlag.carrier === t) {
        goal = { x: ownFlag.homeX, y: ownFlag.homeY };
        if (vis.length && vis[0].d < 250) shoot = vis[0].t;
      } else if (ownFlag.carrier) {
        const thief = ownFlag.carrier;
        goal = { x: thief.x, y: thief.y, stop: 120 };
        shoot = vis.find((v) => v.t === thief) ? thief : (vis.length ? vis[0].t : null);
      } else if (!(ownFlag.x === ownFlag.homeX && ownFlag.y === ownFlag.homeY) && U.dist2(t.x, t.y, ownFlag.x, ownFlag.y) < 640000) {
        goal = { x: ownFlag.x, y: ownFlag.y, stop: 30 }; // охраняем выпавший флаг, чтобы вернуть
        if (vis.length) shoot = vis[0].t;
      } else if (t.role === 'def') {
        if (!t.ai.patrol || w.tick > t.ai.patrolT) {
          t.ai.patrol = { x: ownFlag.homeX + U.rand(-250, 250), y: ownFlag.homeY + (t.team === 1 ? -1 : 1) * U.rand(150, 450) };
          t.ai.patrolT = w.tick + 240;
        }
        goal = vis.length && vis[0].d < 400 ? { x: vis[0].t.x, y: vis[0].t.y, stop: 200 } : t.ai.patrol;
        if (vis.length) shoot = vis[0].t;
      } else if (vis.length) {
        shoot = vis[0].t;
        goal = !enemyFlag.carrier ? this.attackGoal(t, enemyFlag) : { x: shoot.x, y: shoot.y, stop: 160 };
      } else if (!enemyFlag.carrier) {
        goal = this.attackGoal(t, enemyFlag);
      } else {
        const c = enemyFlag.carrier; // сопровождаем своего носителя
        goal = { x: c.x + U.rand(-60, 60), y: c.y + (t.team === 1 ? -80 : 80), stop: 60 };
      }
      TG.AI.tactical(w, t, goal, shoot, this.diff);
    }
    attackGoal(t, flag) {
      // Атака по флангам: до середины вражеской половины двигаемся по своей «линии»
      const W = this.w.map.w, H = this.w.map.h;
      if (t.lane != null && Math.abs(flag.y - t.y) > H * 0.3) {
        const dir = flag.y > t.y ? 1 : -1;
        return { x: U.clamp(W / 2 + t.lane * W, 60, W - 60), y: U.clamp(t.y + dir * 350, 60, H - 60) };
      }
      return { x: flag.x, y: flag.y };
    }
    hud() {
      return { t: 'Захват флага', score: [this.score[1], this.score[2]], caps: this.caps, left: Math.max(0, Math.ceil((this.limit - (this.w.tick - this.startTick)) / 60)) };
    }
  }

  // ============ АРЕНА (все против всех / команды) ============
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
      const S = TG.AI.DIFF[this.diff];
      const pos = this.spawnPos(team);
      return this.w.createTank({ x: pos.x, y: pos.y, hp: 3, maxHp: 3, team, rate: S.rate, cd: 60, name: 'Бот ' + BOT_NAMES[i % BOT_NAMES.length] });
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
        if (this.score[k.team] >= this.target) w.finish({ winTeam: k.team, title: `ПОБЕДА ${k.team === 1 ? 'СИНЕЙ' : 'КРАСНОЙ'} КОМАНДЫ!`, sub: `Счёт ${this.score[1]} : ${this.score[2]}` });
      } else if (k.score >= this.target) {
        w.finish({ winTank: k.id, title: `ПОБЕДИЛ ${k.name.toUpperCase()}!`, sub: `${k.score} убийств` });
      }
    }
    botThink(t) {
      const w = this.w, ai = t.ai;
      const S = TG.AI.DIFF[this.diff];
      const vis = TG.AI.visibleEnemies(w, t, S.view);
      let goal = null, shoot = null;
      if (vis.length) {
        shoot = vis[0].t;
        goal = { x: shoot.x, y: shoot.y, stop: 220 };
        if (vis[0].d < 200 && t.hp <= 1) goal = { x: t.x - (shoot.x - t.x), y: t.y - (shoot.y - t.y) };
      } else {
        let nb = null, nd = 250000;
        for (const b of w.boosts) { const d = U.dist2(t.x, t.y, b.x, b.y); if (d < nd) { nd = d; nb = b; } }
        if (nb) goal = { x: nb.x, y: nb.y, stop: 2 };
        else {
          if (!ai.hunt || w.tick > ai.huntT || !ai.hunt.alive) {
            const en = this.enemiesOf(t.team).filter((o) => o !== t && (t.team === 0 || o.team !== t.team));
            ai.hunt = en.length ? U.choice(en) : null;
            ai.huntT = w.tick + 300;
          }
          goal = ai.hunt ? { x: ai.hunt.x, y: ai.hunt.y, stop: 150 } : null;
        }
      }
      TG.AI.tactical(w, t, goal, shoot, this.diff);
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

  TG.MODES = TG.MODES || {};
  TG.MODES.levels = LevelsMode;
  TG.MODES.waves = WavesMode;
  TG.MODES.survival = SurvivalMode;
  TG.MODES.ctf = CTFMode;
  TG.MODES.arena = ArenaMode;
  TG.UPGRADES = UPGRADES;

  TG.MODE_INFO = {
    levels:   { name: 'Уровни', desc: '20 уровней сложности против ботов. С друзьями — кооператив.', teams: false },
    waves:    { name: 'Бесконечные волны', desc: 'Волны ботов становятся всё больше. Сколько продержитесь?', teams: false },
    survival: { name: 'Выживание (RPG)', desc: 'Большая карта, опыт, уровни и улучшения танка.', teams: false },
    ctf:      { name: 'Захват флага', desc: 'Две команды (игроки + боты) сражаются за флаги.', teams: true },
    arena:    { name: 'Арена (PvP)', desc: 'Все против всех или команда на команду. Лучший режим для друзей!', teams: 'opt' }
  };
})(typeof globalThis !== 'undefined' ? (globalThis.TG = globalThis.TG || {}) : (self.TG = self.TG || {}));
