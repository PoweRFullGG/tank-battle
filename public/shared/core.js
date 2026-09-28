/* Tank Battle Online — общее ядро (работает и в браузере, и на сервере Node.js).
   Константы, геометрия, генерация карт, физика танков и пуль. */
(function (TG) {
  'use strict';

  const TICK_RATE = 60;
  const C = TG.C = {
    TICK_RATE,
    TICK_MS: 1000 / TICK_RATE,
    SNAP_EVERY: 2,              // снапшот каждые 2 тика (30 Гц)
    TANK_R: 20,
    BULLET_SPEED: 5.6,
    BULLET_SIZE: 6,
    BULLET_LIFE: 300,           // 5 с
    PLAYER_RATE: 28,            // ~470 мс
    RAPID_RATE: 11,
    BOOST_INTERVAL: 360,        // 6 с
    POS_SCALE: 16,
    MAX_MAP: 4000,
    MAX_PLAYERS: 8,
    MAX_BULLETS: 700,
    BLOCK: 40
  };

  // ---------- Цвета, формы ----------
  TG.PLAYER_COLORS = {
    Green: [0, 255, 100], Blue: [0, 120, 255], Yellow: [255, 200, 0], Red: [255, 60, 60],
    Purple: [200, 50, 255], Orange: [255, 140, 0], Cyan: [0, 255, 255], Pink: [255, 100, 200],
    White: [255, 255, 255], Lime: [150, 255, 50], Gold: [255, 215, 90], Sky: [110, 190, 255],
    Mint: [120, 255, 200], Magenta: [255, 40, 200], Coral: [255, 120, 110], Violet: [140, 110, 255]
  };
  TG.COLOR_RU = {
    Green: 'Зелёный', Blue: 'Синий', Yellow: 'Жёлтый', Red: 'Красный', Purple: 'Фиолетовый',
    Orange: 'Оранжевый', Cyan: 'Бирюзовый', Pink: 'Розовый', White: 'Белый', Lime: 'Лайм',
    Gold: 'Золотой', Sky: 'Небесный', Mint: 'Мятный', Magenta: 'Маджента', Coral: 'Коралловый', Violet: 'Лиловый'
  };
  TG.SHAPES = ['Circle', 'Square', 'Triangle', 'Star', 'Pentagon', 'Hexagon', 'Diamond'];
  TG.SHAPE_RU = {
    Circle: 'Круг', Square: 'Квадрат', Triangle: 'Треугольник', Star: 'Звезда',
    Pentagon: 'Пятиугольник', Hexagon: 'Шестиугольник', Diamond: 'Ромб'
  };
  TG.TEAM_COLORS = { 1: [50, 150, 255], 2: [255, 60, 60], 3: [60, 225, 100], 4: [255, 205, 40] };
  TG.TEAM_NAMES = { 1: 'СИНИЕ', 2: 'КРАСНЫЕ', 3: 'ЗЕЛЁНЫЕ', 4: 'ЖЁЛТЫЕ' };
  TG.TEAM_ADJ = { 1: 'СИНЕЙ', 2: 'КРАСНОЙ', 3: 'ЗЕЛЁНОЙ', 4: 'ЖЁЛТОЙ' };
  TG.TEAM_GEN = { 1: 'синих', 2: 'красных', 3: 'зелёных', 4: 'жёлтых' };
  TG.BOT_COLOR = [255, 50, 50];
  TG.msToTicks = (v) => Math.max(1, Math.round(v / (1000 / TICK_RATE)));

  // ---------- Утилиты ----------
  const U = TG.U = {
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    rand: (a, b) => a + Math.random() * (b - a),
    randInt: (a, b) => a + Math.floor(Math.random() * (b - a + 1)),
    choice: (arr) => arr[Math.floor(Math.random() * arr.length)],
    dist2: (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; },
    angDiff: (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; else if (d < -Math.PI) d += Math.PI * 2; return d; },
    shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; },
    gauss: () => { let s = 0; for (let i = 0; i < 4; i++) s += Math.random(); return (s - 2) / 0.577; },
    weighted: (items, wfn) => {
      let tot = 0;
      for (const it of items) tot += wfn(it);
      let r = Math.random() * tot;
      for (const it of items) { r -= wfn(it); if (r <= 0) return it; }
      return items[items.length - 1];
    }
  };

  // ---------- Геометрия ----------
  function circleRect(x, y, r, o) {
    const cx = x < o.x ? o.x : (x > o.x + o.w ? o.x + o.w : x);
    const cy = y < o.y ? o.y : (y > o.y + o.h ? o.y + o.h : y);
    const dx = x - cx, dy = y - cy;
    return dx * dx + dy * dy < r * r;
  }
  TG.circleRect = circleRect;

  // Блокирует ли что-то танк радиуса r в точке (x, y)
  function tankBlocked(x, y, r, map) {
    if (x < r || y < r || x > map.w - r || y > map.h - r) return true;
    const obs = map.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (x + r <= o.x || x - r >= o.x + o.w || y + r <= o.y || y - r >= o.y + o.h) continue;
      if (circleRect(x, y, r, o)) return true;
    }
    return false;
  }
  TG.tankBlocked = tankBlocked;

  // Возвращает: false — свободно, true — граница карты, объект — препятствие
  function bulletBlocked(x, y, s, map) {
    if (x - s < 0 || y - s < 0 || x + s > map.w || y + s > map.h) return true;
    const obs = map.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (x - s < o.x + o.w && x + s > o.x && y - s < o.y + o.h && y + s > o.y) return o;
    }
    return false;
  }
  TG.bulletBlocked = bulletBlocked;

  // Пересекает ли отрезок прямоугольник (расширенный на pad)
  function segRect(x1, y1, x2, y2, o, pad) {
    const minX = o.x - pad, maxX = o.x + o.w + pad, minY = o.y - pad, maxY = o.y + o.h + pad;
    const dx = x2 - x1, dy = y2 - y1;
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (x1 < minX || x1 > maxX) return false; }
    else {
      let a = (minX - x1) / dx, b = (maxX - x1) / dx;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    if (Math.abs(dy) < 1e-9) { if (y1 < minY || y1 > maxY) return false; }
    else {
      let a = (minY - y1) / dy, b = (maxY - y1) / dy;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    return true;
  }
  TG.segRect = segRect;

  // ignore — препятствие, которое не учитывается (например, цель-ядро)
  TG.lineOfSight = function (map, x1, y1, x2, y2, pad, ignore) {
    const obs = map.obstacles;
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o === ignore) continue;
      if (segRect(x1, y1, x2, y2, o, pad || 0)) return false;
    }
    return true;
  };

  // Ближайшее разрушаемое препятствие на отрезке (или null)
  TG.firstDynOnSegment = function (map, x1, y1, x2, y2, pad) {
    let best = null, bd = Infinity;
    for (const o of map.obstacles) {
      if (!o.dyn || !segRect(x1, y1, x2, y2, o, pad || 0)) continue;
      const d = (o.x + o.w / 2 - x1) ** 2 + (o.y + o.h / 2 - y1) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  };

  // ---------- Физика танка (детерминированная — одинакова на клиенте и сервере) ----------
  const CORNER_ANGLES = [Math.PI / 4, -Math.PI / 4, Math.PI * 0.4, -Math.PI * 0.4];
  TG.moveTank = function (t, mx, my, map) {
    let len = Math.hypot(mx, my);
    if (len < 0.02) return;
    if (len > 1) { mx /= len; my /= len; len = 1; }
    const dist = t.speed * len;
    if (dist <= 0) return;
    const steps = Math.max(1, Math.ceil(dist / 8));
    const sx = (mx / len) * dist / steps, sy = (my / len) * dist / steps;
    const r = t.r;
    const stepLen = dist / steps;
    for (let i = 0; i < steps; i++) {
      const x0 = t.x, y0 = t.y;
      if (sx !== 0) {
        let k = sx;
        for (let h = 0; h < 4; h++) {
          if (!tankBlocked(t.x + k, t.y, r, map)) { t.x += k; break; }
          k *= 0.5;
        }
      }
      if (sy !== 0) {
        let k = sy;
        for (let h = 0; h < 4; h++) {
          if (!tankBlocked(t.x, t.y + k, r, map)) { t.y += k; break; }
          k *= 0.5;
        }
      }
      // Скольжение вокруг угла препятствия: если почти не сдвинулись — пробуем повернуть направление
      const moved = (t.x - x0) * sx + (t.y - y0) * sy;
      if (moved < stepLen * stepLen * 0.25) {
        const ux = sx / stepLen, uy = sy / stepLen;
        for (const ang of CORNER_ANGLES) {
          const c = Math.cos(ang), s = Math.sin(ang);
          const dx = (ux * c - uy * s) * stepLen, dy = (ux * s + uy * c) * stepLen;
          // у ровной стены оба поворота заблокированы — скольжение сработает только на углу
          if (!tankBlocked(x0 + dx, y0 + dy, r, map)) { t.x = x0 + dx; t.y = y0 + dy; break; }
        }
      }
    }
  };

  // Выталкивание танка, если он застрял (например, рядом поставили блок)
  TG.unstick = function (t, map) {
    if (!tankBlocked(t.x, t.y, t.r, map)) return;
    for (let rad = 4; rad <= 240; rad += 4) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const nx = t.x + Math.cos(ang) * rad, ny = t.y + Math.sin(ang) * rad;
        if (!tankBlocked(nx, ny, t.r, map)) { t.x = nx; t.y = ny; return; }
      }
    }
  };

  // Шаг пули с отскоками (субшаги против «пролёта» сквозь стены).
  // Пуля, попавшая в разрушаемое препятствие, останавливается: b.hitObs = препятствие.
  TG.stepBullet = function (b, map) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) / 8));
    let bounced = false;
    for (let i = 0; i < n; i++) {
      const sx = b.vx / n;
      b.x += sx;
      let hit = bulletBlocked(b.x, b.y, b.size, map);
      if (hit) {
        b.x -= sx;
        if (hit !== true && hit.dyn) { b.hitObs = hit; return true; }
        b.vx = -b.vx; bounced = true;
      }
      const sy = b.vy / n;
      b.y += sy;
      hit = bulletBlocked(b.x, b.y, b.size, map);
      if (hit) {
        b.y -= sy;
        if (hit !== true && hit.dyn) { b.hitObs = hit; return true; }
        b.vy = -b.vy; bounced = true;
      }
    }
    return bounced;
  };

  // ---------- Генерация карт ----------
  function rectsGap(a, b, gap) {
    return a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;
  }
  TG.rectsGap = rectsGap;

  // opt: {count, minW,maxW,minH,maxH, margin, gap, avoid:[rects], region:{x,y,w,h}}
  TG.genObstacles = function (w, h, opt) {
    const res = opt.into || [];
    const region = opt.region || { x: 0, y: 0, w, h };
    const margin = opt.margin == null ? 50 : opt.margin;
    const gap = opt.gap == null ? 50 : opt.gap;
    const avoid = opt.avoid || [];
    for (let n = 0; n < opt.count; n++) {
      for (let at = 0; at < 120; at++) {
        const ow = U.randInt(opt.minW || 60, opt.maxW || 180);
        const oh = U.randInt(opt.minH || 40, opt.maxH || 100);
        const x0 = region.x + margin, x1 = region.x + region.w - margin - ow;
        const y0 = region.y + margin, y1 = region.y + region.h - margin - oh;
        if (x1 <= x0 || y1 <= y0) break;
        const r = { x: U.randInt(x0, x1), y: U.randInt(y0, y1), w: ow, h: oh };
        let ok = true;
        for (const o of res) if (rectsGap(r, o, gap)) { ok = false; break; }
        if (ok) for (const a of avoid) if (rectsGap(r, a, 0)) { ok = false; break; }
        if (ok) { res.push(r); break; }
      }
    }
    return res;
  };

  // Зеркальная (4-сторонняя симметрия) карта для честного PvP
  TG.genSymmetric = function (w, h, opt) {
    const margin = opt.margin == null ? 50 : opt.margin;
    const qw = w / 2, qh = h / 2;
    // объекты четверти заканчиваются не ближе 30px к центральным линиям => проход 60px
    const base = TG.genObstacles(w, h, Object.assign({}, opt, { region: { x: 0, y: 0, w: qw + margin - 30, h: qh + margin - 30 } }));
    const out = [];
    for (const r of base) {
      out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
      out.push({ x: w - r.x - r.w, y: r.y, w: r.w, h: r.h });
      out.push({ x: r.x, y: h - r.y - r.h, w: r.w, h: r.h });
      out.push({ x: w - r.x - r.w, y: h - r.y - r.h, w: r.w, h: r.h });
    }
    return out;
  };

  // Точечная симметрия (поворот на 180°) — для CTF
  TG.genPointSymmetric = function (w, h, opt) {
    const half = TG.genObstacles(w, h, Object.assign({}, opt, { region: { x: 0, y: 0, w, h: h / 2 } }));
    const out = [];
    for (const r0 of half) {
      const r = Object.assign({}, r0);
      if (r.y + r.h > h / 2 - 25) r.h = h / 2 - 25 - r.y;
      if (r.h < 30) continue;
      out.push(r, { x: w - r.x - r.w, y: h - r.y - r.h, w: r.w, h: r.h });
    }
    return out;
  };

  // Поиск свободного места. opt: {r, far:[{x,y}], minDist, region, avoidTanks:[tanks], avoidRects}
  TG.findSpot = function (map, opt) {
    const r = opt.r || 25;
    const reg = opt.region || { x: 0, y: 0, w: map.w, h: map.h };
    const rx0 = Math.max(0, reg.x), ry0 = Math.max(0, reg.y);
    const rx1 = Math.min(map.w, reg.x + reg.w), ry1 = Math.min(map.h, reg.y + reg.h);
    let minDist = opt.minDist || 0;
    const far = opt.far || [];
    const tanks = opt.avoidTanks || [];
    let best = null, bestScore = -1;
    for (let at = 0; at < 400; at++) {
      if (at > 0 && at % 100 === 0) minDist *= 0.6;
      const x = U.rand(rx0 + r + 10, rx1 - r - 10);
      const y = U.rand(ry0 + r + 10, ry1 - r - 10);
      if (!(x > 0 && y > 0) || tankBlocked(x, y, r + 4, map)) continue;
      let ok = true;
      for (const t of tanks) if (t.alive && U.dist2(x, y, t.x, t.y) < (r + t.r + 12) ** 2) { ok = false; break; }
      if (!ok) continue;
      if (opt.avoidRects) for (const a of opt.avoidRects) if (x > a.x - r && x < a.x + a.w + r && y > a.y - r && y < a.y + a.h + r) { ok = false; break; }
      if (!ok) continue;
      let md = Infinity;
      for (const p of far) md = Math.min(md, Math.hypot(x - p.x, y - p.y));
      if (md >= minDist) return { x, y };
      if (md > bestScore) { bestScore = md; best = { x, y }; }
    }
    if (best) return best;
    // Крайний случай — любое свободное место
    for (let at = 0; at < 2000; at++) {
      const x = U.rand(r, map.w - r), y = U.rand(r, map.h - r);
      if (!tankBlocked(x, y, r, map)) return { x, y };
    }
    return { x: map.w / 2, y: map.h / 2 };
  };

  // ---------- Квантование ввода (одинаково на клиенте и сервере) ----------
  TG.quantInput = function (inp) {
    inp.mx = Math.round(U.clamp(inp.mx, -1, 1) * 127) / 127;
    inp.my = Math.round(U.clamp(inp.my, -1, 1) * 127) / 127;
    let a = inp.a;
    if (!isFinite(a)) a = 0;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    inp.a = Math.round(a * 10000) / 10000;
    return inp;
  };

  TG.rgb = (c, a) => (a == null ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`);
})(typeof globalThis !== 'undefined' ? (globalThis.TG = globalThis.TG || {}) : (self.TG = self.TG || {}));
