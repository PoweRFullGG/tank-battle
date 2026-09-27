/* Рендерер: Canvas 2D, неоновый стиль, пул частиц, камера, миникарта, HUD. */
(function (TG) {
  'use strict';
  const R = TG.Render = {};
  let canvas, ctx, dpr = 1, cw = 0, ch = 0;
  const cam = { x: 400, y: 300, scale: 1, sx: 0, sy: 0, shake: 0, init: false };
  R.cam = cam;
  R.settings = { quality: 'high', showFps: false, shake: true, names: true };

  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const colorCache = new Map();
  function cstr(c) {
    const k = (c[0] << 16) | (c[1] << 8) | c[2];
    let s = colorCache.get(k);
    if (!s) { s = rgb(c); colorCache.set(k, s); }
    return s;
  }

  R.init = function (cv) {
    canvas = cv;
    ctx = canvas.getContext('2d', { alpha: false });
    R.resize();
    window.addEventListener('resize', R.resize);
  };

  R.resize = function () {
    const q = R.settings.quality;
    const maxDpr = q === 'high' ? 2 : q === 'medium' ? 1.5 : 1;
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    cw = window.innerWidth; ch = window.innerHeight;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  };

  // ---------- Спрайты свечения ----------
  const glowCache = new Map();
  function glowSprite(c) {
    const k = (c[0] << 16) | (c[1] << 8) | c[2];
    let g = glowCache.get(k);
    if (g) return g;
    g = document.createElement('canvas');
    g.width = g.height = 64;
    const gx = g.getContext('2d');
    const grad = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(c, 0.9));
    grad.addColorStop(0.35, rgba(c, 0.35));
    grad.addColorStop(1, rgba(c, 0));
    gx.fillStyle = grad;
    gx.fillRect(0, 0, 64, 64);
    glowCache.set(k, g);
    return g;
  }

  // ---------- Частицы (пул, структура массивов) ----------
  const PMAX = 3000;
  const P = { n: 0, x: new Float32Array(PMAX), y: new Float32Array(PMAX), vx: new Float32Array(PMAX), vy: new Float32Array(PMAX),
    life: new Float32Array(PMAX), decay: new Float32Array(PMAX), size: new Float32Array(PMAX), col: new Array(PMAX), drag: new Float32Array(PMAX) };
  function pLimit() { const q = R.settings.quality; return q === 'high' ? PMAX : q === 'medium' ? 1400 : 500; }
  function addParticle(x, y, vx, vy, life, decay, size, col, drag) {
    if (P.n >= pLimit()) return;
    const i = P.n++;
    P.x[i] = x; P.y[i] = y; P.vx[i] = vx; P.vy[i] = vy; P.life[i] = life; P.decay[i] = decay; P.size[i] = size; P.col[i] = col; P.drag[i] = drag || 1;
  }
  R.explosion = function (x, y, c, count, power) {
    const q = R.settings.quality;
    count = Math.round(count * (q === 'high' ? 1 : q === 'medium' ? 0.6 : 0.3));
    const col = cstr(c);
    power = power || 1;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, s = (1 + Math.random() * 3) * power;
      addParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, 1, (5 + Math.random() * 5) / 255, 2 + Math.random() * 3, col, 0.985);
    }
    if (count >= 30) {
      // вспышка и «ударная волна»
      rings.push({ x, y, r: 6, max: 60 * power, life: 1, col });
      for (let i = 0; i < count / 4; i++) {
        const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 5;
        addParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, 1, 0.05, 1.5, '#ffffff', 0.93);
      }
    }
  };
  R.spark = function (x, y, c, n) {
    const col = c ? cstr(c) : '#cccccc';
    n = n || 5;
    if (R.settings.quality === 'low') n = 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 0.8 + Math.random() * 2;
      addParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, 1, 0.06, 1.5 + Math.random() * 1.5, col, 0.95);
    }
  };
  R.muzzle = function (x, y, a, c) {
    if (R.settings.quality === 'low') return;
    const col = cstr(c);
    for (let i = 0; i < 4; i++) {
      const aa = a + (Math.random() - 0.5) * 0.6, s = 2 + Math.random() * 3;
      addParticle(x, y, Math.cos(aa) * s, Math.sin(aa) * s, 1, 0.12, 1.5 + Math.random() * 1.5, col, 0.9);
    }
  };
  const rings = [];
  const floats = [];
  R.floatText = function (x, y, text, c) { floats.push({ x, y, text, col: cstr(c), life: 1 }); };

  // ---------- HUD-сообщения ----------
  const feed = [];
  const msgs = [];
  R.killFeed = function (e) {
    feed.push({ s: e.s, sc: e.sc ? cstr(e.sc) : '#fff', v: e.v, vc: e.vc ? cstr(e.vc) : '#fff', t: performance.now() });
    if (feed.length > 5) feed.shift();
  };
  R.message = function (text, c, big) {
    msgs.push({ text, col: c ? cstr(c) : '#fff', big: !!big, t: performance.now() });
    if (msgs.length > 3) msgs.shift();
  };
  let flash = 0;
  R.hurt = function (strong) {
    flash = strong ? 0.55 : 0.35;
    if (R.settings.shake) cam.shake = Math.max(cam.shake, strong ? 14 : 7);
  };
  R.shake = function (v) { if (R.settings.shake) cam.shake = Math.max(cam.shake, v); };
  R.resetEffects = function () { P.n = 0; rings.length = 0; floats.length = 0; feed.length = 0; msgs.length = 0; flash = 0; cam.shake = 0; cam.init = false; };

  // ---------- Преобразования ----------
  R.worldToScreen = function (x, y) { return [(x - cam.x) * cam.scale + cw / 2 + cam.sx, (y - cam.y) * cam.scale + ch / 2 + cam.sy]; };
  R.screenToWorld = function (x, y) { return [(x - cw / 2 - cam.sx) / cam.scale + cam.x, (y - ch / 2 - cam.sy) / cam.scale + cam.y]; };

  function updateCamera(scene, dt) {
    const info = scene.info;
    const W = info.w, H = info.h;
    if (!info.big) {
      cam.scale = Math.min(cw / (W + 30), ch / (H + 30));
      cam.x = W / 2; cam.y = H / 2;
    } else {
      const target = Math.sqrt((cw * ch) / (1150 * 820));
      cam.scale = Math.max(0.3, Math.min(2.2, target));
      const vw = cw / cam.scale, vh = ch / cam.scale;
      let fx = scene.focus ? scene.focus.x : W / 2, fy = scene.focus ? scene.focus.y : H / 2;
      if (vw >= W) fx = W / 2; else fx = Math.max(vw / 2 - 20, Math.min(W - vw / 2 + 20, fx));
      if (vh >= H) fy = H / 2; else fy = Math.max(vh / 2 - 20, Math.min(H - vh / 2 + 20, fy));
      if (!cam.init || Math.hypot(fx - cam.x, fy - cam.y) > 900) { cam.x = fx; cam.y = fy; }
      else {
        const k = 1 - Math.exp(-dt * 0.012);
        cam.x += (fx - cam.x) * k; cam.y += (fy - cam.y) * k;
      }
    }
    cam.init = true;
    if (cam.shake > 0.1) {
      cam.sx = (Math.random() - 0.5) * cam.shake; cam.sy = (Math.random() - 0.5) * cam.shake;
      cam.shake *= Math.pow(0.85, dt / 16.67);
    } else { cam.sx = cam.sy = 0; cam.shake = 0; }
  }

  // ---------- Фигуры танков ----------
  function polyPath(x, y, r, sides, rot) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rot + i * (Math.PI * 2 / sides);
      if (i === 0) ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      else ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }
  function shapePath(shape, x, y, r, rot) {
    switch (shape) {
      case 'Square': polyPath(x, y, r * 1.2, 4, rot + Math.PI / 4); break;
      case 'Triangle': polyPath(x, y, r * 1.3, 3, rot); break;
      case 'Pentagon': polyPath(x, y, r * 1.2, 5, rot); break;
      case 'Hexagon': polyPath(x, y, r * 1.2, 6, rot); break;
      case 'Star': {
        ctx.beginPath();
        const rr = r * 1.3;
        for (let i = 0; i < 10; i++) {
          const a = rot + Math.PI / 2 + i * (Math.PI / 5) - Math.PI / 2;
          const q = i % 2 === 0 ? rr : rr * 0.5;
          if (i === 0) ctx.moveTo(x + Math.cos(a) * q, y + Math.sin(a) * q); else ctx.lineTo(x + Math.cos(a) * q, y + Math.sin(a) * q);
        }
        ctx.closePath();
        break;
      }
      case 'Diamond': {
        const a = rot + Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8);
        ctx.lineTo(x + Math.cos(a + Math.PI / 2) * r * 1.3, y + Math.sin(a + Math.PI / 2) * r * 1.3);
        ctx.lineTo(x + Math.cos(a + Math.PI) * r * 0.8, y + Math.sin(a + Math.PI) * r * 0.8);
        ctx.lineTo(x + Math.cos(a - Math.PI / 2) * r * 1.3, y + Math.sin(a - Math.PI / 2) * r * 1.3);
        ctx.closePath();
        break;
      }
      default: ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }

  R.drawTankIcon = function (c2d, shape, color, size) {
    const saved = ctx; ctx = c2d;
    const W = c2d.canvas.width, H = c2d.canvas.height;
    c2d.clearRect(0, 0, W, H);
    const r = size || W * 0.22, x = W / 2 - r * 0.2, y = H / 2;
    const g = glowSprite(color);
    c2d.globalCompositeOperation = 'lighter';
    c2d.drawImage(g, x - r * 2.4, y - r * 2.4, r * 4.8, r * 4.8);
    c2d.globalCompositeOperation = 'source-over';
    shapePath(shape, x, y, r, 0);
    c2d.fillStyle = rgb(color); c2d.fill();
    c2d.lineWidth = 3; c2d.strokeStyle = '#000'; c2d.stroke();
    c2d.lineCap = 'round';
    c2d.beginPath(); c2d.moveTo(x, y); c2d.lineTo(x + r * 1.6, y);
    c2d.strokeStyle = '#000'; c2d.lineWidth = 10; c2d.stroke();
    c2d.strokeStyle = rgb(color); c2d.lineWidth = 5; c2d.stroke();
    ctx = saved;
  };

  function tankColor(scene, t) {
    if (scene.info.teamColors && TG.TEAM_COLORS[t.team]) return TG.TEAM_COLORS[t.team];
    if (t.pid) { const p = scene.players.get(t.pid); return p ? p.color : [0, 255, 100]; }
    return TG.BOT_COLOR;
  }
  function tankShape(scene, t) {
    if (t.pid) { const p = scene.players.get(t.pid); return p ? p.shape : 'Circle'; }
    return t.lvl ? TG.botShape(t.lvl) : 'Triangle';
  }
  R.tankColor = tankColor;
  R.cstr = cstr;

  function drawTank(scene, t, now, high) {
    const c = tankColor(scene, t);
    const col = cstr(c);
    const r = t.r, x = t.x, y = t.y, f = t.f;
    if (high) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35;
      ctx.drawImage(glowSprite(c), x - r * 2.3, y - r * 2.3, r * 4.6, r * 4.6);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (f & 2) { // щит
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.012);
      ctx.beginPath(); ctx.arc(x, y, r * 1.45, 0, Math.PI * 2);
      ctx.fillStyle = rgba(c, 0.12 + pulse * 0.12); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = rgba([255, 255, 140], 0.5 + pulse * 0.4); ctx.stroke();
    }
    const blink = (f & 4) && Math.floor(now / 90) % 2 === 0;
    if (blink) ctx.globalAlpha = 0.35;
    shapePath(tankShape(scene, t), x, y, r, t.a);
    ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    // ствол
    const len = r * ((f & 128) ? 1.9 : 1.6);
    const cx2 = x + Math.cos(t.a) * len, cy2 = y + Math.sin(t.a) * len;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx2, cy2);
    ctx.strokeStyle = '#000'; ctx.lineWidth = (f & 32) ? 12 : (f & 64) ? 10 : 8; ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = (f & 32) ? 7 : (f & 64) ? 6 : 4; ctx.stroke();
    if (f & 64) { // пулемёт — вращающиеся кольца на стволе
      ctx.beginPath(); ctx.arc(cx2, cy2, 4 + Math.sin(now * 0.05) * 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff64ff'; ctx.lineWidth = 2; ctx.stroke();
    }
    // центр
    ctx.beginPath(); ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill();
    ctx.globalAlpha = 1;
    if (f & 8) { // доп. жизнь
      ctx.beginPath(); ctx.arc(x, y - r - 13, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#ff3246'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
    }
    if (f & 512) { // несёт флаг
      const fc = TG.TEAM_COLORS[t.team === 1 ? 2 : 1];
      const fx = x + r * 0.6, fy = y - r * 0.6;
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 30); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx, fy - 30); ctx.lineTo(fx + 22, fy - 22); ctx.lineTo(fx, fy - 14); ctx.closePath();
      ctx.fillStyle = cstr(fc); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    if ((f & 16) && Math.random() < 0.5) { // след ускорения
      addParticle(x - Math.cos(t.a) * r * 0.8 + (Math.random() - 0.5) * 8, y - Math.sin(t.a) * r * 0.8 + (Math.random() - 0.5) * 8, 0, 0, 0.8, 0.05, 2.5, '#ffc800', 1);
    }
  }

  function drawTankLabels(scene, t) {
    const c = tankColor(scene, t);
    const r = t.r, x = t.x, y = t.y;
    let top = y - r - 10;
    if (t.maxHp > 1 && (t.hp < t.maxHp || scene.info.mode === 'survival' || scene.info.mode === 'arena' || scene.info.mode === 'ctf')) {
      const w = Math.max(34, Math.min(70, t.maxHp * 10)), h = 5;
      const bx = x - w / 2, by = top - 4;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
      ctx.fillStyle = '#5a0f14'; ctx.fillRect(bx, by, w, h);
      const k = Math.max(0, t.hp / t.maxHp);
      ctx.fillStyle = k > 0.6 ? '#2cff6e' : k > 0.3 ? '#ffd23f' : '#ff4155';
      ctx.fillRect(bx, by, w * k, h);
      top = by - 4;
    }
    let label = null;
    if (t.pid && !t.me && R.settings.names) { const p = scene.players.get(t.pid); label = p ? p.name : null; }
    else if (!t.pid && t.lvl && scene.info.mode === 'survival') label = 'L' + t.lvl;
    if (label) {
      ctx.font = `bold ${Math.round(12 / Math.max(0.6, cam.scale) * 1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.strokeText(label, x, top);
      ctx.fillStyle = t.pid ? cstr(c) : '#ffb0b0'; ctx.fillText(label, x, top);
    }
  }

  // ---------- Мир ----------
  function drawGrid(W, H, x0, y0, x1, y1) {
    const step = 40;
    ctx.beginPath();
    const sx = Math.max(0, Math.floor(x0 / step) * step), ex = Math.min(W, x1);
    const sy = Math.max(0, Math.floor(y0 / step) * step), ey = Math.min(H, y1);
    for (let x = sx; x <= ex; x += step) { ctx.moveTo(x, Math.max(0, y0)); ctx.lineTo(x, Math.min(H, y1)); }
    for (let y = sy; y <= ey; y += step) { ctx.moveTo(Math.max(0, x0), y); ctx.lineTo(Math.min(W, x1), y); }
    ctx.strokeStyle = 'rgba(70,78,120,0.35)';
    ctx.lineWidth = 1 / cam.scale;
    ctx.stroke();
  }

  function roundRectPath(x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawObstacles(obs, x0, y0, x1, y1) {
    ctx.beginPath();
    for (const o of obs) {
      if (o.x > x1 || o.x + o.w < x0 || o.y > y1 || o.y + o.h < y0) continue;
      roundRectPath(o.x, o.y, o.w, o.h, 6);
    }
    ctx.fillStyle = '#4a4f72';
    ctx.fill();
    ctx.strokeStyle = '#2a2d45'; ctx.lineWidth = 3; ctx.stroke();
    // блик сверху
    ctx.beginPath();
    for (const o of obs) {
      if (o.x > x1 || o.x + o.w < x0 || o.y > y1 || o.y + o.h < y0) continue;
      ctx.rect(o.x + 4, o.y + 3, o.w - 8, Math.min(6, o.h * 0.15));
    }
    ctx.fillStyle = 'rgba(160,170,230,0.22)';
    ctx.fill();
  }

  function drawBoostIcon(type, x, y, s) {
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    switch (type) {
      case 'speed':
        ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * 0.4); ctx.lineTo(x - s * 0.1, y); ctx.lineTo(x - s * 0.5, y + s * 0.4);
        ctx.moveTo(x, y - s * 0.4); ctx.lineTo(x + s * 0.4, y); ctx.lineTo(x, y + s * 0.4); ctx.stroke(); break;
      case 'bullet': ctx.beginPath(); ctx.arc(x, y, s * 0.36, 0, Math.PI * 2); ctx.fill(); break;
      case 'shield': ctx.beginPath(); ctx.arc(x, y, s * 0.36, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, s * 0.12, 0, Math.PI * 2); ctx.fill(); break;
      case 'gatling': for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(x + i * s * 0.32, y, s * 0.12, 0, Math.PI * 2); ctx.fill(); } break;
      case 'mini': ctx.fillRect(x - s * 0.18, y - s * 0.18, s * 0.36, s * 0.36); break;
      case 'fast_bullet':
        ctx.beginPath(); ctx.moveTo(x - s * 0.45, y); ctx.lineTo(x + s * 0.4, y); ctx.moveTo(x + s * 0.1, y - s * 0.28); ctx.lineTo(x + s * 0.42, y); ctx.lineTo(x + s * 0.1, y + s * 0.28); ctx.stroke(); break;
      case 'health':
        ctx.fillRect(x - s * 0.1, y - s * 0.38, s * 0.2, s * 0.76); ctx.fillRect(x - s * 0.38, y - s * 0.1, s * 0.76, s * 0.2); break;
    }
  }

  function drawBoosts(boosts, now, high) {
    for (const b of boosts) {
      const type = TG.BOOSTS[b.type];
      const info = TG.BOOST_INFO[type];
      if (!info) continue;
      const pulse = Math.sin(now * 0.005 + b.id) * 0.5 + 0.5;
      if (high) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 + pulse * 0.3;
        ctx.drawImage(glowSprite(info.c), b.x - 30, b.y - 30, 60, 60);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      const s = 20 + pulse * 3;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.sin(now * 0.002 + b.id) * 0.25);
      ctx.beginPath(); roundRectPath(-s / 2, -s / 2, s, s, 5);
      ctx.fillStyle = cstr(info.c); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.stroke();
      drawBoostIcon(type, 0, 0, s * 0.75);
      ctx.restore();
    }
  }

  function drawFlags(scene, now, high) {
    for (const f of scene.flags) {
      if (f.carrier) continue; // рисуется над танком
      const c = TG.TEAM_COLORS[f.team];
      const x = f.x, y = f.y;
      if (high) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
        ctx.drawImage(glowSprite(c), x - 45, y - 60, 90, 90);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      ctx.beginPath(); ctx.ellipse(x, y + 4, 18, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = rgba(c, 0.35); ctx.fill();
      if (f.ret) {
        ctx.beginPath(); ctx.arc(x, y - 12, 28, -Math.PI / 2, -Math.PI / 2 + (f.ret / 255) * Math.PI * 2);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke();
      }
      const wave = Math.sin(now * 0.006) * 3;
      ctx.strokeStyle = '#ddd'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x, y - 36); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y - 36); ctx.quadraticCurveTo(x + 15, y - 30 + wave, x + 30, y - 25); ctx.lineTo(x, y - 12); ctx.closePath();
      ctx.fillStyle = cstr(c); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    }
  }

  function drawBullets(scene, high) {
    const bullets = scene.bullets;
    if (high) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.55;
      for (const b of bullets) {
        const s = b.size * 3.2;
        ctx.drawImage(glowSprite(b.c), b.x - s, b.y - s, s * 2, s * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (const b of bullets) { ctx.moveTo(b.x + b.size + 2, b.y); ctx.arc(b.x, b.y, b.size + 2, 0, Math.PI * 2); }
    ctx.fill();
    for (const b of bullets) {
      ctx.fillStyle = b.cs;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2); ctx.fill();
    }
  }

  function updateDrawParticles(dt, x0, y0, x1, y1) {
    const k = dt / 16.667;
    let w = 0;
    ctx.globalCompositeOperation = R.settings.quality === 'low' ? 'source-over' : 'lighter';
    let lastCol = null;
    for (let i = 0; i < P.n; i++) {
      let life = P.life[i] - P.decay[i] * k;
      if (life <= 0) continue;
      const dr = Math.pow(P.drag[i], k);
      const vx = P.vx[i] * dr, vy = P.vy[i] * dr;
      const x = P.x[i] + vx * k, y = P.y[i] + vy * k;
      const s = Math.max(0.3, P.size[i] - 0.1 * k);
      if (w !== i) { P.col[w] = P.col[i]; P.decay[w] = P.decay[i]; P.drag[w] = P.drag[i]; }
      P.x[w] = x; P.y[w] = y; P.vx[w] = vx; P.vy[w] = vy; P.life[w] = life; P.size[w] = s;
      w++;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const col = P.col[w - 1];
      if (col !== lastCol) { ctx.fillStyle = col; lastCol = col; }
      ctx.globalAlpha = life;
      ctx.fillRect(x - s, y - s, s * 2, s * 2);
    }
    P.n = w;
    ctx.globalAlpha = 1;
    // кольца взрывов
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= 0.045 * k;
      r.r += (r.max - r.r) * 0.18 * k;
      if (r.life <= 0) { rings.splice(i, 1); continue; }
      ctx.globalAlpha = r.life * 0.8;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.strokeStyle = r.col; ctx.lineWidth = 3 * r.life + 1; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i];
      f.life -= 0.012 * k; f.y -= 0.6 * k;
      if (f.life <= 0) { floats.splice(i, 1); continue; }
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.font = `bold ${Math.round(15 / Math.max(0.6, cam.scale))}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.col; ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD ----------
  function text(t, x, y, size, col, align, stroke) {
    ctx.font = `800 ${size}px system-ui, "Segoe UI", sans-serif`;
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
    if (stroke !== false) { ctx.lineWidth = Math.max(3, size / 6); ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineJoin = 'round'; ctx.strokeText(t, x, y); }
    ctx.fillStyle = col || '#fff';
    ctx.fillText(t, x, y);
  }
  const fmtTime = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');

  function drawHud(scene, now, fps) {
    const hud = scene.hud || {};
    const me = scene.me;
    const small = cw < 700;
    const topY = 24 + (TG.Input.isTouch ? 30 : 0);
    // Верхняя строка
    let title = hud.t || scene.info.title || '';
    const parts = [];
    if (hud.bots != null && (scene.info.mode === 'levels' || scene.info.mode === 'waves')) parts.push('Ботов: ' + hud.bots);
    if (hud.time != null) parts.push(fmtTime(hud.time));
    if (hud.kills != null) parts.push('Уничтожено: ' + hud.kills);
    if (hud.target != null && !hud.score) parts.push('до ' + hud.target + ' убийств');
    text(title + (parts.length ? '  ·  ' + parts.join('  ·  ') : ''), cw / 2, topY, small ? 15 : 19, '#e8ecff');

    if (hud.score) {
      const y = topY + 30;
      text(String(hud.score[0]), cw / 2 - 40, y, 30, cstr(TG.TEAM_COLORS[1]));
      text(':', cw / 2, y, 26, '#fff');
      text(String(hud.score[1]), cw / 2 + 40, y, 30, cstr(TG.TEAM_COLORS[2]));
      let sub = hud.caps ? 'до ' + hud.caps + ' захватов' : hud.target ? 'до ' + hud.target + ' убийств' : '';
      if (hud.left != null) sub += (sub ? '  ·  ' : '') + fmtTime(hud.left);
      if (sub) text(sub, cw / 2, y + 24, 13, '#9aa3c8');
    }
    if (hud.lead && hud.lead[1] > 0) text(`Лидер: ${hud.lead[0]} (${hud.lead[1]})`, cw / 2, topY + 26, 14, '#ffd23f');
    if (hud.surv != null) text(`ПРОДЕРЖИТЕСЬ: ${hud.surv.toFixed(1)} c`, cw / 2, topY + 28, small ? 18 : 22, '#00c8ff');
    if (hud.next != null) text(`Следующая волна через ${hud.next}…`, cw / 2, ch / 2 - 80, small ? 20 : 26, '#00ff7a');

    // Здоровье, бусты, уровень
    const L = 16 + (TG.Input.isTouch ? 104 : 0);
    let y = topY;
    if (me) {
      const c = tankColor(scene, me);
      if (me.maxHp <= 10) {
        for (let i = 0; i < me.maxHp; i++) {
          const x = L + i * 22;
          ctx.beginPath(); ctx.arc(x + 8, y, 8, 0, Math.PI * 2);
          ctx.fillStyle = i < me.hp ? '#ff3b5c' : 'rgba(255,255,255,0.12)'; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
        }
        if (me.f & 8) { ctx.beginPath(); ctx.arc(L + me.maxHp * 22 + 8, y, 6, 0, Math.PI * 2); ctx.fillStyle = '#ff8fa0'; ctx.fill(); ctx.stroke(); }
      }
      y += 24;
      let bx = L;
      const act = [[16, 'speed'], [32, 'bullet'], [2, 'shield'], [64, 'gatling'], [256, 'mini'], [128, 'fast_bullet']];
      for (const [bit, type] of act) {
        if (!(me.f & bit)) continue;
        const info = TG.BOOST_INFO[type];
        ctx.beginPath(); roundRectPath(bx, y - 10, 20, 20, 4);
        ctx.fillStyle = cstr(info.c); ctx.fill();
        drawBoostIcon(type, bx + 10, y, 15);
        bx += 24;
      }
      if (bx > L) y += 26;
      const pers = scene.pers;
      if (pers && pers.lvl != null) {
        text('УРОВЕНЬ ' + pers.lvl, L, y, 15, '#ffd23f', 'left');
        const w = 150;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(L, y + 12, w, 8);
        ctx.fillStyle = '#ffd23f'; ctx.fillRect(L, y + 12, w * Math.min(1, pers.xp / pers.next), 8);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.strokeRect(L, y + 12, w, 8);
      }
      if (!me.alive) {
        let t2 = 'ВЫ ПОГИБЛИ';
        const sub = scene.respawnIn != null ? `Возрождение через ${scene.respawnIn}…` : (scene.spectating ? 'Наблюдение: ' + scene.spectating : '');
        if (!scene.over) {
          text(t2, cw / 2, ch / 2 - 30, small ? 28 : 40, '#ff4b5c');
          if (sub) text(sub, cw / 2, ch / 2 + 12, small ? 16 : 20, '#e8ecff');
        }
      }
    } else if (scene.spectating && !scene.over) {
      text('Наблюдение: ' + scene.spectating, cw / 2, ch - 40, 16, '#9aa3c8');
      text('Вы появитесь в следующем раунде', cw / 2, ch - 18, 13, '#9aa3c8');
    }

    // Лента убийств
    let fy = topY + (small ? 40 : 0);
    for (let i = feed.length - 1; i >= 0; i--) {
      const e = feed[i];
      const age = now - e.t;
      if (age > 6000) { feed.splice(i, 1); continue; }
    }
    ctx.globalAlpha = 1;
    for (const e of feed) {
      const age = now - e.t;
      ctx.globalAlpha = age > 5000 ? Math.max(0, 1 - (age - 5000) / 1000) : 1;
      ctx.font = '700 13px system-ui, sans-serif';
      const vW = ctx.measureText(e.v).width;
      const mid = e.s ? '  ⨯  ' : '☠ ';
      const mW = ctx.measureText(mid).width;
      const sW = e.s ? ctx.measureText(e.s).width : 0;
      const total = sW + mW + vW;
      let x = cw - 14 - total;
      ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x - 8, fy - 11, total + 16, 22);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      if (e.s) { ctx.fillStyle = e.sc; ctx.fillText(e.s, x, fy); x += sW; }
      ctx.fillStyle = '#ccc'; ctx.fillText(mid, x, fy); x += mW;
      ctx.fillStyle = e.vc; ctx.fillText(e.v, x, fy);
      fy += 26;
    }
    ctx.globalAlpha = 1;

    // Большие сообщения
    let my = ch * 0.3;
    for (let i = msgs.length - 1; i >= 0; i--) if (now - msgs[i].t > 3000) msgs.splice(i, 1);
    for (const m of msgs) {
      const age = now - m.t;
      ctx.globalAlpha = age > 2300 ? Math.max(0, 1 - (age - 2300) / 700) : Math.min(1, age / 150);
      const sc = m.big ? (small ? 26 : 38) : (small ? 15 : 19);
      text(m.text, cw / 2, my, sc, m.col);
      my += sc + 12;
    }
    ctx.globalAlpha = 1;

    if (R.settings.showFps) {
      const pt = `${Math.round(fps)} FPS` + (scene.ping != null ? `  ·  ${scene.ping} мс` : '');
      text(pt, cw - 12, ch - 14, 12, '#8a93b8', 'right');
    }
  }

  function drawMinimap(scene) {
    const info = scene.info;
    if (!info.big) return;
    const touch = TG.Input.isTouch;
    const maxW = touch ? 100 : cw < 700 ? 110 : 170, maxH = touch ? Math.min(130, ch * 0.28) : cw < 700 ? 150 : 200;
    const k = Math.min(maxW / info.w, maxH / info.h);
    const w = info.w * k, h = info.h * k;
    const x0 = TG.Input.isTouch ? cw - w - 12 : 12, y0 = TG.Input.isTouch ? 60 : ch - h - 12;
    ctx.fillStyle = 'rgba(8,10,20,0.88)'; ctx.fillRect(x0 - 2, y0 - 2, w + 4, h + 4);
    ctx.strokeStyle = 'rgba(0,200,255,0.4)'; ctx.lineWidth = 1; ctx.strokeRect(x0 - 2, y0 - 2, w + 4, h + 4);
    for (const b of info.bases || []) { ctx.fillStyle = rgba(TG.TEAM_COLORS[b.team], 0.25); ctx.fillRect(x0 + b.x * k, y0 + b.y * k, b.w * k, b.h * k); }
    ctx.fillStyle = 'rgba(140,150,200,0.55)';
    for (const o of info.obstacles) ctx.fillRect(x0 + o.x * k, y0 + o.y * k, Math.max(1, o.w * k), Math.max(1, o.h * k));
    for (const b of scene.boosts) { ctx.fillStyle = cstr(TG.BOOST_INFO[TG.BOOSTS[b.type]].c); ctx.fillRect(x0 + b.x * k - 1, y0 + b.y * k - 1, 2.5, 2.5); }
    for (const t of scene.tanks) {
      if (!(t.f & 1)) continue;
      ctx.fillStyle = t.me ? '#fff' : cstr(tankColor(scene, t));
      const s = t.me ? 3.5 : 2.5;
      ctx.beginPath(); ctx.arc(x0 + t.x * k, y0 + t.y * k, s, 0, Math.PI * 2); ctx.fill();
    }
    for (const f of scene.flags) {
      ctx.fillStyle = cstr(TG.TEAM_COLORS[f.team]);
      const fx = x0 + f.x * k, fy = y0 + f.y * k;
      ctx.beginPath(); ctx.moveTo(fx, fy - 7); ctx.lineTo(fx + 7, fy - 4); ctx.lineTo(fx, fy - 1); ctx.closePath(); ctx.fill();
      ctx.fillRect(fx - 1, fy - 7, 1.5, 8);
    }
    // рамка видимой области
    const vw = cw / cam.scale, vh = ch / cam.scale;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.strokeRect(x0 + (cam.x - vw / 2) * k, y0 + (cam.y - vh / 2) * k, vw * k, vh * k);
  }

  function drawTouch() {
    const I = TG.Input;
    if (!I.isTouch) return;
    const R0 = I.STICK_R;
    const draw = (st, dx, dy, label) => {
      let ox, oy, x, y;
      if (st.id !== -1) { ox = st.ox; oy = st.oy; x = st.x; y = st.y; }
      else { ox = dx; oy = dy; x = ox; y = oy; }
      ctx.globalAlpha = st.id !== -1 ? 0.5 : 0.2;
      ctx.beginPath(); ctx.arc(ox, oy, R0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
      const vx = x - ox, vy = y - oy, d = Math.hypot(vx, vy), m = Math.min(d, R0);
      const kx = d > 0 ? ox + vx / d * m : ox, ky = d > 0 ? oy + vy / d * m : oy;
      ctx.beginPath(); ctx.arc(kx, ky, 24, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      if (st.id === -1) text(label, ox, oy + R0 + 16, 12, '#fff');
      ctx.globalAlpha = 1;
    };
    draw(I.move, 100, ch - 110, 'движение');
    draw(I.aim, cw - 100, ch - 110, 'прицел / огонь');
  }

  // ---------- Главный кадр ----------
  R.draw = function (scene, dt, fps) {
    const now = performance.now();
    const high = R.settings.quality !== 'low';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07080f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!scene) return;
    updateCamera(scene, dt);
    const s = cam.scale * dpr;
    ctx.setTransform(s, 0, 0, s, (cw / 2 + cam.sx - cam.x * cam.scale) * dpr, (ch / 2 + cam.sy - cam.y * cam.scale) * dpr);
    const info = scene.info;
    const vw = cw / cam.scale, vh = ch / cam.scale;
    const x0 = cam.x - vw / 2 - 60, y0 = cam.y - vh / 2 - 60, x1 = cam.x + vw / 2 + 60, y1 = cam.y + vh / 2 + 60;

    ctx.fillStyle = '#141522';
    ctx.fillRect(0, 0, info.w, info.h);
    for (const b of info.bases || []) {
      const c = TG.TEAM_COLORS[b.team];
      ctx.fillStyle = rgba(c, 0.1); ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeStyle = rgba(c, 0.5); ctx.lineWidth = 4; ctx.strokeRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
      ctx.globalAlpha = 0.25;
      text(b.team === 1 ? 'БАЗА СИНИХ' : 'БАЗА КРАСНЫХ', b.x + b.w / 2, b.y + b.h / 2, 48, cstr(c), 'center', false);
      ctx.globalAlpha = 1;
    }
    drawGrid(info.w, info.h, x0, y0, x1, y1);
    ctx.strokeStyle = 'rgba(0,200,255,0.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(-1.5, -1.5, info.w + 3, info.h + 3);
    drawObstacles(info.obstacles, x0, y0, x1, y1);
    drawBoosts(scene.boosts, now, high);
    drawFlags(scene, now, high);
    drawBullets(scene, high);
    for (const t of scene.tanks) {
      if (!(t.f & 1)) continue;
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
      drawTank(scene, t, now, high);
    }
    updateDrawParticles(dt, x0, y0, x1, y1);
    for (const t of scene.tanks) {
      if (!(t.f & 1)) continue;
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
      drawTankLabels(scene, t);
    }

    // Экранное пространство
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (flash > 0.01) {
      ctx.fillStyle = `rgba(255,0,40,${flash * 0.35})`;
      ctx.fillRect(0, 0, cw, ch);
      flash *= Math.pow(0.9, dt / 16.67);
    }
    if (!scene.demo) {
      drawMinimap(scene);
      drawHud(scene, now, fps);
      drawTouch();
    }
  };

  R.size = () => [cw, ch];
})(self.TG);
