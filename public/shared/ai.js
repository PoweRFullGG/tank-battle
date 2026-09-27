/* Tank Battle Online — искусственный интеллект ботов + навигация (поле потоков). */
(function (TG) {
  'use strict';
  const U = TG.U;
  const DEG = Math.PI / 180;

  // ---------- Навигационная сетка ----------
  class NavGrid {
    constructor(map) {
      this.map = map;
      this.cell = map.w * map.h > 3000000 ? 30 : 25;
      this.cols = Math.ceil(map.w / this.cell);
      this.rows = Math.ceil(map.h / this.cell);
      const n = this.cols * this.rows;
      this.block = new Uint8Array(n);
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const x = (c + 0.5) * this.cell, y = (r + 0.5) * this.cell;
          this.block[r * this.cols + c] = TG.tankBlocked(x, y, 17, map) ? 1 : 0;
        }
      }
      this.cache = new Map();
      this.heap = new Int32Array(n * 18 + 32);
    }

    idx(x, y) {
      const c = U.clamp(Math.floor(x / this.cell), 0, this.cols - 1);
      const r = U.clamp(Math.floor(y / this.cell), 0, this.rows - 1);
      return r * this.cols + c;
    }

    freeNear(i) {
      if (!this.block[i]) return i;
      const c0 = i % this.cols, r0 = (i / this.cols) | 0;
      for (let rad = 1; rad < 8; rad++) {
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
            const r = r0 + dr, c = c0 + dc;
            if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
            const j = r * this.cols + c;
            if (!this.block[j]) return j;
          }
        }
      }
      return i;
    }

    // Дейкстра от цели; результат кэшируется на ~0.5 с
    field(tx, ty, tick) {
      const goal = this.freeNear(this.idx(tx, ty));
      const cached = this.cache.get(goal);
      if (cached && tick - cached.tick < 30) return cached.dist;
      // не больше 2 пересчётов за тик — равномерная нагрузка без «пиков»
      if (this.budgetTick !== tick) { this.budgetTick = tick; this.budget = 0; }
      if (cached && this.budget >= 2) return cached.dist;
      this.budget++;
      const cols = this.cols, rows = this.rows, n = cols * rows, block = this.block;
      const dist = cached ? cached.dist : new Int32Array(n);
      dist.fill(0x3fffffff);
      const heap = this.heap;
      let hs = 0;
      const push = (d, i) => {
        let k = hs++;
        heap[k * 2] = d; heap[k * 2 + 1] = i;
        while (k > 0) {
          const p = (k - 1) >> 1;
          if (heap[p * 2] <= heap[k * 2]) break;
          const td = heap[p * 2], ti = heap[p * 2 + 1];
          heap[p * 2] = heap[k * 2]; heap[p * 2 + 1] = heap[k * 2 + 1];
          heap[k * 2] = td; heap[k * 2 + 1] = ti;
          k = p;
        }
      };
      const pop = () => {
        const i = heap[1];
        hs--;
        if (hs > 0) {
          heap[0] = heap[hs * 2]; heap[1] = heap[hs * 2 + 1];
          let k = 0;
          for (;;) {
            const l = k * 2 + 1, r = l + 1;
            let m = k;
            if (l < hs && heap[l * 2] < heap[m * 2]) m = l;
            if (r < hs && heap[r * 2] < heap[m * 2]) m = r;
            if (m === k) break;
            const td = heap[m * 2], ti = heap[m * 2 + 1];
            heap[m * 2] = heap[k * 2]; heap[m * 2 + 1] = heap[k * 2 + 1];
            heap[k * 2] = td; heap[k * 2 + 1] = ti;
            k = m;
          }
        }
        return i;
      };
      dist[goal] = 0;
      push(0, goal);
      while (hs > 0) {
        const d0 = heap[0];
        const i = pop();
        if (d0 > dist[i]) continue;
        const c = i % cols, r = (i / cols) | 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr >= rows) continue;
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const cc = c + dc;
            if (cc < 0 || cc >= cols) continue;
            const j = rr * cols + cc;
            if (block[j]) continue;
            if (dr && dc && (block[r * cols + cc] || block[rr * cols + c])) continue; // без срезания углов
            const nd = d0 + (dr && dc ? 14 : 10);
            if (nd < dist[j]) {
              dist[j] = nd;
              if (hs * 2 + 2 < heap.length) push(nd, j);
            }
          }
        }
      }
      if (this.cache.size > 40 && !cached) {
        let oldK = null, oldT = Infinity;
        for (const [k, v] of this.cache) if (v.tick < oldT) { oldT = v.tick; oldK = k; }
        this.cache.delete(oldK);
      }
      this.cache.set(goal, { dist, tick });
      return dist;
    }

    // Единичное направление к цели в обход препятствий
    dir(t, tx, ty, tick, out) {
      const dx = tx - t.x, dy = ty - t.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) { out.x = 0; out.y = 0; return out; }
      if (TG.lineOfSight(this.map, t.x, t.y, tx, ty, t.r * 0.9)) { out.x = dx / d; out.y = dy / d; return out; }
      const dist = this.field(tx, ty, tick);
      const cols = this.cols;
      let cur = this.freeNear(this.idx(t.x, t.y));
      // спуск по полю на несколько клеток и «натягивание нити»
      let target = cur;
      for (let s = 0; s < 6; s++) {
        const c = cur % cols, r = (cur / cols) | 0;
        let best = cur, bd = dist[cur];
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= this.rows || cc >= cols) continue;
          const j = rr * cols + cc;
          if (dist[j] < bd) { bd = dist[j]; best = j; }
        }
        if (best === cur) break;
        cur = best;
        const px = (cur % cols + 0.5) * this.cell, py = (((cur / cols) | 0) + 0.5) * this.cell;
        if (s === 0 || TG.lineOfSight(this.map, t.x, t.y, px, py, t.r * 0.8)) target = cur;
        else break;
      }
      const px = (target % cols + 0.5) * this.cell, py = (((target / cols) | 0) + 0.5) * this.cell;
      const ex = px - t.x, ey = py - t.y, ed = Math.hypot(ex, ey);
      if (ed < 0.5) { out.x = dx / d; out.y = dy / d; } else { out.x = ex / ed; out.y = ey / ed; }
      return out;
    }
  }
  TG.NavGrid = NavGrid;

  const tmp = { x: 0, y: 0 };

  function nav(world) {
    if (!world.nav || world.nav.map !== world.map) world.nav = new NavGrid(world.map);
    return world.nav;
  }

  function nearestHostile(world, t, maxD) {
    let best = null, bd = maxD ? maxD * maxD : Infinity;
    for (const o of world.tanks) {
      if (!o.alive || o === t) continue;
      if (t.team !== 0 && o.team === t.team) continue;
      if (world.mode.botsIgnoreBots && o.isBot) continue;
      const d = U.dist2(t.x, t.y, o.x, o.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  TG.nearestHostile = nearestHostile;

  // «Щупальца» для обхода стен
  function feelers(world, t, mx, my) {
    const ca = Math.atan2(my, mx);
    let ax = 0, ay = 0;
    for (const off of [0, 0.7, -0.7]) {
      const cx = t.x + Math.cos(ca + off) * 60, cy = t.y + Math.sin(ca + off) * 60;
      if (TG.tankBlocked(cx, cy, 10, world.map)) { ax -= Math.cos(ca + off) * 1.5; ay -= Math.sin(ca + off) * 1.5; }
    }
    return [mx + ax, my + ay];
  }

  function separation(world, t, out) {
    for (const o of world.tanks) {
      if (o === t || !o.alive) continue;
      const dx = t.x - o.x, dy = t.y - o.y;
      const rr = t.r + o.r + 12;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 > 0.01) {
        const d = Math.sqrt(d2);
        out[0] += (dx / d) * 2.5; out[1] += (dy / d) * 2.5;
      }
    }
  }

  // Упреждение: решение квадратного уравнения перехвата
  function intercept(sx, sy, tx, ty, vx, vy, speed) {
    const dx = tx - sx, dy = ty - sy;
    const a = vx * vx + vy * vy - speed * speed;
    const b = 2 * (dx * vx + dy * vy);
    const c = dx * dx + dy * dy;
    let t;
    if (Math.abs(a) < 1e-6) t = b !== 0 ? -c / b : 0;
    else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) return [tx, ty];
      const s = Math.sqrt(disc);
      const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
      t = Math.min(t1, t2) > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
    }
    if (!(t > 0) || t > 240) return [tx, ty];
    return [tx + vx * t, ty + vy * t];
  }

  function bulletSpeedOf(world, t) {
    let s = t.lvl === 20 ? 12 : TG.C.BULLET_SPEED * t.bulletSpeedMod;
    if (t.fastUntil > world.tick) s *= 3;
    return s;
  }

  // Уклонение уровня «Матрица»
  function matrixDodge(world, t) {
    for (const b of world.bullets) {
      if (b.owner === t.id || (b.team !== 0 && b.team === t.team)) continue;
      const tx = t.x - b.x, ty = t.y - b.y;
      if (tx * tx + ty * ty > 90000) continue;
      const dot = tx * b.vx + ty * b.vy;
      if (dot <= 0) continue;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp === 0) continue;
      const ux = b.vx / sp, uy = b.vy / sp;
      const perp = Math.abs(tx * uy - ty * ux);
      if (perp < t.r + b.size + 15) {
        const side = tx * uy - ty * ux >= 0 ? 1 : -1;
        const opts = [[-uy * side, ux * side], [uy * side, -ux * side]];
        for (const [ox, oy] of opts) {
          if (!TG.tankBlocked(t.x + ox * 40, t.y + oy * 40, t.r, world.map)) return [ox * 2, oy * 2];
        }
      }
    }
    return null;
  }

  // Уклонение уровня GOD — симуляция будущих позиций пуль
  const DIRS = [[0, 0]];
  for (let i = 0; i < 8; i++) DIRS.push([Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
  function godDodge(world, t) {
    const threats = [];
    for (const b of world.bullets) {
      if (b.owner === t.id || (b.team !== 0 && b.team === t.team)) continue;
      const tx = t.x - b.x, ty = t.y - b.y;
      if (tx * tx + ty * ty > 250000) continue;
      if (tx * b.vx + ty * b.vy <= 0) continue;
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const perp = Math.abs(tx * b.vy - ty * b.vx) / sp;
      if (perp < t.r + b.size + 30) threats.push(b);
    }
    if (!threats.length) return null;
    let best = null, bestScore = -Infinity;
    for (const [dx, dy] of DIRS) {
      let x = t.x, y = t.y, minClear = Infinity, blocked = false;
      for (let s = 1; s <= 18; s++) {
        const nx = x + dx * t.speed, ny = y + dy * t.speed;
        if (TG.tankBlocked(nx, ny, t.r, world.map)) { blocked = true; break; }
        x = nx; y = ny;
        for (const b of threats) {
          const bx = b.x + b.vx * s, by = b.y + b.vy * s;
          const c = Math.hypot(bx - x, by - y) - t.r - b.size;
          if (c < minClear) minClear = c;
        }
      }
      const score = (blocked ? -200 : 0) + Math.min(minClear, 80) - (dx === 0 && dy === 0 ? 5 : 0);
      if (score > bestScore) { bestScore = score; best = [dx * 1.5, dy * 1.5]; }
    }
    if (bestScore > 60 && best[0] === 0 && best[1] === 0) return null;
    return best;
  }

  // ---------- ИИ уровней (Уровни / Волны / Выживание) ----------
  TG.AI = {};
  TG.AI.levelBot = function (world, t) {
    const cfg = TG.LEVELS[t.lvl] || TG.LEVELS[1];
    const ai = t.ai, tick = world.tick;
    if (!ai.target || !ai.target.alive || tick >= (ai.retarget || 0)) {
      ai.target = nearestHostile(world, t);
      ai.retarget = tick + 30;
    }
    const tg = ai.target;
    let mv = null;

    if (tg) {
      if (cfg.move === 'god') mv = godDodge(world, t);
      else if (cfg.matrix) mv = matrixDodge(world, t);
    }

    if (!mv && cfg.seek && world.boosts.length && !t.noBoosts) {
      let nb = null, nd = 160000;
      for (const b of world.boosts) { const d = U.dist2(t.x, t.y, b.x, b.y); if (d < nd) { nd = d; nb = b; } }
      if (nb) { nav(world).dir(t, nb.x, nb.y, tick, tmp); mv = [tmp.x, tmp.y]; }
    }

    if (!mv) {
      const mode = cfg.move;
      if (mode === 'random' || !tg) {
        ai.mt = (ai.mt || 0) + 1;
        if (ai.mt > 60 || !ai.rd) { const a = Math.random() * Math.PI * 2; ai.rd = [Math.cos(a), Math.sin(a)]; ai.mt = 0; }
        if (TG.tankBlocked(t.x + ai.rd[0] * 30, t.y + ai.rd[1] * 30, t.r, world.map)) ai.mt = 999;
        mv = [ai.rd[0], ai.rd[1]];
      } else if (mode === 'static') {
        mv = [0, 0];
      } else if (mode === 'god') {
        const d = Math.hypot(tg.x - t.x, tg.y - t.y);
        const los = TG.lineOfSight(world.map, t.x, t.y, tg.x, tg.y, 6);
        if (!los && d > 250) { nav(world).dir(t, tg.x, tg.y, tick, tmp); mv = [tmp.x * 0.8, tmp.y * 0.8]; }
        else if (d < 380) mv = [(t.x - tg.x) / d, (t.y - tg.y) / d];
        else if (d > 520) mv = [(tg.x - t.x) / d * 0.7, (tg.y - t.y) / d * 0.7];
        else {
          const s = ai.strafe || (ai.strafe = 1);
          mv = [(-(tg.y - t.y) / d) * s, ((tg.x - t.x) / d) * s];
          if (TG.tankBlocked(t.x + mv[0] * 30, t.y + mv[1] * 30, t.r, world.map)) ai.strafe = -s;
        }
      } else {
        const d = Math.hypot(tg.x - t.x, tg.y - t.y) || 1;
        const los = TG.lineOfSight(world.map, t.x, t.y, tg.x, tg.y, 4);
        if (!los) {
          nav(world).dir(t, tg.x, tg.y, tick, tmp); mv = [tmp.x, tmp.y];
        } else {
          const berserk = mode === 'berserk';
          const near = berserk ? 90 : 170, far = berserk ? 110 : 300;
          if (d > far) mv = feelers(world, t, (tg.x - t.x) / d, (tg.y - t.y) / d);
          else if (d < near && !berserk) mv = feelers(world, t, (t.x - tg.x) / d, (t.y - tg.y) / d);
          else {
            if (!ai.strafe || tick >= (ai.strafeT || 0)) { ai.strafe = Math.random() < 0.5 ? 1 : -1; ai.strafeT = tick + U.randInt(80, 160); }
            mv = [(-(tg.y - t.y) / d) * ai.strafe, ((tg.x - t.x) / d) * ai.strafe];
            if (TG.tankBlocked(t.x + mv[0] * 30, t.y + mv[1] * 30, t.r, world.map)) ai.strafe = -ai.strafe;
            if (berserk) { mv[0] += (tg.x - t.x) / d * 0.5; mv[1] += (tg.y - t.y) / d * 0.5; }
          }
        }
      }
    }

    separation(world, t, mv);
    TG.moveTank(t, mv[0], mv[1], world.map);

    // Прицеливание
    if (cfg.aim === 'random' || !tg) {
      t.a += 2 * DEG;
      if (t.a > Math.PI) t.a -= Math.PI * 2;
    } else {
      let ax = tg.x, ay = tg.y;
      const bs = bulletSpeedOf(world, t);
      if (cfg.aim === 'predictive') {
        const d = Math.hypot(tg.x - t.x, tg.y - t.y);
        const tt = d / bs;
        ax += tg.vx * tt; ay += tg.vy * tt;
      } else if (cfg.aim === 'god') {
        [ax, ay] = intercept(t.x, t.y, tg.x, tg.y, tg.vx, tg.vy, bs);
      }
      t.a = Math.atan2(ay - t.y, ax - t.x);
    }
    if (t.cd <= 0 && (tg || cfg.aim === 'random')) world.fire(t, 0);
  };

  // ---------- Тактический ИИ (Захват флага / Арена) ----------
  const DIFF = {
    1: { aim: 0.5, react: 48, turn: 2 * DEG, view: 650, rate: 70, dodge: 0 },
    2: { aim: 0.7, react: 36, turn: 4 * DEG, view: 800, rate: 58, dodge: 0.2 },
    3: { aim: 0.9, react: 24, turn: 6 * DEG, view: 950, rate: 45, dodge: 0.5 },
    4: { aim: 1.0, react: 12, turn: 10 * DEG, view: 1100, rate: 34, dodge: 0.85 }
  };
  TG.AI.DIFF = DIFF;

  TG.AI.visibleEnemies = function (world, t, view) {
    const res = [];
    const v2 = view * view;
    for (const o of world.tanks) {
      if (!o.alive || o === t) continue;
      if (t.team !== 0 && o.team === t.team) continue;
      const d2 = U.dist2(t.x, t.y, o.x, o.y);
      if (d2 > v2) continue;
      if (!TG.lineOfSight(world.map, t.x, t.y, o.x, o.y, 6)) continue;
      res.push({ d: Math.sqrt(d2), t: o });
    }
    res.sort((a, b) => a.d - b.d);
    return res;
  };

  // goal: {x,y} — куда идти; shoot: танк-цель или null
  TG.AI.tactical = function (world, t, goal, shoot, diffLvl) {
    const S = DIFF[diffLvl] || DIFF[2];
    const tick = world.tick, ai = t.ai;
    let mv = [0, 0];
    if (goal) {
      const d = Math.hypot(goal.x - t.x, goal.y - t.y);
      if (d > (goal.stop || 8)) { nav(world).dir(t, goal.x, goal.y, tick, tmp); mv = [tmp.x, tmp.y]; }
    }
    if (S.dodge && Math.random() < S.dodge) {
      const dg = matrixDodge(world, t);
      if (dg) { ai.dodge = dg; ai.dodgeT = tick + 10; }
    }
    if (ai.dodge && tick < ai.dodgeT) { mv[0] = mv[0] * 0.3 + ai.dodge[0]; mv[1] = mv[1] * 0.3 + ai.dodge[1]; }
    for (const o of world.tanks) {
      if (o === t || !o.alive) continue;
      const dx = t.x - o.x, dy = t.y - o.y, d2 = dx * dx + dy * dy;
      if (d2 < 3600 && d2 > 0.01) { const d = Math.sqrt(d2); mv[0] += (dx / d) * 1.2; mv[1] += (dy / d) * 1.2; }
    }
    const ml = Math.hypot(mv[0], mv[1]);
    if (ml > 0.05) TG.moveTank(t, mv[0] / ml, mv[1] / ml, world.map);

    let ax, ay, want = false;
    if (shoot && shoot.alive) {
      const d = Math.hypot(shoot.x - t.x, shoot.y - t.y);
      const tt = d / bulletSpeedOf(world, t);
      ax = shoot.x + shoot.vx * tt * S.aim;
      ay = shoot.y + shoot.vy * tt * S.aim;
      want = true;
    } else if (ml > 0.05) {
      ax = t.x + mv[0] * 100; ay = t.y + mv[1] * 100;
    }
    let diff = 0;
    if (ax != null) {
      const desired = Math.atan2(ay - t.y, ax - t.x);
      diff = U.angDiff(desired, t.a);
      if (Math.abs(diff) <= S.turn) t.a = desired;
      else t.a += diff > 0 ? S.turn : -S.turn;
      if (t.a > Math.PI) t.a -= Math.PI * 2; else if (t.a < -Math.PI) t.a += Math.PI * 2;
    }
    if (want && Math.abs(diff) < 20 * DEG && t.cd <= 0 && tick - (ai.lastTry || -999) > S.react) {
      world.fire(t, 0);
      ai.lastTry = tick;
    }
  };
})(typeof globalThis !== 'undefined' ? (globalThis.TG = globalThis.TG || {}) : (self.TG = self.TG || {}));
