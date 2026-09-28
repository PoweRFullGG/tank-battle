/* Главный модуль: игровой цикл и связь интерфейса, сессий и сети. */
(function (TG) {
  'use strict';
  const UI = TG.UI, R = TG.Render, I = TG.Input, A = TG.Audio, Net = TG.Net;
  const F = TG.TF;
  const $ = UI.$;

  const Game = TG.Game = {
    session: null, demo: null, room: null, myPid: 0, roomPlayers: new Map(),
    liveAim: null, lastScene: null, paused: false, chatOpen: false, showBoard: false, resultOpen: false, pending: null
  };

  const modeOf = (s) => (s ? (s.isNet ? s.info.mode : s.mode) : null);

  // ---------- Ввод для симуляции ----------
  Game.sampleInput = function () {
    const active = I.enabled && !Game.paused && !Game.chatOpen && !Game.resultOpen;
    const mv = active ? I.moveVector() : [0, 0];
    return { mx: mv[0], my: mv[1], a: Game.liveAim != null ? Game.liveAim : 0, fire: active && I.firing(), up: I.takeAction() };
  };
  Game.act = function (code) { I.act = code; };

  // Помощь в прицеливании на телефоне: доворот к ближайшему врагу в секторе
  function assistAim(sc, a) {
    const lvl = I.cfg.aimAssist;
    if (!lvl || !I.isTouch || !sc || !sc.me) return a;
    const cone = lvl === 2 ? 0.45 : 0.22;
    let best = null, bd = Infinity;
    for (const t of sc.tanks) {
      if (t.me || !(t.f & F.alive)) continue;
      if (sc.meTeam && sc.meTeam !== 0 && t.team === sc.meTeam) continue;
      if (t.f & F.invis) continue;
      const dx = t.x - sc.me.x, dy = t.y - sc.me.y, d = Math.hypot(dx, dy);
      if (d > 750) continue;
      const diff = Math.abs(TG.U.angDiff(Math.atan2(dy, dx), a));
      if (diff > cone) continue;
      const score = diff * 400 + d;
      if (score < bd) { bd = score; best = t; }
    }
    if (!best) return a;
    const want = Math.atan2(best.y - sc.me.y, best.x - sc.me.x);
    return a + TG.U.angDiff(want, a) * (lvl === 2 ? 0.85 : 0.6);
  }

  // ---------- Музыка ----------
  Game.updateMusic = function () {
    const inGame = !!Game.session && !UI.current;
    A.startMusic(inGame ? 'battle' : 'menu');
  };

  // ---------- Сессии ----------
  function beginSession(s) {
    if (Game.session) Game.session.destroy();
    Game.session = s;
    Game.demo = null;
    A.mute = false;
    Game.paused = false; Game.resultOpen = false; Game.liveAim = null; Game.lastScene = null;
    UI.resetInGame();
    UI.hideResult();
    $('ov-pause').hidden = true;
    UI.show(null);
    I.clear();
    I.enabled = true;
    $('hud-chat').hidden = false;
    updateTouchButtons();
    Game.updateMusic();
    if (I.isTouch && UI.settings.autoFs) enterFullscreen(true);
  }

  Game.startSolo = function (mode, opts) {
    A.init();
    beginSession(new TG.LocalSession(mode, opts, UI.profile(), UI.admin, Game));
  };

  Game.startNet = function (msg) {
    beginSession(new TG.NetSession(Net, msg, Game));
  };

  Game.endSession = function () {
    if (Game.session) Game.session.destroy();
    Game.session = null;
    Game.resultOpen = false; Game.paused = false; Game.chatOpen = false;
    UI.resetInGame();
    UI.hideResult();
    $('ov-pause').hidden = true;
    I.enabled = false;
    I.clear();
    $('hud-chat').hidden = true;
    startDemo();
    updateTouchButtons();
    Game.updateMusic();
  };

  Game.exitToMenu = function () {
    if (Game.room || Net.code) { Net.leaveRoom(); Game.room = null; clearHash(); }
    UI.setConn(false);
    Game.endSession();
    UI.show('main');
  };

  function startDemo() {
    if (!Game.demo) { try { Game.demo = new TG.DemoSession(); } catch (e) { Game.demo = null; } }
    A.mute = true;
  }

  Game.showResult = function (res, local) {
    const s = Game.session;
    if (!s) return;
    const myTank = s.myTankId, myTeam = s.myTeam();
    const win = !!(res.win || (res.winTeam && res.winTeam === myTeam) || (res.winTank && res.winTank === myTank));
    const mode = modeOf(s);
    if (local) {
      if (mode === 'levels' && res.win && res.level) UI.progress.stars[res.level] = Math.max(UI.progress.stars[res.level] || 0, res.stars || 1);
      if (mode === 'waves' && res.score != null) UI.progress.bestWave = Math.max(UI.progress.bestWave, res.score);
      if (mode === 'survival' && res.lvl) UI.progress.bestLevel = Math.max(UI.progress.bestLevel, res.lvl);
      UI.saveProgress();
    }
    Game.resultOpen = true;
    Game.chatOpen = false; $('game-chat-form').hidden = true;
    UI.showResult(res, { local, isHost: Game.room && Game.room.host === Game.myPid, win, draw: !!res.draw, mode, meId: myTank });
    A.buzz(win ? [60, 40, 60, 40, 120] : [200]);
  };

  // ---------- Главный цикл ----------
  let last = performance.now(), fps = 60, sbTimer = 0, hintT = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = now - last;
    last = now;
    if (dt > 250) dt = 250;
    if (dt > 0) fps = fps * 0.95 + (1000 / dt) * 0.05;
    const s = Game.session;
    if (s) {
      const sc0 = Game.lastScene;
      const me = sc0 && sc0.me;
      if (me && me.alive && !Game.paused && !Game.chatOpen) {
        const p = R.worldToScreen(me.x, me.y);
        let a = I.aimAngle(p[0], p[1]);
        if (I.isTouch) a = assistAim(sc0, a);
        Game.liveAim = a;
      }
      s.update(dt);
      const sc = s.scene();
      if (sc) {
        Game.lastScene = sc;
        const f = sc.me && sc.me.alive ? sc.me : sc.focus;
        if (f) A.setListener(f.x, f.y);
        R.draw(sc, dt, fps);
        UI.updateUpgrades(sc.pers, (i) => Game.act(i));
        if (UI.shopOpen) {
          if (!sc.pers || !sc.pers.shop || !sc.me || !sc.me.alive) UI.showShop(false);
          else UI.renderShop(sc.pers, (i) => Game.act(16 + i));
        }
        const bw = !!(sc.pers && sc.pers.shop) && I.isTouch;
        $('tb-block').hidden = !bw; $('tb-shop').hidden = !bw;
      } else R.draw(null, dt, fps);
      if (Game.showBoard && (sbTimer -= dt) <= 0) { sbTimer = 400; renderBoard(); }
      if ((hintT -= dt) <= 0) { hintT = 500; $('rotate-hint').hidden = !(I.isTouch && window.innerHeight > window.innerWidth * 1.1); }
    } else if (Game.demo) {
      Game.demo.update(dt);
      R.draw(Game.demo.scene(), dt, fps);
    } else R.draw(null, dt, fps);
  }

  function renderBoard() {
    const s = Game.session;
    if (!s) return;
    const pings = new Map();
    if (Game.room) for (const m of Game.room.members) pings.set(m.pid, m.ping);
    UI.renderScoreboard(s.scoreboard(), { mode: modeOf(s), meId: s.myTankId, pings: s.isNet ? pings : null });
  }

  // ---------- Пауза / меню в игре ----------
  function openPause() {
    if (!Game.session || Game.resultOpen) return;
    const s = Game.session;
    Game.paused = true;
    if (!s.isNet) s.paused = true;
    I.clear();
    UI.showShop(false);
    $('pause-title').textContent = s.isNet ? 'Меню' : 'Пауза';
    $('pause-restart').hidden = s.isNet;
    $('pause-lobby').hidden = !(s.isNet && Game.room && Game.room.host === Game.myPid);
    $('pause-exit').textContent = s.isNet ? '✕ Выйти из комнаты' : '✕ Выйти в меню';
    $('pause-info').textContent = s.isNet ? `Комната ${Game.room ? Game.room.code : ''} · игра продолжается` : '';
    $('ov-pause').hidden = false;
  }
  function closePause() {
    Game.paused = false;
    if (Game.session && !Game.session.isNet) Game.session.paused = false;
    $('ov-pause').hidden = true;
    I.clear();
    I.enabled = !!Game.session;
  }

  function toggleShop() {
    const sc = Game.lastScene;
    if (!sc || !sc.pers || !sc.pers.shop) return;
    if (!UI.shopOpen && (!sc.me || !sc.me.alive)) return;
    UI.showShop(!UI.shopOpen);
    if (UI.shopOpen) UI.renderShop(sc.pers, (i) => Game.act(16 + i));
    A.play('click');
  }

  // ---------- Чат в игре ----------
  function openChat() {
    if (!Game.session || !Game.session.isNet) return;
    Game.chatOpen = true;
    I.clear();
    $('game-chat-form').hidden = false;
    const inp = $('game-chat-input');
    inp.value = '';
    setTimeout(() => inp.focus(), 0);
  }
  function closeChat() {
    Game.chatOpen = false;
    $('game-chat-form').hidden = true;
    $('game-chat-input').blur();
    I.clear();
  }

  function enterFullscreen(landscape) {
    const d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) return;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try {
      const p = req.call(el);
      if (p && p.then && landscape && screen.orientation && screen.orientation.lock) p.then(() => screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    } catch (e) { /* игнор */ }
  }
  function toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) enterFullscreen(I.isTouch);
    else (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d);
  }

  function updateTouchButtons() {
    const show = !!Game.session && I.isTouch;
    $('btn-touch-menu').hidden = !show;
    $('btn-touch-score').hidden = !show;
    $('tb-fire').hidden = !(show && !I.cfg.autoFire);
    if (!show) { $('tb-block').hidden = true; $('tb-shop').hidden = true; }
    document.body.classList.toggle('touch', I.isTouch);
    $('main-foot').textContent = I.isTouch ? 'Левая половина экрана — движение, правая — прицел и огонь' : 'WASD — движение · Мышь — прицел · ЛКМ/Пробел — огонь';
  }

  function clearHash() { if (location.hash) history.replaceState(null, '', location.pathname + location.search); }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => false);
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return Promise.resolve(ok);
  }

  // ---------- Сеть ----------
  function netSetup() {
    Net.profile = UI.profile();
    Net.on('open', () => {
      UI.setConn(false);
      if (UI.current === 'multi') UI.renderMulti();
      if (Game.pending) { Net.send(Game.pending); Game.pending = null; }
    });
    Net.on('close', () => {
      if (Game.room || Net.code) UI.setConn(true, 'Связь с сервером потеряна. Переподключение…');
      if (UI.current === 'multi') UI.renderMulti();
    });
    Net.on('replaced', () => {
      Game.room = null; clearHash(); UI.setConn(false);
      if (Game.session) Game.endSession();
      UI.show('main');
      UI.toast('Игра открыта в другой вкладке — это окно отключено', 4000);
    });
    Net.on('joined', (m) => {
      if (Game.myRoomCode !== m.code) { $('lobby-chat').innerHTML = ''; Game.room = null; }
      Game.myRoomCode = m.code;
      Game.myPid = m.pid;
      history.replaceState(null, '', location.pathname + location.search + '#' + m.code);
      UI.setConn(false);
      if (!Game.session) UI.show('lobby');
    });
    Net.on('room', (m) => {
      Game.room = m;
      Game.roomPlayers.clear();
      for (const p of m.members) Game.roomPlayers.set(p.pid, p);
      if (UI.current === 'lobby') UI.renderLobby();
      if (m.state === 'lobby' && Game.session && Game.session.isNet) { Game.endSession(); UI.show('lobby'); UI.renderLobby(); }
    });
    Net.on('start', (m) => Game.startNet(m));
    Net.on('end', (m) => { if (Game.session && Game.session.isNet) Game.showResult(m.result, false); });
    Net.on('lobby', () => { if (Game.session) Game.endSession(); UI.show('lobby'); UI.renderLobby(); });
    Net.on('chat', (m) => UI.addChat(m));
    Net.on('error', (m) => {
      UI.toast(m.msg || 'Ошибка');
      if (m.code === 'noroom') {
        try { sessionStorage.removeItem('tbo_tok_' + Net.code); } catch (e) { /* игнор */ }
        Net.code = null; Net.token = null; Game.room = null; clearHash();
        UI.setConn(false);
        if (Game.session && Game.session.isNet) Game.endSession();
        if (UI.current === 'lobby' || !UI.current) UI.show('multi');
      }
    });
    Net.on('pings', (m) => {
      if (!Game.room) return;
      const map = new Map(m.p);
      for (const mem of Game.room.members) if (map.has(mem.pid)) mem.ping = map.get(mem.pid);
      if (UI.current === 'lobby') UI.renderLobby();
    });
    Net.on('snap', (s) => { if (Game.session && Game.session.isNet) Game.session.onSnapshot(s); });
  }

  function joinCode(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    if (code.length !== 4) { UI.toast('Введите 4-значный код комнаты'); return; }
    let tok = null;
    try { tok = sessionStorage.getItem('tbo_tok_' + code); } catch (e) { /* игнор */ }
    Net.code = code; Net.token = tok;
    if (Net.connected) Net.send({ t: 'join', code, token: tok });
    else Net.connect();
  }

  function saveNameFrom(input) {
    const v = input.value.replace(/[<>]/g, '').trim().slice(0, 16);
    if (v && v !== UI.settings.name) { UI.settings.name = v; UI.applyProfile(); }
  }

  // Кнопка, работающая при удержании (для сенсорных экранов)
  function holdButton(el, onDown, onUp) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (err) { /* игнор */ } onDown(); });
    const up = (e) => { e.stopPropagation(); if (onUp) onUp(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------- Привязка элементов ----------
  function bind() {
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (!b) return;
      A.init(); A.play('click');
      const go = b.dataset.go;
      if (go === 'back') {
        const to = UI.returnTo;
        UI.returnTo = null;
        if (to === 'pause' || (!to && Game.session)) { UI.show(null); if (Game.session) openPause(); }
        else UI.show(to || 'main');
        return;
      }
      UI.show(go);
    });

    $('solo-start').onclick = () => Game.startSolo(UI.solo.mode, UI.solo.opts || UI.defaultOpts(UI.solo.mode, true));

    // мультиплеер
    $('multi-name').addEventListener('change', (e) => saveNameFrom(e.target));
    $('btn-create').onclick = () => {
      saveNameFrom($('multi-name'));
      const msg = { t: 'create', mode: 'arena', opts: UI.defaultOpts('arena', false) };
      if (Net.connected) Net.send(msg); else { Game.pending = msg; Net.connect(); }
    };
    $('btn-join').onclick = () => { saveNameFrom($('multi-name')); joinCode($('join-code').value); };
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
    $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); });

    // лобби
    $('btn-copy-link').onclick = () => {
      const link = location.origin + location.pathname + '#' + (Game.room ? Game.room.code : '');
      copyText(link).then((ok) => UI.toast(ok ? 'Ссылка скопирована — отправьте её друзьям!' : 'Скопируйте ссылку вручную: ' + link, 3500));
    };
    $('btn-start').onclick = () => Net.send({ t: 'start' });
    $('btn-leave').onclick = () => { Net.leaveRoom(); Game.room = null; clearHash(); UI.show('multi'); };
    $('lobby-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('lobby-chat-input');
      if (inp.value.trim()) Net.send({ t: 'chat', text: inp.value });
      inp.value = '';
    });

    // настройки
    const S = UI.settings;
    const persist = () => { UI.saveSettings(); UI.applyGameSettings(); updateTouchButtons(); };
    $('set-name').addEventListener('input', (e) => { const v = e.target.value.replace(/[<>]/g, '').slice(0, 16); if (v.trim()) { S.name = v.trim(); UI.saveSettings(); } });
    $('set-name').addEventListener('change', () => UI.applyProfile());
    const range = (id, key) => $(id).addEventListener('input', (e) => { S[key] = +e.target.value; $(id + '-v').textContent = S[key] + '%'; persist(); });
    range('set-volume', 'volume'); range('set-sfx', 'sfx'); range('set-music', 'music'); range('set-particles', 'particles'); range('set-zoom', 'zoom');
    $('set-sfx').addEventListener('change', () => A.play('pick'));
    $('set-quality').addEventListener('change', (e) => { S.quality = e.target.value; persist(); });
    const check = (id, key) => $(id).addEventListener('change', (e) => { S[key] = e.target.checked; persist(); });
    check('set-fps', 'showFps'); check('set-shake', 'shake'); check('set-names', 'names'); check('set-dmg', 'dmgNums');
    check('set-minimap', 'minimap'); check('set-vibrate', 'vibrate'); check('set-autofire', 'autoFire'); check('set-lefty', 'lefty'); check('set-autofs', 'autoFs');
    $('btn-fullscreen').onclick = toggleFullscreen;
    $('btn-test-sound').onclick = () => { A.init(); A.play('pick'); A.buzz(60); Game.updateMusic(); };

    // админ
    $('admin-login').addEventListener('submit', (e) => {
      e.preventDefault();
      if ($('admin-pass').value === 'admin') { UI.adminOk = true; UI.renderAdmin(); A.play('pick'); }
      else { $('admin-err').hidden = false; A.play('hit'); }
    });
    const saveAdmin = () => { try { localStorage.setItem('tbo_admin', JSON.stringify(UI.admin)); } catch (err) { /* игнор */ } };
    const adm = (id, key, fmt) => $(id).addEventListener('input', (e) => {
      UI.admin[key] = +e.target.value;
      $(id + '-v').textContent = fmt ? fmt(UI.admin[key]) : UI.admin[key];
      saveAdmin();
    });
    adm('adm-speed', 'player_speed');
    adm('adm-bullet', 'bullet_speed', (v) => v.toFixed(1));
    adm('adm-rate', 'fire_rate');
    $('adm-god').addEventListener('change', (e) => { UI.admin.god_mode = e.target.checked; saveAdmin(); });
    $('adm-reset').onclick = () => { Object.assign(UI.admin, { player_speed: 3, bullet_speed: 1.0, fire_rate: 470, god_mode: false }); saveAdmin(); UI.renderAdmin(); };

    // пауза
    $('pause-resume').onclick = closePause;
    $('pause-restart').onclick = () => { closePause(); if (Game.session && !Game.session.isNet) { Game.session.restart(false); UI.resetInGame(); } };
    $('pause-lobby').onclick = () => { closePause(); Net.send({ t: 'stop' }); };
    $('pause-settings').onclick = () => { $('ov-pause').hidden = true; UI.returnTo = 'pause'; UI.show('settings'); };
    $('pause-exit').onclick = () => { closePause(); Game.exitToMenu(); };

    // результаты
    const restartLocal = (next) => { const s = Game.session; UI.hideResult(); Game.resultOpen = false; s.restart(next); UI.resetInGame(); I.clear(); };
    $('res-next').onclick = () => { const s = Game.session; if (s && !s.isNet) restartLocal(true); else Net.send({ t: 'post', act: 'next' }); };
    $('res-again').onclick = () => { const s = Game.session; if (s && !s.isNet) restartLocal(false); else Net.send({ t: 'post', act: 'again' }); };
    $('res-lobby').onclick = () => Net.send({ t: 'post', act: 'lobby' });
    $('res-exit').onclick = () => Game.exitToMenu();

    // чат в игре
    $('game-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('game-chat-input').value;
      if (v.trim()) Net.send({ t: 'chat', text: v });
      closeChat();
    });
    $('game-chat-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeChat(); } });

    // магазин
    $('shop-close').onclick = (e) => { e.stopPropagation(); UI.showShop(false); };
    $('shop').addEventListener('pointerdown', (e) => e.stopPropagation());

    // сенсорные кнопки
    holdButton($('btn-touch-menu'), () => (Game.paused ? closePause() : openPause()));
    holdButton($('btn-touch-score'), () => { Game.showBoard = !Game.showBoard; $('scoreboard').hidden = !Game.showBoard; if (Game.showBoard) renderBoard(); });
    holdButton($('tb-fire'), () => { I.fireBtn = true; }, () => { I.fireBtn = false; });
    holdButton($('tb-block'), () => { Game.act(4); A.buzz(15); });
    holdButton($('tb-shop'), toggleShop);

    // Горячие клавиши
    I.onKey = (e) => {
      A.init();
      if (e.code === 'KeyF' && !e.ctrlKey && !e.altKey && (Game.session ? !Game.chatOpen : true) && UI.current !== 'lobby') { toggleFullscreen(); return false; }
      if (!Game.session) {
        if (e.code === 'Escape' && UI.current && UI.current !== 'main' && UI.current !== 'lobby') { UI.show(UI.current === 'settings' ? (UI.returnTo || 'main') : 'main'); return false; }
        return true;
      }
      if (e.code === 'Escape') {
        if (UI.shopOpen) { UI.showShop(false); return false; }
        if (Game.showBoard) { Game.showBoard = false; $('scoreboard').hidden = true; return false; }
        if (UI.current) { UI.show(null); openPause(); return false; }
        if (Game.resultOpen) return false;
        if (Game.paused) closePause(); else openPause();
        return false;
      }
      if (e.code === 'Tab') {
        if (!Game.showBoard) { Game.showBoard = true; $('scoreboard').hidden = false; renderBoard(); }
        return false;
      }
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && Game.session.isNet && !Game.paused && !UI.current) { openChat(); return false; }
      if (Game.paused || UI.current || Game.resultOpen) return true;
      if (e.code === 'KeyB') { toggleShop(); return false; }
      if (e.code === 'KeyE' || e.code === 'KeyQ') { Game.act(4); return false; }
      const m = /^(Digit|Numpad)([1-8])$/.exec(e.code);
      if (m) {
        const n = +m[2];
        if (UI.shopOpen) Game.act(16 + n - 1);
        else if (n <= 3) Game.act(n);
        return false;
      }
      return true;
    };
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab' && Game.showBoard && !I.isTouch) { Game.showBoard = false; $('scoreboard').hidden = true; }
    });
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' && !I.isTouch) { I.isTouch = true; updateTouchButtons(); }
      else if (e.pointerType === 'mouse' && I.isTouch) { I.isTouch = false; updateTouchButtons(); }
    }, true);
  }

  // ---------- Запуск ----------
  function boot() {
    R.init($('game'));
    I.init($('game'));
    UI.applyGameSettings();
    bind();
    netSetup();
    startDemo();
    UI.show('main');
    updateTouchButtons();
    const m = /^#([A-Za-z0-9]{4})$/.exec(location.hash);
    if (m && Net.available()) {
      UI.show('multi');
      $('join-code').value = m[1].toUpperCase();
      joinCode(m[1]);
    }
    requestAnimationFrame((t) => { last = t; frame(t); });
  }
  boot();
})(self.TG);
