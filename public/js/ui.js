/* Интерфейс: меню, лобби, настройки, результаты, чат, таблица счёта, магазин. */
(function (TG) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const UI = TG.UI = {};
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const icon = (id, cls) => `<svg class="${cls || 'ic'}"><use href="#${id}"/></svg>`;
  UI.esc = esc;

  // ---------- Хранилище ----------
  function load(key, def) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? def : Object.assign(Array.isArray(def) ? [] : {}, def, v); } catch (e) { return def; }
  }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* игнор */ } }

  const randomName = () => 'Танкист' + Math.floor(100 + Math.random() * 900);
  const isTouchDev = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  UI.settings = Object.assign({
    name: randomName(), colorName: 'Green', shape: 'Circle', avatar: '', volume: 70, sfx: 80, music: 0, vibrate: true,
    quality: isTouchDev ? 'medium' : 'high', particles: 100, zoom: 100, shake: true, dmgNums: true, names: true, minimap: true, showFps: false, ffBullets: true,
    stick: 'm', assist: 1, autoFire: true, lefty: false, autoFs: true, v: 4
  }, load('tbo_settings', {}));
  if (UI.settings.v !== 4) { UI.settings.music = 0; UI.settings.ffBullets = true; UI.settings.v = 4; }
  if (!TG.PLAYER_COLORS[UI.settings.colorName]) UI.settings.colorName = 'Green';
  if (!TG.SHAPES.includes(UI.settings.shape)) UI.settings.shape = 'Circle';
  UI.admin = load('tbo_admin', { player_speed: 3, bullet_speed: 1.0, fire_rate: 470, god_mode: false });
  UI.progress = load('tbo_progress3', { stars: {}, bestWave: 0, bestLevel: 0, cdiff: 2 });
  UI.saveSettings = () => save('tbo_settings', UI.settings);
  UI.saveProgress = () => save('tbo_progress3', UI.progress);
  UI.profile = () => ({ name: UI.settings.name, color: TG.PLAYER_COLORS[UI.settings.colorName], shape: UI.settings.shape, avatar: UI.settings.avatar || '' });
  UI.saveSettings();

  const MODE_ICONS = { levels: 'i-target', waves: 'i-waves', survival: 'i-star', arena: 'i-swords', ctf: 'i-flag', bedwars: 'i-shield', royale: 'i-crown' };

  // ---------- Экраны ----------
  const SCREENS = ['main', 'solo', 'multi', 'lobby', 'settings', 'help', 'admin'];
  UI.current = 'main';
  UI.show = function (name) {
    if (name === 'settings' && UI.current !== 'settings' && UI.returnTo !== 'pause') UI.returnTo = UI.current;
    UI.current = name;
    for (const s of SCREENS) $('scr-' + s).hidden = s !== name;
    if (name === 'main') UI.renderMain();
    if (name === 'settings') UI.renderSettings();
    if (name === 'solo') UI.renderSolo();
    if (name === 'multi') UI.renderMulti();
    if (name === 'admin') UI.renderAdmin();
    if (name === 'help') UI.renderHelp();
    if (name) { $('ov-pause').hidden = true; UI.showShop(false); }
    TG.Input.enabled = !name && TG.Game.session != null;
    if (TG.Game.updateMusic) TG.Game.updateMusic();
  };

  UI.toast = function (text, ms) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(UI._toast);
    UI._toast = setTimeout(() => { t.hidden = true; }, ms || 2600);
  };

  function drawPreview(id, size) {
    const cv = $(id);
    if (!cv) return;
    const S = UI.settings;
    TG.Render.drawTankIcon(cv.getContext('2d'), S.shape, TG.PLAYER_COLORS[S.colorName], size || cv.width * 0.24, S.avatar, () => drawPreview(id, size));
  }
  UI.drawPreview = drawPreview;
  UI.renderMain = function () {
    drawPreview('main-preview', 22);
    $('main-name').textContent = UI.settings.name;
  };

  // ---------- Опции режимов ----------
  const DIFF_NAMES = ['Легко', 'Средне', 'Сложно', 'Эксперт'];
  UI.defaultOpts = function (mode, solo) {
    switch (mode) {
      case 'levels': {
        let lvl = 1;
        for (let i = 1; i <= TG.CAMPAIGN.length; i++) if (!UI.progress.stars[i]) { lvl = i; break; }
        return { level: lvl, cdiff: UI.progress.cdiff || 2 };
      }
      case 'ctf': return { teamSize: solo ? 5 : 4, diff: 2, caps: 3, time: 10 };
      case 'arena': return { bots: solo ? 5 : 2, diff: 2, kills: 10, teams: false };
      case 'bedwars': return { teams: solo ? 4 : 2, size: 2, diff: 2, time: 15 };
      case 'royale': return { total: 10, diff: 2, fast: false };
      default: return {};
    }
  };

  function seg(label, values, cur, fmt, onPick, ro) {
    const row = document.createElement('div');
    row.className = 'opt';
    row.innerHTML = `<label>${esc(label)}</label>`;
    const box = document.createElement('div');
    box.className = 'seg';
    for (const v of values) {
      const b = document.createElement('button');
      b.className = 'btn' + (v === cur ? ' sel' : '');
      b.textContent = fmt ? fmt(v) : v;
      b.disabled = !!ro && v !== cur;
      if (!ro) b.onclick = () => { TG.Audio.play('click'); onPick(v); };
      box.appendChild(b);
    }
    row.appendChild(box);
    return row;
  }
  function note(el, html) { const t = document.createElement('p'); t.className = 'hint'; t.innerHTML = html; el.appendChild(t); }

  function levelInfo(lv) {
    const L = TG.CAMPAIGN[lv - 1];
    const d = document.createElement('div');
    d.className = 'level-info';
    let enemies = '';
    const list = L.obj === 'survive' ? L.pool.map((k) => [k, null]) : L.e;
    for (const [k, n] of list) {
      const kd = TG.BOT_KINDS[TG.KIND[k]];
      enemies += `<span class="en"><i style="background:${rgb(kd.c)}"></i>${esc(kd.name)}${n ? ' ×' + n : ''}</span>`;
    }
    const obj = L.obj === 'survive' ? `Продержитесь ${L.time} секунд` : 'Уничтожьте всех врагов';
    const st = UI.progress.stars[lv] || 0;
    d.innerHTML = `<div class="ln">${lv}. ${esc(L.n)}${st ? `<span class="stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span>` : ''}</div><div class="muted">${obj}</div><div>${enemies}</div>${L.tip ? `<div class="muted small">${esc(L.tip)}</div>` : ''}`;
    return d;
  }

  UI.buildOpts = function (el, mode, opts, onChange, ro, solo) {
    el.innerHTML = '';
    const set = (k, v) => { const o = Object.assign({}, opts, { [k]: v }); onChange(o); };
    if (mode === 'levels') {
      el.appendChild(seg('Сложность', [1, 2, 3], opts.cdiff || 2, (v) => TG.CAMPAIGN_DIFF[v].name, (v) => { UI.progress.cdiff = v; UI.saveProgress(); set('cdiff', v); }, ro));
      const grid = document.createElement('div');
      grid.className = 'levels';
      for (let i = 1; i <= TG.CAMPAIGN.length; i++) {
        const L = TG.CAMPAIGN[i - 1];
        const b = document.createElement('button');
        const boss = L.e && L.e.some(([k]) => TG.BOT_KINDS[TG.KIND[k]].boss);
        b.className = 'btn' + (i === opts.level ? ' sel' : '') + (boss ? ' boss' : '') + (L.obj === 'survive' ? ' surv' : '');
        const st = solo ? UI.progress.stars[i] || 0 : 0;
        b.innerHTML = i + '<span class="tag"></span>' + (st ? `<span class="st">${'★'.repeat(st)}</span>` : '');
        b.title = L.n;
        b.disabled = !!ro && i !== opts.level;
        if (!ro) b.onclick = () => { TG.Audio.play('click'); set('level', i); };
        grid.appendChild(b);
      }
      el.appendChild(grid);
      const lg = document.createElement('div');
      lg.className = 'legend';
      lg.innerHTML = '<span><i style="background:#ff8a4c"></i>босс</span><span><i style="background:var(--accent)"></i>продержаться</span>';
      el.appendChild(lg);
      el.appendChild(levelInfo(opts.level || 1));
    } else if (mode === 'ctf') {
      el.appendChild(seg('Танков в команде', [1, 2, 3, 4, 5, 6, 7, 8, 10], opts.teamSize, null, (v) => set('teamSize', v), ro));
      el.appendChild(seg('Сложность ботов', [1, 2, 3, 4], opts.diff, (v) => DIFF_NAMES[v - 1], (v) => set('diff', v), ro));
      el.appendChild(seg('Захватов до победы', [1, 3, 5], opts.caps, null, (v) => set('caps', v), ro));
      el.appendChild(seg('Время матча', [5, 10, 15], opts.time, (v) => v + ' мин', (v) => set('time', v), ro));
    } else if (mode === 'arena') {
      el.appendChild(seg('Формат', [false, true], !!opts.teams, (v) => v ? '2 команды' : 'Все против всех', (v) => set('teams', v), ro));
      el.appendChild(seg('Ботов', [0, 1, 2, 3, 4, 5, 6, 8], opts.bots, null, (v) => set('bots', v), ro));
      el.appendChild(seg('Сложность ботов', [1, 2, 3, 4], opts.diff, (v) => DIFF_NAMES[v - 1], (v) => set('diff', v), ro));
      el.appendChild(seg(opts.teams ? 'Убийств до победы (×2 команде)' : 'Убийств до победы', [5, 10, 20, 30], opts.kills, null, (v) => set('kills', v), ro));
    } else if (mode === 'bedwars') {
      el.appendChild(seg('Команд', [2, 4], opts.teams, null, (v) => set('teams', v), ro));
      el.appendChild(seg('Танков в команде', [1, 2, 3, 4], opts.size, null, (v) => set('size', v), ro));
      el.appendChild(seg('Сложность ботов', [1, 2, 3, 4], opts.diff, (v) => DIFF_NAMES[v - 1], (v) => set('diff', v), ro));
      el.appendChild(seg('Время матча', [10, 15, 20], opts.time, (v) => v + ' мин', (v) => set('time', v), ro));
      note(el, 'Пока ядро вашей команды цело, вы возрождаетесь. Кристаллы даёт генератор за пределами базы, алмазы — генераторы в центре. B — магазин, E — блок, R — бомба.');
    } else if (mode === 'royale') {
      el.appendChild(seg('Всего танков', [6, 10, 16, 24], opts.total, null, (v) => set('total', v), ro));
      el.appendChild(seg('Сложность ботов', [1, 2, 3, 4], opts.diff, (v) => DIFF_NAMES[v - 1], (v) => set('diff', v), ro));
      el.appendChild(seg('Скорость зоны', [false, true], !!opts.fast, (v) => v ? 'Быстрая' : 'Обычная', (v) => set('fast', v), ro));
      note(el, 'У всех 5 HP, возрождений нет. Вне зоны теряется здоровье. Побеждает последний выживший.');
    } else if (mode === 'waves') {
      note(el, `Рекорд: ${UI.progress.bestWave} волн. Каждая 5-я волна — с боссом. Погибшие друзья возвращаются в следующей волне.`);
    } else if (mode === 'survival') {
      note(el, `Рекорд: уровень ${UI.progress.bestLevel}. За уровни выбирайте улучшения клавишами 1–3. Каждые 3 минуты — босс.`);
    }
  };

  function modeCards(el, cur, onPick, ro) {
    el.innerHTML = '';
    for (const id of TG.MODE_LIST) {
      const m = TG.MODE_INFO[id];
      const b = document.createElement('div');
      b.className = 'mode-card' + (id === cur ? ' sel' : '');
      b.innerHTML = `<div class="mode-ic">${icon(MODE_ICONS[id])}</div><div><b>${esc(m.name)}</b><span>${esc(m.desc)}</span></div>`;
      if (!ro) b.onclick = () => { TG.Audio.play('click'); onPick(id); };
      el.appendChild(b);
    }
  }

  // ---------- Одиночная игра ----------
  UI.solo = { mode: 'levels', opts: null };
  UI.renderSolo = function () {
    const S = UI.solo;
    if (!S.opts) S.opts = UI.defaultOpts(S.mode, true);
    modeCards($('solo-modes'), S.mode, (m) => { S.mode = m; S.opts = UI.defaultOpts(m, true); UI.renderSolo(); });
    UI.buildOpts($('solo-opts'), S.mode, S.opts, (o) => { S.opts = o; UI.renderSolo(); }, false, true);
  };

  // ---------- Мультиплеер ----------
  UI.renderMulti = function () {
    $('multi-name').value = UI.settings.name;
    const st = $('multi-status');
    if (!TG.Net.available()) {
      st.className = 'status bad';
      st.innerHTML = 'Игра открыта как файл. Чтобы играть с друзьями, запустите сервер (start.bat) и откройте http://localhost:3000';
      $('btn-create').disabled = $('btn-join').disabled = true;
    } else {
      $('btn-create').disabled = $('btn-join').disabled = false;
      st.className = 'status ' + (TG.Net.connected ? 'ok' : '');
      st.textContent = TG.Net.connected ? 'Подключено к серверу' : 'Подключение к серверу…';
      TG.Net.connect();
    }
  };

  // ---------- Лобби ----------
  function teamCount(room) {
    if (room.mode === 'ctf' || (room.mode === 'arena' && room.opts.teams)) return 2;
    if (room.mode === 'bedwars') return room.opts.teams === 4 ? 4 : 2;
    return 0;
  }
  UI.renderLobby = function () {
    const room = TG.Game.room;
    if (!room) return;
    const me = TG.Game.myPid, isHost = room.host === me;
    $('lobby-code').textContent = room.code;
    $('lobby-link').textContent = location.origin + location.pathname + '#' + room.code;
    $('lobby-count').textContent = `${room.members.filter((m) => !m.off).length}/${TG.C.MAX_PLAYERS}`;
    const nT = teamCount(room);
    const pl = $('lobby-players');
    pl.innerHTML = '';
    for (const m of room.members) {
      const d = document.createElement('div');
      d.className = 'pl' + (m.off ? ' off' : '');
      const av = TG.Game.avatars.get(m.pid);
      const tc = TG.TEAM_COLORS[m.team];
      const inTeam = nT && m.team >= 1 && m.team <= nT;
      const team = nT ? `<span class="tg" style="${inTeam ? `color:${rgb(tc)}` : ''}">${inTeam ? TG.TEAM_NAMES[m.team].toLowerCase() : 'авто'}</span>` : '';
      d.innerHTML = `<span class="av" style="${av ? `background-image:url('${av}');` : `background:${rgb(m.color)};`}border-color:${rgb(m.color)}"></span><span class="nm">${esc(m.name)}${m.pid === me ? ' <span class="muted">(вы)</span>' : ''}</span>${m.pid === room.host ? '<span class="host">хост</span>' : ''}${team}<span class="tg">${m.off ? 'нет связи' : (m.ping ? m.ping + ' мс' : '—')}</span>`;
      pl.appendChild(d);
    }
    const tb = $('lobby-teams');
    tb.hidden = !nT;
    tb.innerHTML = '';
    if (nT) {
      const myM = room.members.find((m) => m.pid === me);
      const opts = [0]; for (let i = 1; i <= nT; i++) opts.push(i);
      for (const tm of opts) {
        const b = document.createElement('button');
        b.className = 'btn small' + (myM && (myM.team === tm || (tm === 0 && !(myM.team >= 1 && myM.team <= nT))) ? ' sel' : '');
        b.textContent = tm ? 'За ' + TG.TEAM_GEN[tm] : 'Авто';
        if (tm) b.style.color = rgb(TG.TEAM_COLORS[tm]);
        b.onclick = () => TG.Net.send({ t: 'team', team: tm });
        tb.appendChild(b);
      }
    }
    modeCards($('lobby-mode'), room.mode, (m) => TG.Net.send({ t: 'setup', mode: m, opts: UI.defaultOpts(m, false) }), !isHost);
    UI.buildOpts($('lobby-opts'), room.mode, room.opts, (o) => TG.Net.send({ t: 'setup', mode: room.mode, opts: o }), !isHost, false);
    $('lobby-mode-ro').textContent = isHost ? '' : 'Режим и настройки выбирает хост.';
    $('btn-start').hidden = !isHost;
    $('lobby-wait').hidden = isHost;
    $('btn-start').lastChild.textContent = room.state === 'lobby' ? 'Начать игру' : 'Игра идёт…';
    $('btn-start').disabled = room.state !== 'lobby';
  };

  UI.chatLine = function (m) {
    const line = document.createElement('div');
    if (m.sys) { line.className = 'sys'; line.textContent = m.text; }
    else line.innerHTML = `<b style="color:${rgb(m.color || [255, 255, 255])}">${esc(m.name)}</b> ${esc(m.text)}`;
    return line;
  };
  UI.addChat = function (m) {
    const log = $('lobby-chat');
    log.appendChild(UI.chatLine(m));
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
    const g = $('hud-chat');
    const l2 = UI.chatLine(m);
    g.appendChild(l2);
    while (g.children.length > 6) g.removeChild(g.firstChild);
    setTimeout(() => l2.classList.add('fade'), 8000);
    setTimeout(() => { if (l2.parentNode) l2.parentNode.removeChild(l2); }, 9200);
    if (!m.sys && TG.Game.session) TG.Audio.play('click');
  };

  // ---------- Настройки ----------
  const STICKS = { s: 55, m: 70, l: 88 };
  UI.renderSettings = function () {
    const S = UI.settings;
    $('set-name').value = S.name;
    const sw = $('set-colors');
    sw.innerHTML = '';
    for (const [name, c] of Object.entries(TG.PLAYER_COLORS)) {
      const b = document.createElement('button');
      b.style.background = rgb(c);
      b.title = TG.COLOR_RU[name];
      if (name === S.colorName) b.className = 'sel';
      b.onclick = () => { S.colorName = name; UI.applyProfile(); UI.renderSettings(); };
      sw.appendChild(b);
    }
    const sh = $('set-shapes');
    sh.innerHTML = '';
    for (const s of TG.SHAPES) {
      const b = document.createElement('button');
      b.className = 'btn small' + (s === S.shape ? ' sel' : '');
      b.textContent = TG.SHAPE_RU[s];
      b.onclick = () => { S.shape = s; UI.applyProfile(); UI.renderSettings(); };
      sh.appendChild(b);
    }
    const setRange = (id, v) => { $(id).value = v; $(id + '-v').textContent = v + '%'; };
    setRange('set-volume', S.volume); setRange('set-sfx', S.sfx); setRange('set-music', S.music);
    setRange('set-particles', S.particles); setRange('set-zoom', S.zoom);
    $('set-vibrate').checked = S.vibrate;
    $('set-quality').value = S.quality;
    $('set-fps').checked = S.showFps;
    $('set-shake').checked = S.shake;
    $('set-names').checked = S.names;
    $('set-dmg').checked = S.dmgNums;
    $('set-minimap').checked = S.minimap;
    $('set-ff').checked = S.ffBullets;
    $('set-autofire').checked = S.autoFire;
    $('set-lefty').checked = S.lefty;
    $('set-autofs').checked = S.autoFs;
    $('set-avatar-clear').hidden = !S.avatar;
    const stick = $('set-stick'); stick.innerHTML = '';
    for (const [k, nm] of [['s', 'Маленький'], ['m', 'Средний'], ['l', 'Большой']]) {
      const b = document.createElement('button'); b.className = 'btn' + (S.stick === k ? ' sel' : ''); b.textContent = nm;
      b.onclick = () => { S.stick = k; UI.saveSettings(); UI.applyGameSettings(); UI.renderSettings(); };
      stick.appendChild(b);
    }
    const as = $('set-assist'); as.innerHTML = '';
    for (const [k, nm] of [[0, 'Выкл'], [1, 'Слабая'], [2, 'Сильная']]) {
      const b = document.createElement('button'); b.className = 'btn' + (S.assist === k ? ' sel' : ''); b.textContent = nm;
      b.onclick = () => { S.assist = k; UI.saveSettings(); UI.applyGameSettings(); UI.renderSettings(); };
      as.appendChild(b);
    }
    drawPreview('set-preview', 28);
  };

  // Аватар: картинка обрезается по центру до квадрата 96×96 и сжимается
  UI.loadAvatar = function (file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Нужен файл картинки')); return; }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const tryEncode = (size, q) => {
          const c = document.createElement('canvas');
          c.width = c.height = size;
          const g = c.getContext('2d');
          const s = Math.min(img.naturalWidth, img.naturalHeight);
          g.imageSmoothingQuality = 'high';
          g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
          let d = c.toDataURL('image/webp', q);
          if (!/^data:image\/webp/.test(d)) d = c.toDataURL('image/jpeg', q);
          return d;
        };
        let data = tryEncode(96, 0.82);
        if (data.length > 22000) data = tryEncode(80, 0.7);
        if (data.length > 22000) data = tryEncode(64, 0.6);
        if (data.length > 23500) { reject(new Error('Картинка слишком сложная, попробуйте другую')); return; }
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть картинку')); };
      img.src = url;
    });
  };

  UI.applyProfile = function () {
    UI.saveSettings();
    const p = UI.profile();
    TG.Net.profile = p;
    if (TG.Net.connected) TG.Net.send({ t: 'profile', name: p.name, color: p.color, shape: p.shape, avatar: p.avatar });
    UI.renderMain();
  };

  UI.applyGameSettings = function () {
    const S = UI.settings;
    TG.Audio.setVolume(S.volume / 100, S.sfx / 100, S.music / 100);
    TG.Audio.vibrate = !!S.vibrate;
    const R = TG.Render.settings;
    const qChanged = R.quality !== S.quality;
    R.quality = S.quality; R.showFps = S.showFps; R.shake = S.shake; R.names = S.names;
    R.dmgNums = S.dmgNums; R.minimap = S.minimap; R.zoom = S.zoom / 100; R.particles = S.particles / 100; R.ffBullets = !!S.ffBullets;
    const I = TG.Input.cfg;
    I.stick = STICKS[S.stick] || 70; I.leftHanded = !!S.lefty; I.autoFire = !!S.autoFire; I.aimAssist = S.assist | 0;
    document.body.classList.toggle('lefty', !!S.lefty);
    if (qChanged) TG.Render.resize();
  };

  // ---------- Админ ----------
  UI.renderAdmin = function () {
    $('admin-login').hidden = !!UI.adminOk;
    $('admin-panel').hidden = !UI.adminOk;
    $('admin-err').hidden = true;
    $('admin-pass').value = '';
    const A = UI.admin;
    $('adm-speed').value = A.player_speed; $('adm-speed-v').textContent = A.player_speed;
    $('adm-bullet').value = A.bullet_speed; $('adm-bullet-v').textContent = (+A.bullet_speed).toFixed(1);
    $('adm-rate').value = A.fire_rate; $('adm-rate-v').textContent = A.fire_rate;
    $('adm-god').checked = !!A.god_mode;
    if (!UI.adminOk) setTimeout(() => $('admin-pass').focus(), 50);
  };

  // ---------- Помощь ----------
  UI.renderHelp = function () {
    const bl = $('help-boosts');
    bl.innerHTML = '';
    for (const k of TG.BOOSTS) {
      const info = TG.BOOST_INFO[k];
      const d = document.createElement('div');
      d.className = 'hi';
      const cv = document.createElement('canvas'); cv.width = cv.height = 40;
      TG.Render.drawBoostIcon(cv.getContext('2d'), k, 40);
      d.appendChild(cv);
      const sp = document.createElement('div'); sp.innerHTML = `<b>${esc(info.name)}</b><small>${esc(info.desc)}</small>`;
      d.appendChild(sp);
      bl.appendChild(d);
    }
    const hm = $('help-modes');
    hm.innerHTML = '';
    for (const id of TG.MODE_LIST) {
      const m = TG.MODE_INFO[id];
      const d = document.createElement('div'); d.className = 'hi';
      d.innerHTML = `${icon(MODE_ICONS[id])}<div><b>${esc(m.name)}</b><small>${esc(m.desc)}</small></div>`;
      hm.appendChild(d);
    }
    const he = $('help-enemies');
    he.innerHTML = '';
    const desc = { scout: 'быстрый и хрупкий', soldier: 'стандартный боец, прячется за укрытиями', sniper: 'стреляет издалека очень быстрыми пулями и рикошетом', heavy: '5 HP, большие пули', gunner: 'стреляет очередями', rusher: 'бьёт дробью вплотную', medic: 'лечит союзников', elite: 'уклоняется от пуль, стреляет рикошетом', boss: 'веер, кольцо пуль, подкрепление', god: 'финальный босс' };
    for (const k of TG.BOT_KINDS) {
      if (!k || k.turret) continue;
      const d = document.createElement('div'); d.className = 'hi';
      d.innerHTML = `<i style="background:${rgb(k.c)}"></i><div><b>${esc(k.name)}</b><small>${esc(desc[k.key] || '')}</small></div>`;
      he.appendChild(d);
    }
  };

  // ---------- Результаты ----------
  UI.boardTable = function (rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return '';
    const lvl = opts.mode === 'survival';
    let h = `<table class="sb"><tr><th>Игрок</th>${lvl ? '<th class="n">Ур.</th>' : ''}<th class="n">Убийства</th><th class="n">Смерти</th><th class="n">Очки</th>${opts.pings ? '<th class="n">Пинг</th>' : ''}</tr>`;
    for (const r of rows) {
      const ping = opts.pings && r.pid ? (opts.pings.get(r.pid) || '') : '';
      h += `<tr class="${r.id === opts.meId ? 'me' : ''}"><td><span class="sw" style="background:${rgb(r.c)}"></span>${esc(r.name)}${r.bot ? ' <span class="muted small">бот</span>' : ''}${r.off ? ' <span class="muted small">нет связи</span>' : ''}</td>${lvl ? `<td class="n">${r.lvl}</td>` : ''}<td class="n">${r.k}</td><td class="n">${r.d}</td><td class="n">${r.s}</td>${opts.pings ? `<td class="n">${ping ? ping + ' мс' : ''}</td>` : ''}</tr>`;
    }
    return h + '</table>';
  };

  UI.showResult = function (res, ctx) {
    const t = $('res-title');
    t.textContent = res.title || '';
    let col = ctx.win ? '#45d483' : ctx.draw ? '#ffc24b' : '#ff5d5d';
    if (res.winTeam) col = rgb(TG.TEAM_COLORS[res.winTeam]);
    t.style.color = col;
    let sub = res.sub || '';
    if (res.winTeam || res.winTank) sub += (sub ? ' · ' : '') + (ctx.win ? 'Вы победили' : 'Вы проиграли');
    $('res-sub').innerHTML = (res.stars ? `<span class="stars">${'★'.repeat(res.stars)}${'☆'.repeat(3 - res.stars)}</span><br>` : '') + esc(sub);
    $('res-board').innerHTML = UI.boardTable(res.board, { mode: ctx.mode, meId: ctx.meId });
    const canAct = ctx.local || ctx.isHost;
    $('res-next').hidden = !(canAct && res.next);
    $('res-again').hidden = !canAct;
    $('res-again').textContent = ctx.mode === 'levels' && ctx.win ? 'Пройти ещё раз' : 'Ещё раз';
    $('res-lobby').hidden = !(canAct && !ctx.local);
    $('res-wait').hidden = canAct;
    $('res-exit').textContent = ctx.local ? 'Выйти в меню' : 'Выйти из комнаты';
    $('ov-result').hidden = false;
    $('ov-pause').hidden = true;
    UI.showShop(false);
    TG.Audio.play(ctx.win ? 'win' : ctx.draw ? 'flag' : 'lose');
  };
  UI.hideResult = function () { $('ov-result').hidden = true; };

  // ---------- Внутриигровые элементы ----------
  let lastUp = '';
  UI.updateUpgrades = function (pers, onPick) {
    const el = $('hud-upgrades');
    const key = pers && pers.pend > 0 && pers.opts && pers.opts.length ? pers.pend + '|' + pers.opts.join(',') : '';
    if (key === lastUp) return;
    lastUp = key;
    if (!key) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = `<div class="title">Новый уровень — выберите улучшение${pers.pend > 1 ? ` (ещё ${pers.pend})` : ''}</div>`;
    pers.opts.forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.innerHTML = `<kbd>${i + 1}</kbd>${esc(name)}`;
      b.onclick = (e) => { e.stopPropagation(); onPick(i + 1); TG.Audio.play('click'); };
      b.onpointerdown = (e) => e.stopPropagation();
      el.appendChild(b);
    });
    el.hidden = false;
  };

  // Магазин Бедварса
  const SHOP_ICONS = { blocks: 'i-block', hblocks: 'i-block', bomb: 'i-bomb', walls: 'i-shield', armor: 'i-shield', dmg: 'i-target', rate: 'i-fire', speed: 'i-play', heal: 'i-star', shield: 'i-shield', turret: 'i-tank', forge: 'i-gear' };
  const CAT_COL = ['#8aa4ff', '#45d483', '#ffc24b'];
  UI.shopOpen = false;
  let lastShop = '';
  UI.showShop = function (v) {
    UI.shopOpen = !!v;
    $('shop').hidden = !v;
    UI.shopOpenedAt = performance.now();
    lastShop = '';
  };
  UI.renderShop = function (pers, onBuy) {
    if (!UI.shopOpen || !pers) return;
    const key = JSON.stringify([pers.coins, pers.blocks, pers.hblocks, pers.bombs, pers.bw, pers.forge]);
    if (key === lastShop) return;
    lastShop = key;
    $('shop-coins').textContent = pers.coins;
    const box = $('shop-items');
    box.innerHTML = '';
    const cols = TG.SHOP_CATS.map((name, ci) => {
      const col = document.createElement('div');
      col.className = 'shop-col';
      col.innerHTML = `<h4>${esc(name)}</h4>`;
      box.appendChild(col);
      return col;
    });
    TG.SHOP.forEach((it, i) => {
      const lvl = it.team ? (pers.forge || 0) : ((pers.bw && pers.bw[it.key]) || 0);
      const maxed = it.max && lvl >= it.max;
      let owned = '';
      if (it.key === 'blocks') owned = ` · есть ${pers.blocks}`;
      if (it.key === 'hblocks') owned = ` · есть ${pers.hblocks || 0}`;
      if (it.key === 'bomb') owned = ` · есть ${pers.bombs || 0}`;
      let pips = '';
      if (it.max) { pips = '<span class="pips">'; for (let k = 0; k < it.max; k++) pips += `<i class="${k < lvl ? 'on' : ''}"></i>`; pips += '</span>'; }
      const b = document.createElement('button');
      b.className = 'shop-item' + (maxed || pers.coins < it.price ? ' na' : '');
      b.innerHTML = `<span class="key">${TG.SHOP_KEYS[i] === '-' ? '−' : TG.SHOP_KEYS[i]}</span><span class="si" style="color:${CAT_COL[it.cat]}">${icon(SHOP_ICONS[it.key] || 'i-star')}</span><span class="nm"><b>${esc(it.name)}${pips}</b><small>${esc(it.desc)}${owned}</small></span><span class="pr">${maxed ? 'макс.' : icon('i-gem') + it.price}</span>`;
      b.onclick = (e) => { e.stopPropagation(); if (performance.now() - UI.shopOpenedAt < 450) return; onBuy(i); };
      b.onpointerdown = (e) => e.stopPropagation();
      cols[it.cat].appendChild(b);
    });
  };

  UI.resetInGame = function () {
    lastUp = '';
    $('hud-upgrades').hidden = true;
    $('scoreboard').hidden = true;
    $('hud-chat').innerHTML = '';
    $('game-chat-form').hidden = true;
    UI.showShop(false);
  };

  UI.renderScoreboard = function (rows, ctx) {
    const el = $('scoreboard');
    el.innerHTML = `<h3>Таблица счёта</h3>` + (UI.boardTable(rows, ctx) || '<div class="muted">Нет данных</div>');
  };

  UI.setConn = function (show, text) {
    $('ov-conn').hidden = !show;
    if (text) $('conn-text').textContent = text;
  };

  UI.$ = $;
})(self.TG);
