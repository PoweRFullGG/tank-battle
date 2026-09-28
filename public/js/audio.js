/* Процедурные звуки и музыка (WebAudio) — без внешних файлов.
   Работает и на телефонах: звук «разблокируется» первым касанием/кликом (как требуют браузеры). */
(function (TG) {
  'use strict';
  const A = TG.Audio = {
    ctx: null, master: null, sfx: null, mus: null, noise: null,
    volume: 0.7, sfxVol: 0.8, musicVol: 0, vibrate: true,
    lx: 0, ly: 0, hasListener: false, mute: false,
    last: {}, recent: 0, recentT: 0, unlocked: false
  };

  A.init = function () {
    if (A.ctx) { if (A.ctx.state !== 'running') A.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* iOS 17+ */ }
      A.ctx = new AC({ latencyHint: 'interactive' });
      const c = A.ctx;
      A.master = c.createGain();
      A.master.gain.value = A.volume;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
      A.master.connect(comp); comp.connect(c.destination);
      A.sfx = c.createGain(); A.sfx.gain.value = A.sfxVol * 0.6; A.sfx.connect(A.master);
      A.mus = c.createGain(); A.mus.gain.value = A.musicVol * 0.35; A.mus.connect(A.master);
      const len = c.sampleRate;
      A.noise = c.createBuffer(1, len, c.sampleRate);
      const d = A.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      if (c.state !== 'running') c.resume().catch(() => {});
    } catch (e) { A.ctx = null; }
  };

  // «Разблокировка» звука первым действием пользователя (обязательно для iOS/Android)
  function unlock() {
    A.init();
    const c = A.ctx;
    if (!c) return;
    if (c.state !== 'running') c.resume().catch(() => {});
    try {
      const b = c.createBuffer(1, 1, 22050);
      const s = c.createBufferSource();
      s.buffer = b; s.connect(c.destination); s.start(0);
    } catch (e) { /* игнор */ }
    if (c.state === 'running') {
      A.unlocked = true;
      if (A.wantMusic && !A.musicOn) A.startMusic(A.wantMusic);
    }
  }
  for (const ev of ['touchend', 'pointerup', 'click', 'keydown', 'mousedown']) window.addEventListener(ev, unlock, { passive: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (!A.ctx) return;
    if (document.hidden) A.ctx.suspend().catch(() => {});
    else A.ctx.resume().catch(() => {});
  });

  A.setVolume = function (master, sfx, music) {
    if (master != null) A.volume = master;
    if (sfx != null) A.sfxVol = sfx;
    if (music != null) A.musicVol = music;
    if (A.master) A.master.gain.value = A.volume;
    if (A.sfx) A.sfx.gain.value = A.sfxVol * 0.6;
    if (A.mus) A.mus.gain.value = A.musicVol * 0.35;
    if (A.musicVol <= 0 && A.musicOn) A.stopMusic();
    else if (A.musicVol > 0 && A.wantMusic && !A.musicOn && A.unlocked) A.startMusic(A.wantMusic);
  };

  A.setListener = function (x, y) { A.lx = x; A.ly = y; A.hasListener = true; };

  A.buzz = function (pattern) {
    if (!A.vibrate || !navigator.vibrate || !A.unlocked || !(TG.Input && TG.Input.isTouch)) return;
    try { navigator.vibrate(pattern); } catch (e) { /* игнор */ }
  };

  function out(vol, pan) {
    const g = A.ctx.createGain();
    g.gain.value = vol;
    if (pan && A.ctx.createStereoPanner) {
      const p = A.ctx.createStereoPanner();
      p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      g.connect(p); p.connect(A.sfx);
    } else g.connect(A.sfx);
    return g;
  }

  function tone(dest, type, f0, f1, t0, dur, vol, att) {
    const c = A.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + (att || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dest, t0, dur, vol, f0, f1, q, type) {
    const c = A.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = A.noise;
    f.type = type || 'lowpass'; f.Q.value = q || 0.8;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
  }

  const SFX = {
    shoot(d, t, o) { const b = o.big ? 0.6 : 1; tone(d, 'square', 950 * b, 260 * b, t, 0.09, 0.2); noise(d, t, 0.05, 0.12, 5000, 800); },
    boom(d, t, o) { const k = o.big ? 1.6 : 1; noise(d, t, 0.6 * k, 0.9, 1800, 90, 1); tone(d, 'sine', 120, 38, t, 0.45 * k, 0.8); },
    hit(d, t) { noise(d, t, 0.14, 0.5, 2600, 300); tone(d, 'triangle', 240, 90, t, 0.12, 0.4); },
    spark(d, t) { noise(d, t, 0.05, 0.1, 6000, 1500); },
    pick(d, t) { tone(d, 'sine', 660, 660, t, 0.09, 0.3); tone(d, 'sine', 990, 990, t + 0.07, 0.1, 0.3); tone(d, 'sine', 1320, 1320, t + 0.14, 0.14, 0.25); },
    coin(d, t) { tone(d, 'square', 1320, 1320, t, 0.05, 0.12); tone(d, 'square', 1760, 1760, t + 0.05, 0.08, 0.12); },
    buy(d, t) { [784, 988, 1175].forEach((f, i) => tone(d, 'triangle', f, f, t + i * 0.05, 0.12, 0.3)); },
    deny(d, t) { tone(d, 'square', 220, 180, t, 0.18, 0.18); },
    place(d, t) { noise(d, t, 0.08, 0.5, 900, 200, 2); tone(d, 'sine', 180, 120, t, 0.08, 0.3); },
    break(d, t) { noise(d, t, 0.25, 0.7, 3000, 200, 1.5); tone(d, 'square', 160, 60, t, 0.2, 0.15); },
    emp(d, t) { tone(d, 'sawtooth', 1600, 60, t, 0.5, 0.25); noise(d, t, 0.4, 0.4, 8000, 400, 3, 'bandpass'); },
    ring(d, t) { tone(d, 'sawtooth', 300, 900, t, 0.25, 0.18); },
    heal(d, t) { tone(d, 'sine', 520, 780, t, 0.25, 0.2, 0.05); },
    lvl(d, t) { [523, 659, 784, 1047].forEach((f, i) => tone(d, 'triangle', f, f, t + i * 0.08, 0.16, 0.35)); },
    win(d, t) { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(d, 'square', f, f, t + i * 0.1, 0.18, 0.16)); },
    lose(d, t) { [392, 330, 262, 196].forEach((f, i) => tone(d, 'sawtooth', f, f * 0.98, t + i * 0.14, 0.22, 0.14)); },
    flag(d, t) { tone(d, 'triangle', 880, 880, t, 0.12, 0.35); tone(d, 'triangle', 1175, 1175, t + 0.1, 0.2, 0.3); },
    click(d, t) { tone(d, 'sine', 1200, 900, t, 0.04, 0.12); },
    wave(d, t) { tone(d, 'sawtooth', 220, 440, t, 0.35, 0.16); tone(d, 'square', 330, 660, t + 0.05, 0.3, 0.08); },
    streak(d, t) { [659, 880, 1109, 1319].forEach((f, i) => tone(d, 'square', f, f, t + i * 0.06, 0.1, 0.14)); }
  };

  // opts: {x, y, big, vol}
  A.play = function (name, opts) {
    if (!A.ctx || A.mute || A.volume <= 0 || A.sfxVol <= 0 || A.ctx.state !== 'running') return;
    const fn = SFX[name];
    if (!fn) return;
    opts = opts || {};
    const now = A.ctx.currentTime;
    const minGap = name === 'shoot' ? 0.03 : name === 'spark' ? 0.05 : name === 'coin' ? 0.04 : 0.02;
    if (A.last[name] && now - A.last[name] < minGap) return;
    if (now - A.recentT > 0.1) { A.recentT = now; A.recent = 0; }
    if (++A.recent > 14) return;
    A.last[name] = now;
    let vol = opts.vol == null ? 1 : opts.vol, pan = 0;
    if (opts.x != null && A.hasListener) {
      const dx = opts.x - A.lx, dy = opts.y - A.ly;
      const dist = Math.hypot(dx, dy);
      vol *= Math.max(0, 1 - dist / 1300);
      pan = dx / 900;
      if (vol < 0.03) return;
    }
    try { fn(out(vol, pan), now + 0.005, opts); } catch (e) { /* игнор */ }
  };

  // ---------- Процедурная музыка (синтвейв в ля миноре) ----------
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
  const CHORDS2 = [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]]; // Am G F E
  const ARP = [0, 1, 2, 1, 0, 2, 1, 2];

  function mNote(type, freq, t, dur, vol, cutoff) {
    const c = A.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    let node = o;
    if (cutoff) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; o.connect(f); node = f; }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g); g.connect(A.mus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function mDrum(kind, t) {
    const c = A.ctx;
    if (kind === 'k') {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.14);
      g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      o.connect(g); g.connect(A.mus); o.start(t); o.stop(t + 0.22);
    } else {
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = A.noise; f.type = 'highpass'; f.frequency.value = kind === 'h' ? 7000 : 1800;
      g.gain.setValueAtTime(kind === 'h' ? 0.12 : 0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'h' ? 0.04 : 0.14));
      s.connect(f); f.connect(g); g.connect(A.mus); s.start(t, Math.random() * 0.5); s.stop(t + 0.2);
    }
  }

  A.startMusic = function (kind) {
    A.wantMusic = kind;
    if (!A.ctx || A.musicVol <= 0 || A.ctx.state !== 'running') return;
    if (A.musicOn && A.musicKind === kind) return;
    A.stopMusic(true);
    A.musicOn = true; A.musicKind = kind;
    const battle = kind === 'battle';
    const bpm = battle ? 112 : 88;
    const step = 60 / bpm / 4;
    let n = 0, next = A.ctx.currentTime + 0.1;
    const prog = battle ? CHORDS2 : CHORDS;
    A._mt = setInterval(() => {
      if (!A.ctx || A.ctx.state !== 'running') return;
      while (next < A.ctx.currentTime + 0.25) {
        const bar = Math.floor(n / 16) % 4, s = n % 16;
        const ch = prog[bar];
        if (s === 0) for (const m of ch) mNote('sawtooth', mtof(m), next, step * 16, battle ? 0.05 : 0.06, 900);
        if (s % 2 === 0) mNote('triangle', mtof(ch[ARP[(s / 2) % 8]] + 12), next, step * 1.6, battle ? 0.09 : 0.07);
        if (battle) {
          if (s % 4 === 0) mNote('sawtooth', mtof(ch[0] - 24), next, step * 3, 0.16, 500);
          if (s % 4 === 0) mDrum('k', next);
          if (s % 4 === 2) mDrum('h', next);
          if (s === 4 || s === 12) mDrum('s', next);
        } else if (s % 8 === 0) mNote('sine', mtof(ch[0] - 12), next, step * 7, 0.12);
        next += step; n++;
      }
    }, 60);
  };
  A.stopMusic = function (keepWant) {
    clearInterval(A._mt);
    A._mt = null;
    A.musicOn = false;
    if (!keepWant) A.wantMusic = null;
  };
})(self.TG);
