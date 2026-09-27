/* Главный модуль: игровой цикл и связь интерфейса, сессий и сети. */
(function (TG) {
  'use strict';
  const UI = TG.UI, R = TG.Render, I = TG.Input, A = TG.Audio, Net = TG.Net;
  const $ = UI.$;

  const Game = TG.Game = {
    session: null, demo: null, room: null, myPid: 0, roomPlayers: new Map(),
    liveAim: null, lastScene: null, paused: false, chatOpen: false, showBoard: false, resultOpen: false, pending: null
  };

  // ---------- Ввод для симуляции ----------
  Game.sampleInput = function () {
    const active = I.enabled && !Game.paused && !Game.chatOpen && !Game.resultOpen;
    const mv = active ? I.moveVector() : [0, 0];
    return { mx: mv[0], my: mv[1], a: Game.liveAim != null ? Game.liveAim : 0, fire: active && I.firing(), up: I.takeUpgrade() };
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
    const mode = local ? s.mode : s.info.mode;
    if (local) {
      if (mode === 'levels' && res.win) { const lv = s.options.level; if (!UI.progress.levels.includes(lv)) UI.progress.levels.push(lv); }
      if (mode === 'waves' && res.score != null) UI.progress.bestWave = Math.max(UI.progress.bestWave, res.score);
      if (mode === 'survival') { const me = res.board && res.board.find((r) => r.id === myTank); if (me) UI.progress.bestLevel = Math.max(UI.progress.bestLevel, me.lvl || 0); }
      UI.saveProgress();
    }
    Game.resultOpen = true;
    Game.chatOpen = false; $('game-chat-form').hidden = true;
    UI.showResult(res, { local, isHost: Game.room && Game.room.host === Game.myPid, win, draw: !!res.draw, mode, meId: myTank });
  };

  // ---------- Главный цикл ----------
  let last = performance.now(), fps = 60, sbTimer = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = now - last;
    last = now;
    if (dt > 250) dt = 250;
    if (dt > 0) fps = fps * 0.95 + (1000 / dt) * 0.05;
    const s = Game.session;
    if (s) {
      const me = Game.lastScene && Game.lastScene.me;
      if (me && me.alive && !Game.paused && !Game.chatOpen) {
        const p = R.worldToScreen(me.x, me.y);
        Game.liveAim = I.aimAngle(p[0], p[1]);
      }
      s.update(dt);
      const sc = s.scene();
      if (sc) {
        Game.lastScene = sc;
        const f = sc.me && sc.me.alive ? sc.me : sc.focus;
        if (f) A.setListener(f.x, f.y);
        R.draw(sc, dt, fps);
        UI.updateUpgrades(sc.pers, s);
      } else R.draw(null, dt, fps);
      if (Game.showBoard && (sbTimer -= dt) <= 0) { sbTimer = 400; renderBoard(); }
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
    UI.renderScoreboard(s.scoreboard(), { mode: s.isNet ? s.info.mode : s.mode, meId: s.myTankId, pings: s.isNet ? pings : null });
  }

  // ---------- Пауза / меню в игре ----------
  function openPause() {
    if (!Game.session || Game.resultOpen) return;
    const s = Game.session;
    Game.paused = true;
    if (!s.isNet) s.paused = true;
    I.clear();
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

  // ---------- Чат в игре ----------
  function openChat() {
    if (!Game.session || !Game.session.isNet) return;
    Game.chatOpen = true;
    I.clear();
    const f = $('game-chat-form');
    f.hidden = false;
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

  function toggleFullscreen() {
    const d = document;
    if (!d.fullscreenElement && !d.webkitFullscreenElement) {
      const el = d.documentElement;
      (el.requestFullscreen || el.webkitRequestFullscreen || (() => {})).call(el);
    } else (d.exitFullscreen || d.webkitExitFullscreen || (() => {})).call(d);
  }

  function updateTouchButtons() {
    const show = !!Game.session && I.isTouch;
    $('btn-touch-menu').hidden = !show;
    $('btn-touch-score').hidden = !show;
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
    window.addEventListener('pointerdown', () => A.init(), { once: false, passive: true });

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
    for (const b of document.querySelectorAll('#lobby-teams .btn')) b.onclick = () => Net.send({ t: 'team', team: +b.dataset.team });
    $('btn-start').onclick = () => Net.send({ t: 'start' });
    $('btn-leave').onclick = () => { Net.leaveRoom(); Game.room = null; clearHash(); UI.show('multi'); };
    $('lobby-chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const inp = $('lobby-chat-input');
      if (inp.value.trim()) Net.send({ t: 'chat', text: inp.value });
      inp.value = '';
    });

    // настройки
    $('set-name').addEventListener('input', (e) => { const v = e.target.value.replace(/[<>]/g, '').slice(0, 16); if (v.trim()) { UI.settings.name = v.trim(); UI.saveSettings(); } });
    $('set-name').addEventListener('change', () => UI.applyProfile());
    $('set-volume').addEventListener('input', (e) => { UI.settings.volume = +e.target.value; UI.saveSettings(); UI.applyGameSettings(); });
    $('set-volume').addEventListener('change', () => { A.init(); A.play('pick'); });
    $('set-quality').addEventListener('change', (e) => { UI.settings.quality = e.target.value; UI.saveSettings(); UI.applyGameSettings(); });
    $('set-fps').addEventListener('change', (e) => { UI.settings.showFps = e.target.checked; UI.saveSettings(); UI.applyGameSettings(); });
    $('set-shake').addEventListener('change', (e) => { UI.settings.shake = e.target.checked; UI.saveSettings(); UI.applyGameSettings(); });
    $('set-names').addEventListener('change', (e) => { UI.settings.names = e.target.checked; UI.saveSettings(); UI.applyGameSettings(); });
    $('btn-fullscreen').onclick = toggleFullscreen;

    // админ
    $('admin-login').addEventListener('submit', (e) => {
      e.preventDefault();
      if ($('admin-pass').value === 'admin') { UI.adminOk = true; UI.renderAdmin(); A.play('pick'); }
      else { $('admin-err').hidden = false; A.play('hit'); }
    });
    const adm = (id, key, fmt) => $(id).addEventListener('input', (e) => {
      UI.admin[key] = +e.target.value;
      $(id + '-v').textContent = fmt ? fmt(UI.admin[key]) : UI.admin[key];
      try { localStorage.setItem('tbo_admin', JSON.stringify(UI.admin)); } catch (err) { /* игнор */ }
    });
    adm('adm-speed', 'player_speed');
    adm('adm-bullet', 'bullet_speed', (v) => v.toFixed(1));
    adm('adm-rate', 'fire_rate');
    $('adm-god').addEventListener('change', (e) => { UI.admin.god_mode = e.target.checked; try { localStorage.setItem('tbo_admin', JSON.stringify(UI.admin)); } catch (err) { /* игнор */ } });
    $('adm-reset').onclick = () => {
      Object.assign(UI.admin, { player_speed: 3, bullet_speed: 1.0, fire_rate: 500, god_mode: false });
      try { localStorage.setItem('tbo_admin', JSON.stringify(UI.admin)); } catch (err) { /* игнор */ }
      UI.renderAdmin();
    };

    // пауза
    $('pause-resume').onclick = closePause;
    $('pause-restart').onclick = () => { closePause(); if (Game.session && !Game.session.isNet) { Game.session.restart(false); UI.resetInGame(); } };
    $('pause-lobby').onclick = () => { closePause(); Net.send({ t: 'stop' }); };
    $('pause-settings').onclick = () => { $('ov-pause').hidden = true; UI.returnTo = 'pause'; UI.show('settings'); UI.returnTo = 'pause'; };
    $('pause-exit').onclick = () => { closePause(); Game.exitToMenu(); };

    // результаты
    $('res-next').onclick = () => {
      const s = Game.session;
      if (s && !s.isNet) { UI.hideResult(); Game.resultOpen = false; s.restart(true); UI.resetInGame(); I.clear(); }
      else Net.send({ t: 'post', act: 'next' });
    };
    $('res-again').onclick = () => {
      const s = Game.session;
      if (s && !s.isNet) { UI.hideResult(); Game.resultOpen = false; s.restart(false); UI.resetInGame(); I.clear(); }
      else Net.send({ t: 'post', act: 'again' });
    };
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

    // сенсорные кнопки
    $('btn-touch-menu').onclick = () => (Game.paused ? closePause() : openPause());
    $('btn-touch-score').onclick = () => { Game.showBoard = !Game.showBoard; $('scoreboard').hidden = !Game.showBoard; if (Game.showBoard) renderBoard(); };

    // Горячие клавиши
    I.onKey = (e) => {
      A.init();
      if (e.code === 'KeyF' && !e.ctrlKey && !e.altKey && (Game.session ? !Game.chatOpen : true) && UI.current !== 'lobby') { toggleFullscreen(); return false; }
      if (!Game.session) {
        if (e.code === 'Escape' && UI.current && UI.current !== 'main' && UI.current !== 'lobby') { UI.show(UI.current === 'settings' ? (UI.returnTo || 'main') : 'main'); return false; }
        return true;
      }
      if (e.code === 'Escape') {
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
      return true;
    };
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Tab' && Game.showBoard && !I.isTouch) { Game.showBoard = false; $('scoreboard').hidden = true; }
    });
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { I.isTouch = true; updateTouchButtons(); } else if (e.pointerType === 'mouse' && I.isTouch) { I.isTouch = false; updateTouchButtons(); } });
    window.addEventListener('beforeunload', () => { /* позволяем переподключиться по токену после перезагрузки */ });
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
