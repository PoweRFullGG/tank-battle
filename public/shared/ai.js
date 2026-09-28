/* Tank Battle Online — искусственный интеллект ботов.
   Навигация (поле потоков с учётом разрушаемых блоков) + «мозг» бота:
   восприятие и память, выбор цели, уклонение от пуль симуляцией, упреждение, стрельба рикошетом,
   фланги, укрытия, отступление, анти-застревание, особые умения (очереди, дробь, лечение, кольцо, вызов). */
(function (TG) {
  'use strict';
  const U = TG.U;
  const TAU = Math.PI * 2;

  // ======================================================================
  // Навигационная сетка: 0 — свободно, 1 — стена, 2 — разрушаемый блок (проходим «с трудом»)
  // ======================================================================
  class NavGrid {
    constructor(map) {
      this.map = map;
      this.cell = map.w * map.h > 3000000 ? 30 : 25;
      this.cols = Math.ceil(map.w / this.cell);
      this.rows = Math.ceil(map.h / this.cell);
      const n = this.cols * this.rows;
      this.block = new Uint8Array(n);
      this.cache = new Map();
      this.heap = new Int32Array(n * 18 + 32);
      this.fillRect(0, 0, this.cols - 1, this.rows - 1);
    }

    cellValue(x, y) {
      const map = this.map, r = 17;
      if (x < r || y < r || x > map.w - r || y > map.h - r) return 1;
      let v = 0;
      for (const o of map.obstacles) {
        if (x + r <= o.x || x - r >= o.x + o.w || y + r <= o.y || y - r >= o.y + o.h) continue;
        if (!TG.circleRect(x, y, r, o)) continue;
        if (!o.dyn || o.core) return 1;
        v = 2;
      }
      return v;
    }

    fillRect(c0, r0, c1, r1) {
      for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
        for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) {
          this.block[r * this.cols + c] = this.cellValue((c + 0.5) * this.cell, (r + 0.5) * this.cell);
        }
      }
    }

    // Препятствие изменилось (поставили/сломали блок)
    update(o) {
      const cs = this.cell, pad = 20;
      this.fillRect(Math.floor((o.x - pad) / cs), Math.floor((o.y - pad) / cs), Math.floor((o.x + o.w + pad) / cs), Math.floor((o.y + o.h + pad) / cs));
      this.cache.clear();
    }

    idx(x, y) {
      const c = U.clamp(Math.floor(x / this.cell), 0, this.cols - 1);
      const r = U.clamp(Math.floor(y / this.cell), 0, this.rows - 1);
      return r * this.cols + c;
    }

    freeNear(i) {
      if (this.block[i] !== 1) return i;
      const c0 = i % this.cols, r0 = (i / this.cols) | 0;
      for (let rad = 1; rad < 10; rad++) {
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            if (Math.abs(dr) !== rad && Math.abs(dc) !== rad) continue;
            const r = r0 + dr, c = c0 + dc;
            if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) continue;
            const j = r * this.cols + c;
            if (this.block[j] !== 1) return j;
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
            const bj = block[j];
            if (bj === 1) continue;
            if (dr && dc && (block[r * cols + cc] === 1 || block[rr * cols + c] === 1)) continue; // без срезания углов
            const nd = d0 + (dr && dc ? 14 : 10) + (bj === 2 ? 70 : 0);
            if (nd < dist[j]) {
              dist[j] = nd;
              if (hs * 2 + 2 < heap.length) push(nd, j);
            }
          }
        }
      }
      if (!cached && this.cache.size > 40) {
        let oldK = null, oldT = Infinity;
        for (const [k, v] of this.cache) if (v.tick < oldT) { oldT = v.tick; oldK = k; }
        this.cache.delete(oldK);
      }
      this.cache.set(goal, { dist, tick });
      return dist;
    }

    reachable(tx, ty, fx, fy, tick) {
      const dist = this.field(tx, ty, tick);
      return dist[this.freeNear(this.idx(fx, fy))] < 0x3fffffff;
    }

    // Единичное направление к цели в обход препятствий. out.breach — блок, который надо сломать
    dir(t, tx, ty, tick, out) {
      out.breach = null;
      const dx = tx - t.x, dy = ty - t.y;
      const d = Math.hypot(dx, dy);
      if (d < 1) { out.x = 0; out.y = 0; return out; }
      if (TG.lineOfSight(this.map, t.x, t.y, tx, ty, t.r * 0.9)) { out.x = dx / d; out.y = dy / d; return out; }
      const dist = this.field(tx, ty, tick);
      const cols = this.cols;
      let cur = this.freeNear(this.idx(t.x, t.y));
      let target = cur, first = -1;
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
        if (first < 0) first = cur;
        if (this.block[cur] === 2) { if (s === 0) target = cur; break; }
        const px = (cur % cols + 0.5) * this.cell, py = (((cur / cols) | 0) + 0.5) * this.cell;
        if (s === 0 || TG.lineOfSight(this.map, t.x, t.y, px, py, t.r * 0.8)) target = cur;
        else break;
      }
      const px = (target % cols + 0.5) * this.cell, py = (((target / cols) | 0) + 0.5) * this.cell;
      if (first >= 0 && this.block[first] === 2) {
        // следующий шаг — через блок: ищем его, чтобы разрушить
        const fx = (first % cols + 0.5) * this.cell, fy = (((first / cols) | 0) + 0.5) * this.cell;
        for (const o of this.map.obstacles) if (o.dyn && !o.core && TG.circleRect(fx, fy, 20, o)) { out.breach = o; break; }
      }
      const ex = px - t.x, ey = py - t.y, ed = Math.hypot(ex, ey);
      if (ed < 0.5) { out.x = dx / d; out.y = dy / d; } else { out.x = ex / ed; out.y = ey / ed; }
      return out;
    }
  }
  TG.NavGrid = NavGrid;

  function nav(world) {
    if (!world.nav || world.nav.map !== world.map) world.nav = new NavGrid(world.map);
    return world.nav;
  }
  TG.nav = nav;

  // ======================================================================
  // Вспомогательные функции
  // ======================================================================
  const tmp = { x: 0, y: 0, breach: null };

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
  TG.intercept = intercept;

  function feelers(world, t, mx, my) {
    const ca = Math.atan2(my, mx);
    let ax = 0, ay = 0;
    for (const off of [0, 0.7, -0.7]) {
      const cx = t.x + Math.cos(ca + off) * 55, cy = t.y + Math.sin(ca + off) * 55;
      if (TG.tankBlocked(cx, cy, 10, world.map)) { ax -= Math.cos(ca + off) * 1.4; ay -= Math.sin(ca + off) * 1.4; }
    }
    return [mx + ax, my + ay];
  }

  function hostile(world, a, b) { return a !== b && (a.team === 0 || b.team === 0 || a.team !== b.team); }

  function rangeOf(t) {
    if (t.kd) return t.kd.range;
    return [200, 400];
  }

  // ======================================================================
  // Восприятие: видимые враги + память о последних позициях
  // ======================================================================
  function perceive(world, t) {
    const ai = t.ai, tick = world.tick;
    if (ai.pT && tick - ai.pT < 5 && ai.vis) return ai.vis;
    ai.pT = tick;
    if (!ai.mem) ai.mem = new Map();
    const sk = t.sk || TG.DIFF[2].sk;
    const view2 = sk.view * sk.view;
    const vis = [];
    for (const o of world.tanks) {
      if (!o.alive || !hostile(world, t, o)) continue;
      if (world.mode.botsIgnoreBots && o.isBot) continue;
      const d2 = U.dist2(t.x, t.y, o.x, o.y);
      if (d2 > view2) continue;
      if (o.invisUntil > tick && d2 > 110 * 110) continue;
      if (!TG.lineOfSight(world.map, t.x, t.y, o.x, o.y, 3)) continue;
      vis.push({ d: Math.sqrt(d2), t: o });
      ai.mem.set(o.id, { x: o.x, y: o.y, tick, t: o });
    }
    vis.sort((a, b) => a.d - b.d);
    ai.vis = vis;
    if (ai.mem.size > 30) for (const [k, m] of ai.mem) if (tick - m.tick > 600 || !m.t.alive) ai.mem.delete(k);
    return vis;
  }

  // Бота подстрелили — он «слышит», откуда стреляли
  function alert(t, src, tick) {
    if (!t.isBot || !src || !src.id || !src.alive) return;
    const ai = t.ai;
    if (!ai.mem) ai.mem = new Map();
    ai.mem.set(src.id, { x: src.x, y: src.y, tick, t: src });
    ai.alert = src;
    ai.alertT = tick;
  }

  // ======================================================================
  // Уклонение: симуляция будущих позиций опасных пуль
  // ======================================================================
  const DIRS = [[0, 0]];
  for (let i = 0; i < 12; i++) DIRS.push([Math.cos(i * TAU / 12), Math.sin(i * TAU / 12)]);

  function threatsFor(world, t, sk) {
    const res = [];
    const pad = t.r + 8;
    for (const b of world.bullets) {
      if (b.owner === t.id || (b.team !== 0 && b.team === t.team)) continue;
      const dx = t.x - b.x, dy = t.y - b.y;
      if (dx * dx + dy * dy > 420 * 420) continue;
      const v2 = b.vx * b.vx + b.vy * b.vy;
      if (v2 < 0.01) continue;
      const tca = (dx * b.vx + dy * b.vy) / v2;
      if (tca < 0 || tca > 45) continue;
      const cx = b.x + b.vx * tca - t.x, cy = b.y + b.vy * tca - t.y;
      if (cx * cx + cy * cy > (pad + b.size + 22) ** 2) continue;
      // стена между пулей и нами — не угроза (отскок не учитываем)
      if (!TG.lineOfSight(world.map, b.x, b.y, t.x, t.y, 0)) continue;
      res.push(b);
    }
    return res;
  }

  function dodgeDir(world, t, threats, intentX, intentY) {
    let best = null, bestScore = -Infinity;
    const sp = Math.max(t.speed, 0.1);
    for (const [dx, dy] of DIRS) {
      let x = t.x, y = t.y, minClear = Infinity, blocked = false;
      for (let s = 1; s <= 18; s++) {
        const nx = x + dx * sp, ny = y + dy * sp;
        if (!blocked && (s % 3 === 0 || s === 1) && (dx || dy) && TG.tankBlocked(nx, ny, t.r, world.map)) blocked = true;
        if (!blocked) { x = nx; y = ny; }
        for (const b of threats) {
          const c = Math.hypot(b.x + b.vx * s - x, b.y + b.vy * s - y) - t.r - b.size;
          if (c < minClear) minClear = c;
        }
      }
      const score = Math.min(minClear, 70) + (dx * intentX + dy * intentY) * 6 - (blocked ? 25 : 0);
      if (score > bestScore) { bestScore = score; best = [dx, dy, minClear]; }
    }
    return best;
  }

  // ======================================================================
  // Стрельба рикошетом: перебор углов с детерминированной симуляцией пули
  // ======================================================================
  function ricochetSolve(world, t, tg, lead) {
    const bspd = world.bulletSpeed(t);
    const size = TG.C.BULLET_SIZE * t.bsize;
    const d0 = Math.hypot(tg.x - t.x, tg.y - t.y);
    const maxT = Math.min(100, Math.ceil((d0 * 2.4) / bspd) + 12);
    const N = 44;
    const b = { x: 0, y: 0, vx: 0, vy: 0, size, hitObs: null };
    let bestA = null, bestT = Infinity;
    const hitR = tg.r + size - 2;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU + (world.tick % 7) * 0.01;
      const c = Math.cos(a), s = Math.sin(a);
      b.x = t.x + c * (t.r + 4); b.y = t.y + s * (t.r + 4); b.vx = c * bspd; b.vy = s * bspd; b.hitObs = null;
      if (TG.bulletBlocked(b.x, b.y, size, world.map)) continue;
      let bounces = 0;
      for (let st = 1; st <= maxT; st++) {
        if (TG.stepBullet(b, world.map)) bounces++;
        if (b.hitObs || bounces > 2) break;
        if (bounces === 0 && st > 20 && (b.x - t.x) * (b.x - t.x) + (b.y - t.y) * (b.y - t.y) > d0 * d0 * 2.2) break;
        const tx = tg.x + tg.vx * st * lead, ty = tg.y + tg.vy * st * lead;
        const ddx = b.x - tx, ddy = b.y - ty;
        if (ddx * ddx + ddy * ddy < hitR * hitR) {
          if (bounces > 0 && st < bestT) { bestT = st; bestA = a; }
          break;
        }
      }
    }
    return bestA;
  }

  // ======================================================================
  // Укрытие: точка рядом, невидимая для угрозы
  // ======================================================================
  function findCover(world, t, threat) {
    let best = null, bd = Infinity;
    for (let ring = 90; ring <= 270; ring += 60) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        const x = t.x + Math.cos(a) * ring, y = t.y + Math.sin(a) * ring;
        if (TG.tankBlocked(x, y, t.r + 3, world.map)) continue;
        if (TG.lineOfSight(world.map, threat.x, threat.y, x, y, 6)) continue;
        const d = ring + Math.max(0, 300 - Math.hypot(threat.x - x, threat.y - y)) * 0.5;
        if (d < bd) { bd = d; best = { x, y }; }
      }
      if (best) break;
    }
    return best;
  }

  function nearestBoost(world, t, maxD, wantHealth) {
    let best = null, bd = maxD * maxD;
    for (const b of world.boosts) {
      if (TG.ITEMS[b.type]) continue;
      if (wantHealth && b.type !== 'health' && b.type !== 'shield') continue;
      const d = U.dist2(t.x, t.y, b.x, b.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ======================================================================
  // Особые умения типов ботов
  // ======================================================================
  function specials(world, t, tgt) {
    const kd = t.kd, ai = t.ai, tick = world.tick;
    if (!kd) return;
    if (kd.heal) {
      ai.healT = (ai.healT || 0) + 1;
      if (ai.healT >= kd.heal.every) {
        ai.healT = 0;
        let healed = false;
        for (const o of world.tanks) {
          if (!o.alive || o === t || hostile(world, t, o) || o.hp >= o.maxHp) continue;
          if (U.dist2(o.x, o.y, t.x, t.y) > kd.heal.rad * kd.heal.rad) continue;
          o.hp++;
          healed = true;
          world.emit({ k: 'heal', x: o.x, y: o.y, tid: o.id });
        }
        if (healed) world.emit({ k: 'heal', x: t.x, y: t.y, tid: t.id, src: 1 });
      }
    }
    if (kd.ring && tgt) {
      ai.ringT = (ai.ringT || 0) + 1;
      if (ai.ringT >= kd.ring.every && Math.hypot(tgt.x - t.x, tgt.y - t.y) < 800) {
        ai.ringT = 0;
        const spd = world.bulletSpeed(t) * 0.8;
        const off = Math.random() * TAU;
        for (let i = 0; i < kd.ring.n; i++) world.spawnBullet(t, off + (i / kd.ring.n) * TAU, spd, TG.C.BULLET_SIZE * 1.3, 1, false, 0);
        world.emit({ k: 'ring', x: t.x, y: t.y, tid: t.id });
      }
    }
    if (kd.summon && !ai.summoned && t.hp <= t.maxHp * kd.summon.at) {
      ai.summoned = true;
      for (let i = 0; i < kd.summon.n; i++) {
        const a = Math.random() * TAU;
        const pos = TG.findSpot(world.map, { r: 22, region: { x: t.x - 160, y: t.y - 160, w: 320, h: 320 }, avoidTanks: world.tanks });
        const s = world.createBot(kd.summon.kind, pos, t.team, { cd: 60 });
        s.a = a;
      }
      world.emit({ k: 'msg', text: `${t.name} вызывает подкрепление!`, c: kd.c });
    }
  }

  // ======================================================================
  // МОЗГ БОТА
  // orders: { goal:{x,y,stop}, urgent, focus, structure:{x,y,obs}, hold, noChase }
  // ======================================================================
  function brain(world, t, orders) {
    orders = orders || {};
    const ai = t.ai, tick = world.tick;
    const sk = t.sk || TG.DIFF[2].sk;
    const kd = t.kd;
    const vis = perceive(world, t);
    const map = world.map;

    // ---- выбор цели ----
    let tgt = null, bestS = Infinity;
    for (const v of vis) {
      const o = v.t;
      let s = v.d + o.hp * 30;
      if (o.carrying) s -= 500;
      if (orders.focus === o) s -= 800;
      if (o === ai.tgt) s -= 140;
      if (o.kd && o.kd.turret) s += 200;
      if (s < bestS) { bestS = s; tgt = o; }
    }
    if (tgt !== ai.tgt) {
      if (tgt && (!ai.tgt || !ai.tgtSeenRecently)) ai.engageAt = tick + Math.round(sk.react * U.rand(0.7, 1.3));
      ai.tgt = tgt;
    }
    ai.tgtSeenRecently = !!tgt;
    // память: последнее известное положение врага
    let hunt = null;
    if (!tgt && ai.mem && !orders.noChase) {
      let bt = -1;
      for (const m of ai.mem.values()) {
        if (!m.t.alive || tick - m.tick > 420) continue;
        if (m.tick > bt) { bt = m.tick; hunt = m; }
      }
    }

    specials(world, t, tgt || (hunt && hunt.t));

    // ---- движение ----
    let mv = [0, 0], breach = null, lookX = null, lookY = null;
    const moving = t.baseSpeed > 0;
    if (moving) {
      // уклонение
      let dodging = false;
      if (sk.dodge > 0) {
        if (ai.dodgeUntil > tick && ai.dodge) { mv = [ai.dodge[0], ai.dodge[1]]; dodging = true; }
        else if (tick % 2 === (t.id & 1)) {
          const threats = threatsFor(world, t, sk);
          if (threats.length) {
            if (!ai.seen) ai.seen = new Map();
            let react = false;
            for (const b of threats) {
              let dec = ai.seen.get(b.id);
              if (dec === undefined) { dec = Math.random() < sk.dodge; ai.seen.set(b.id, dec); }
              if (dec) react = true;
            }
            if (ai.seen.size > 80) ai.seen.clear();
            if (react) {
              const intent = ai.lastMv || [0, 0];
              const dd = dodgeDir(world, t, threats, intent[0], intent[1]);
              if (dd && (dd[0] || dd[1])) { ai.dodge = dd; ai.dodgeUntil = tick + (kd && kd.god ? 4 : 8); mv = [dd[0], dd[1]]; dodging = true; }
            }
          }
        }
      }

      if (!dodging) {
        const [rMin, rMax] = rangeOf(t);
        const lowHp = t.maxHp > 1 && t.hp <= Math.max(1, Math.floor(t.maxHp * 0.34));
        let goal = null, direct = null;
        if (orders.urgent && orders.goal) goal = orders.goal;
        else if (tgt) {
          const d = Math.hypot(tgt.x - t.x, tgt.y - t.y);
          const hb = lowHp ? nearestBoost(world, t, 520, true) : null;
          if (hb) goal = { x: hb.x, y: hb.y, stop: 2 };
          else if (lowHp && sk.cover && t.cd > 8) {
            if (!ai.cover || tick > ai.coverT) { ai.cover = findCover(world, t, tgt); ai.coverT = tick + 40; }
            if (ai.cover) goal = { x: ai.cover.x, y: ai.cover.y, stop: 6 };
          }
          if (!goal && kd && kd.heal) {
            // медик держится за спинами союзников
            let cx = 0, cy = 0, n = 0;
            for (const o of world.tanks) if (o.alive && o !== t && !hostile(world, t, o) && U.dist2(o.x, o.y, t.x, t.y) < 600 * 600) { cx += o.x; cy += o.y; n++; }
            if (n) {
              cx /= n; cy /= n;
              const ax = cx - tgt.x, ay = cy - tgt.y, al = Math.hypot(ax, ay) || 1;
              goal = { x: cx + ax / al * 130, y: cy + ay / al * 130, stop: 30 };
            }
          }
          if (!goal) {
            if (d > rMax) {
              // сближение с фланга
              if (ai.flankA == null) ai.flankA = sk.flank ? U.rand(0.5, 1.2) * (Math.random() < 0.5 ? -1 : 1) : 0;
              const base = Math.atan2(t.y - tgt.y, t.x - tgt.x) + ai.flankA * 0.5;
              const want = (rMin + rMax) / 2;
              let gx = tgt.x + Math.cos(base) * want, gy = tgt.y + Math.sin(base) * want;
              gx = U.clamp(gx, 40, map.w - 40); gy = U.clamp(gy, 40, map.h - 40);
              goal = { x: gx, y: gy, stop: 20 };
            } else if (d < rMin) {
              direct = [(t.x - tgt.x) / d, (t.y - tgt.y) / d];
              if (rMin <= 0) direct = null;
            } else {
              // стрейф вокруг цели
              if (!ai.strafe || tick >= ai.strafeT) { ai.strafe = Math.random() < 0.5 ? 1 : -1; ai.strafeT = tick + U.randInt(50, 140); }
              const px = -(tgt.y - t.y) / d * ai.strafe, py = (tgt.x - t.x) / d * ai.strafe;
              const mid = (rMin + rMax) / 2;
              const radial = d < mid ? -0.35 : 0.35;
              direct = [px + (tgt.x - t.x) / d * radial, py + (tgt.y - t.y) / d * radial];
              if (TG.tankBlocked(t.x + direct[0] * 34, t.y + direct[1] * 34, t.r, map)) { ai.strafe = -ai.strafe; ai.strafeT = tick + 60; }
              if (kd && kd.key === 'rusher') direct = [(tgt.x - t.x) / d, (tgt.y - t.y) / d];
            }
          }
        } else if (hunt) {
          if (Math.hypot(hunt.x - t.x, hunt.y - t.y) < 50) ai.mem.delete(hunt.t.id);
          else goal = { x: hunt.x, y: hunt.y, stop: 30 };
          // по пути подбираем бонус, если он рядом
          const nb = nearestBoost(world, t, 180, false);
          if (nb) goal = { x: nb.x, y: nb.y, stop: 2 };
        } else if (orders.goal) {
          goal = orders.goal;
        } else {
          const nb = nearestBoost(world, t, 480, false);
          if (nb) goal = { x: nb.x, y: nb.y, stop: 2 };
          else {
            if (!ai.wander || tick > ai.wanderT || Math.hypot(ai.wander.x - t.x, ai.wander.y - t.y) < 40) {
              ai.wander = TG.findSpot(map, { r: 22 });
              ai.wanderT = tick + 360;
            }
            goal = { x: ai.wander.x, y: ai.wander.y, stop: 30 };
          }
        }
        if (goal && orders.hold && orders.goal && goal !== orders.goal) {
          // «держать позицию»: не уходить далеко от точки
          if (Math.hypot(goal.x - orders.goal.x, goal.y - orders.goal.y) > (orders.hold || 260)) goal = orders.goal;
        }
        if (goal) {
          const gd = Math.hypot(goal.x - t.x, goal.y - t.y);
          if (gd > (goal.stop || 8)) {
            nav(world).dir(t, goal.x, goal.y, tick, tmp);
            mv = [tmp.x, tmp.y];
            breach = tmp.breach;
          }
        } else if (direct) {
          mv = feelers(world, t, direct[0], direct[1]);
        }
      }

      // разводим союзников, чтобы не ехали «паровозиком»
      for (const o of world.tanks) {
        if (o === t || !o.alive) continue;
        const dx = t.x - o.x, dy = t.y - o.y, d2 = dx * dx + dy * dy;
        const rr = t.r + o.r + 16;
        if (d2 < rr * rr && d2 > 0.01) { const d = Math.sqrt(d2); mv[0] += (dx / d) * 1.4; mv[1] += (dy / d) * 1.4; }
      }

      // анти-застревание
      if (!ai.stk) ai.stk = { x: t.x, y: t.y, tick, n: 0 };
      if (ai.escapeUntil > tick) mv = [ai.esc[0], ai.esc[1]];
      else if (tick - ai.stk.tick >= 30) {
        const moved = Math.hypot(t.x - ai.stk.x, t.y - ai.stk.y);
        const wanted = Math.hypot(mv[0], mv[1]) > 0.3;
        ai.stk.n = wanted && moved < 10 ? ai.stk.n + 1 : 0;
        if (ai.stk.n >= 2) {
          const a = Math.random() * TAU;
          ai.esc = [Math.cos(a), Math.sin(a)]; ai.escapeUntil = tick + 30; ai.stk.n = 0;
          ai.wander = null; ai.cover = null;
        }
        ai.stk.x = t.x; ai.stk.y = t.y; ai.stk.tick = tick;
      }

      const ml = Math.hypot(mv[0], mv[1]);
      if (ml > 0.05) {
        TG.moveTank(t, mv[0] / ml, mv[1] / ml, map);
        ai.lastMv = [mv[0] / ml, mv[1] / ml];
        lookX = t.x + mv[0] / ml * 100; lookY = t.y + mv[1] / ml * 100;
      }
    }

    // ---- прицеливание и стрельба ----
    let desired = null, canFire = false, tol = 0.12;
    if (tgt && tick >= (ai.engageAt || 0)) {
      const bspd = world.bulletSpeed(t);
      const [px, py] = intercept(t.x, t.y, tgt.x, tgt.y, tgt.vx * sk.lead, tgt.vy * sk.lead, bspd);
      if (!ai.noiseUntil || tick >= ai.noiseUntil) { ai.noise = U.gauss() * sk.aimErr; ai.noiseUntil = tick + 18; }
      desired = Math.atan2(py - t.y, px - t.x) + ai.noise;
      const d = Math.hypot(tgt.x - t.x, tgt.y - t.y);
      tol = Math.max(0.05, Math.atan2(tgt.r * 0.9, d));
      canFire = true;
      // не стреляем «в стену» прямо перед собой
      if (!TG.lineOfSight(map, t.x, t.y, px, py, 2)) {
        const [dx2, dy2] = [Math.cos(desired) * 60, Math.sin(desired) * 60];
        if (!TG.lineOfSight(map, t.x, t.y, t.x + dx2, t.y + dy2, 0)) canFire = false;
      }
      ai.rico = null;
    } else if (sk.rico && !tgt && t.cd <= 0) {
      // стрельба рикошетом по недавно виденной цели (из-за укрытия)
      const m = hunt || (ai.alert && ai.alert.alive && tick - ai.alertT < 200 ? { t: ai.alert } : null);
      if (m && m.t.alive && Math.hypot(m.t.x - t.x, m.t.y - t.y) < 750) {
        if (!ai.rico || tick >= ai.rico.until || ai.rico.id !== m.t.id) {
          // общий бюджет: не больше 2 расчётов рикошета за тик на весь мир
          if (world._ricoT !== tick) { world._ricoT = tick; world._ricoN = 0; }
          if (world._ricoN < 2) {
            world._ricoN++;
            const a = ricochetSolve(world, t, m.t, sk.lead);
            ai.rico = { a, until: tick + (a == null ? 30 : 16), id: m.t.id };
          }
        }
        if (ai.rico && ai.rico.a != null) { desired = ai.rico.a; canFire = true; tol = 0.03; }
      }
    }
    if (desired == null && orders.structure) {
      const s = orders.structure;
      if (Math.hypot(s.x - t.x, s.y - t.y) < 650 && TG.lineOfSight(map, t.x, t.y, s.x, s.y, 2, s.obs)) {
        desired = Math.atan2(s.y - t.y, s.x - t.x); canFire = true; tol = 0.1;
      }
    }
    if (desired == null && breach) {
      desired = Math.atan2(breach.y + breach.h / 2 - t.y, breach.x + breach.w / 2 - t.x); canFire = true; tol = 0.15;
    }
    if (desired == null && lookX != null) desired = Math.atan2(lookY - t.y, lookX - t.x);

    if (desired != null) {
      const diff = U.angDiff(desired, t.a);
      if (Math.abs(diff) <= sk.turn) t.a = desired;
      else t.a += diff > 0 ? sk.turn : -sk.turn;
      if (t.a > Math.PI) t.a -= TAU; else if (t.a < -Math.PI) t.a += TAU;
      if (canFire && t.cd <= 0 && Math.abs(U.angDiff(desired, t.a)) <= tol) {
        world.fire(t, 0);
        if (kd && kd.burst) {
          t.shots++;
          if (t.shots >= kd.burst.n) { t.shots = 0; t.cd = kd.burst.rest; }
        }
      }
    }
  }

  TG.AI = { brain, perceive, alert, intercept, ricochetSolve, findCover };
})(typeof globalThis !== 'undefined' ? (globalThis.TG = globalThis.TG || {}) : (self.TG = self.TG || {}));
