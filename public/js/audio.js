/* Процедурные звуки (WebAudio) — без внешних файлов. */
(function (TG) {
  'use strict';
  const A = TG.Audio = {
    ctx: null, master: null, noise: null, volume: 0.6,
    lx: 0, ly: 0, hasListener: false,
    last: {}, recent: 0, recentT: 0
  };

  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      A.ctx = new AC();
      A.master = A.ctx.createGain();
      A.master.gain.value = A.volume * 0.5;
      const comp = A.ctx.createDynamicsCompressor();
      comp.threshold.value = -12; comp.ratio.value = 6;
      A.master.connect(comp); comp.connect(A.ctx.destination);
      const len = A.ctx.sampleRate;
      A.noise = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
      const d = A.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { A.ctx = null; }
  };

  A.setVolume = function (v) {
    A.volume = v;
    if (A.master) A.master.gain.value = v * 0.5;
  };

  A.setListener = function (x, y) { A.lx = x; A.ly = y; A.hasListener = true; };

  function out(vol, pan) {
    const g = A.ctx.createGain();
    g.gain.value = vol;
    if (pan && A.ctx.createStereoPanner) {
      const p = A.ctx.createStereoPanner();
      p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      g.connect(p); p.connect(A.master);
    } else g.connect(A.master);
    return g;
  }

  function tone(dest, type, f0, f1, t0, dur, vol) {
    const c = A.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  function noise(dest, t0, dur, vol, f0, f1, q) {
    const c = A.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = A.noise;
    f.type = 'lowpass'; f.Q.value = q || 0.8;
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.02);
  }

  const SFX = {
    shoot(d, t, o) { const b = o.big ? 0.6 : 1; tone(d, 'square', 950 * b, 260 * b, t, 0.09, 0.22); noise(d, t, 0.05, 0.12, 5000, 800); },
    boom(d, t) { noise(d, t, 0.6, 0.9, 1800, 90, 1); tone(d, 'sine', 120, 38, t, 0.45, 0.8); },
    hit(d, t) { noise(d, t, 0.14, 0.5, 2600, 300); tone(d, 'triangle', 240, 90, t, 0.12, 0.4); },
    spark(d, t) { noise(d, t, 0.05, 0.12, 6000, 1500); },
    pick(d, t) { tone(d, 'sine', 660, 660, t, 0.09, 0.3); tone(d, 'sine', 990, 990, t + 0.07, 0.1, 0.3); tone(d, 'sine', 1320, 1320, t + 0.14, 0.14, 0.25); },
    lvl(d, t) { [523, 659, 784, 1047].forEach((f, i) => tone(d, 'triangle', f, f, t + i * 0.08, 0.16, 0.35)); },
    win(d, t) { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(d, 'square', f, f, t + i * 0.1, 0.18, 0.16)); },
    lose(d, t) { [392, 330, 262, 196].forEach((f, i) => tone(d, 'sawtooth', f, f * 0.98, t + i * 0.14, 0.22, 0.14)); },
    flag(d, t) { tone(d, 'triangle', 880, 880, t, 0.12, 0.35); tone(d, 'triangle', 1175, 1175, t + 0.1, 0.2, 0.3); },
    click(d, t) { tone(d, 'sine', 1200, 900, t, 0.04, 0.12); },
    wave(d, t) { tone(d, 'sawtooth', 220, 440, t, 0.35, 0.16); tone(d, 'square', 330, 660, t + 0.05, 0.3, 0.08); }
  };

  // opts: {x, y, big, vol}
  A.play = function (name, opts) {
    if (!A.ctx || A.mute || A.volume <= 0 || A.ctx.state !== 'running') return;
    const fn = SFX[name];
    if (!fn) return;
    opts = opts || {};
    const now = A.ctx.currentTime;
    // Ограничение частоты одинаковых звуков
    const minGap = name === 'shoot' ? 0.03 : name === 'spark' ? 0.05 : 0.02;
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
})(self.TG);
