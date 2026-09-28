/* Ввод: клавиатура, мышь и сенсорные джойстики (плавающие, с настройкой размера и режимом для левши). */
(function (TG) {
  'use strict';
  const I = TG.Input = {
    keys: new Set(),
    mx: -1, my: -1, mouseDown: false, mouseActive: false,
    isTouch: false,
    move: { id: -1, ox: 0, oy: 0, x: 0, y: 0 },
    aim: { id: -1, ox: 0, oy: 0, x: 0, y: 0 },
    fireBtn: false,
    lastAim: 0,
    act: 0,
    enabled: false,
    onKey: null,
    cfg: { stick: 70, leftHanded: false, autoFire: true, aimAssist: 1 }
  };

  function typing() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
  }

  I.init = function (canvas) {
    window.addEventListener('keydown', (e) => {
      if (typing()) return;
      if (I.onKey && I.onKey(e) === false) { e.preventDefault(); return; }
      if (!I.enabled) return;
      I.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => { I.keys.delete(e.code); });
    window.addEventListener('blur', () => { I.keys.clear(); I.mouseDown = false; I.resetTouch(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { I.keys.clear(); I.mouseDown = false; I.resetTouch(); } });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') {
        I.isTouch = true;
        let left = e.clientX < window.innerWidth / 2;
        if (I.cfg.leftHanded) left = !left;
        const st = left ? I.move : I.aim;
        if (st.id === -1) { st.id = e.pointerId; st.ox = st.x = e.clientX; st.oy = st.y = e.clientY; }
      } else {
        I.isTouch = false;
        I.mouseActive = true;
        I.mx = e.clientX; I.my = e.clientY;
        if (e.button === 0 || e.button === 2) I.mouseDown = true;
      }
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* игнор */ }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        const R = I.cfg.stick;
        for (const st of [I.move, I.aim]) {
          if (st.id !== e.pointerId) continue;
          st.x = e.clientX; st.y = e.clientY;
          // «плавающий» джойстик: центр подтягивается за пальцем
          const dx = st.x - st.ox, dy = st.y - st.oy, d = Math.hypot(dx, dy);
          if (d > R * 1.4) { st.ox = st.x - dx / d * R * 1.4; st.oy = st.y - dy / d * R * 1.4; }
        }
      } else {
        I.mx = e.clientX; I.my = e.clientY; I.mouseActive = true;
      }
    });
    const up = (e) => {
      if (e.pointerType === 'touch') {
        if (I.move.id === e.pointerId) I.move.id = -1;
        if (I.aim.id === e.pointerId) I.aim.id = -1;
      } else if (e.buttons === 0) I.mouseDown = false;
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'touch' && e.buttons === 0) I.mouseDown = false; });
    if (('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) I.isTouch = true;
  };

  I.resetTouch = function () { I.move.id = -1; I.aim.id = -1; I.fireBtn = false; };
  I.clear = function () { I.keys.clear(); I.mouseDown = false; I.resetTouch(); I.act = 0; };

  I.moveVector = function () {
    let x = 0, y = 0;
    const k = I.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (x || y) { const l = Math.hypot(x, y); return [x / l, y / l]; }
    if (I.move.id !== -1) {
      const R = I.cfg.stick;
      const dx = I.move.x - I.move.ox, dy = I.move.y - I.move.oy;
      const d = Math.hypot(dx, dy);
      if (d > 8) { const m = Math.min(1, d / R); return [dx / d * m, dy / d * m]; }
    }
    return [0, 0];
  };

  // Сырой угол прицела. tx, ty — экранные координаты своего танка
  I.aimAngle = function (tx, ty) {
    if (I.aim.id !== -1) {
      const dx = I.aim.x - I.aim.ox, dy = I.aim.y - I.aim.oy;
      if (Math.hypot(dx, dy) > 10) I.lastAim = Math.atan2(dy, dx);
      return I.lastAim;
    }
    if (I.isTouch && I.move.id !== -1) {
      const v = I.moveVector();
      if (v[0] || v[1]) I.lastAim = Math.atan2(v[1], v[0]);
      return I.lastAim;
    }
    if (I.mouseActive && I.mx >= 0) I.lastAim = Math.atan2(I.my - ty, I.mx - tx);
    return I.lastAim;
  };
  I.aimingByStick = () => I.aim.id !== -1 && Math.hypot(I.aim.x - I.aim.ox, I.aim.y - I.aim.oy) > 10;

  I.firing = function () {
    if (I.keys.has('Space') || I.mouseDown || I.fireBtn) return true;
    if (I.aim.id !== -1 && I.cfg.autoFire) return Math.hypot(I.aim.x - I.aim.ox, I.aim.y - I.aim.oy) > 18;
    return false;
  };

  I.takeAction = function () { const a = I.act; I.act = 0; return a; };
})(self.TG);
