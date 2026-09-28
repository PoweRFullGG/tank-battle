/* Интерфейс: меню, лобби, настройки, результаты, чат, таблица счёта, магазин. */
(function (TG) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const UI = TG.UI = {};
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  UI.esc = esc;

  // ---------- Хранилище ----------
  function load(key, def) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? def : Object.assign(Array.isArray(def) ? [] : {}, def, v); } catch (e) { return def; }
  }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* игнор */ } }

  const randomName = () => 'Танкист' + Math.floor(100 + Math.random() * 900);
  const isTouchDev = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  UI.settings = load('tbo_settings', {});
  UI.settings = Object.assign({
    name: randomName(), colorName: 'Green', shape: 'Circle', volume: 70, sfx: 80, music: 40, vibrate: true,
    quality: isTouchDev ? 'medium' : 'high', particles: 100, zoom: 100, shake: true, dmgNums: true, names: true, minimap: true, showFps: false,
    stick: 'm', assist: 1, autoFire: true, lefty: false, autoFs: true
  }, UI.settings);
  if (!TG.PLAYER_COLORS[UI.settings.colorName]) UI.settings.colorName = 'Green';
  if (!TG.SHAPES.includes(UI.settings.shape)) UI.settings.shape = 'Circle';
  UI.admin = load('tbo_admin', { player_speed: 3, bullet_speed: 1.0, fire_rate: 470, god_mode: false });
  UI.progress = load('tbo_progress3', { stars: {}, bestWave: 0, bestLevel: 0, cdiff: 2 });
  UI.saveSettings = () => save('tbo_settings', UI.settings);
  UI.saveProgress = () => save('tbo_progress3', UI.progress);
  UI.profile = () => ({ name: UI.settings.name, color: TG.PLAYER_COLORS[UI.settings.colorName], shape: UI.settings.shape });

  // ---------- Экраны ----------
  const SCREENS = ['main', 'solo', 'multi', 'lobby', 'settings', 'help', 'admin'];
  UI.current = 'main';
  UI.show = function (name) {
    if (name === 'settings' && UI.current !== 'settings' && UI.returnTo !== 'pause') UI.returnTo = UI.current;
    UI.current = name;
    for (const s of SCREENS) $('scr-' + s).hidden = s !== name;
    if (name === 'main') drawPreview('main-preview');
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
    UI._toast = setTimeout(() => { t.hidden = true; }, ms || 2800);
  };

  function drawPreview(id) {
    const cv = $(id);
    if (!cv) return;
    TG.Render.drawTankIcon(cv.getContext('2d'), UI.settings.shape, TG.PLAYER_COLORS[UI.settings.colorName], 26);
  }
  UI.drawPreview = drawPreview;

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
    const obj = L.obj === 'survive' ? `Продержитесь <b>${L.time} с</b>` : 'Уничтожьте всех врагов';
    const st = UI.progress.stars[lv] || 0;
    d.innerHTML = `<b>${lv}. ${esc(L.n)}</b> ${st ? '<span style="color:#ffd23f">' + '★'.repeat(st) + '☆'.repeat(3 - st) + '</span>' : ''}<br>${obj}<br>${enemies}${L.tip ? '<br><span class="muted">💡 ' + esc(L.tip) + '</span>' : ''}`;
    return d;
  }

  // Построение панели опций режима
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
        b.innerHTML = (boss ? '☠' : L.obj === 'survive' ? '⏱' : '') + i + (st ? `<span class="st">${'★'.repeat(st)}</span>` : '');
        b.title = L.n;
        b.disabled = !!ro && i !== opts.level;
        if (!ro) b.onclick = () => { TG.Audio.play('click'); set('level', i); };
        grid.appendChild(b);
      }
      el.appendChild(grid);
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
      el.appendChild(seg(opts.teams ? 'Убийств до победы (x2 для команды)' : 'Убийств до победы', [5, 10, 20, 30], opts.kills, null, (v) => set('kills', v), ro));
    } else if (mode === 'bedwars') {
      el.appendChild(seg('Команд', [2, 4], opts.teams, null, (v) => set('teams', v), ro));
      el.appendChild(seg('Танков в команде', [1, 2, 3, 4], opts.size, null, (v) => set('size', v), ro));
      el.appendChild(seg('Сложность ботов', [1, 2, 3, 4], opts.diff, (v) => DIFF_NAMES[v - 1], (v) => set('diff', v), ro));
      el.appendChild(seg('Время матча', [10, 15, 20], opts.time, (v) => v + ' мин', (v) => set('time', v), ro));
      const t = document.createElement('div'); t.className = 'muted small';
      t.innerHTML = 'Пока ядро команды цело — вы возрождаетесь. Собирайте <b>кристаллы</b> у своего генератора и <b>алмазы</b> в центре, покупайте улучшения (B), ставьте блоки (E). Уничтожьте вражеские ядра!';
      el.appendChild(t);
    } else if (mode === 'royale') {
      el.appendChild(seg('Всего танков (с ботами)', [6, 10, 16, 24], opts.total, null, (v) => set('total', v), ro));
      el.appendChild(seg('Сложность ботов', [1, 2, 3, 4], opts.diff, (v) => DIFF_NAMES[v - 1], (v) => set('diff', v), ro));
      el.appendChild(seg('Скорость зоны', [false, true], !!opts.fast, (v) => v ? 'Быстрая' : 'Обычная', (v) => set('fast', v), ro));
      const t = document.createElement('div'); t.className = 'muted small';
      t.textContent = 'У всех 5 HP, возрождений нет. Вне зоны теряете здоровье. Собирайте усиления и выживите последним!';
      el.appendChild(t);
    } else if (mode === 'waves') {
      const t = document.createElement('div'); t.className = 'muted small';
      t.textContent = `Рекорд: ${UI.progress.bestWave} волн. Каждая 5-я волна — с боссом. С друзьями врагов больше, погибшие возвращаются в следующей волне.`;
      el.appendChild(t);
    } else if (mode === 'survival') {
      const t = document.createElement('div'); t.className = 'muted small';
      t.textContent = `Рекорд: уровень ${UI.progress.bestLevel}. За уровни выбирайте улучшения (клавиши 1-3). Каждые 3 минуты — босс.`;
      el.appendChild(t);
    }
  };

  function modeCards(el, cur, onPick, ro) {
    el.innerHTML = '';
    for (const id of TG.MODE_LIST) {
      const m = TG.MODE_INFO[id];
      const b = document.createElement('div');
      b.className = 'mode-card' + (id === cur ? ' sel' : '');
      b.innerHTML = `<span class="ic">${m.icon}</span><b>${esc(m.name)}</b><span>${esc(m.desc)}</span>`;
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
      st.innerHTML = 'Игра открыта как файл. Для игры с друзьями запустите сервер<br>(<b>start.bat</b>) и откройте <b>http://localhost:3000</b>';
      $('btn-create').disabled = $('btn-join').disabled = true;
    } else {
      $('btn-create').disabled = $('btn-join').disabled = false;
      st.className = 'status ' + (TG.Net.connected ? 'ok' : '');
      st.textContent = TG.Net.connected ? '● Подключено к серверу' : 'Подключение к серверу…';
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
    const link = location.origin + location.pathname + '#' + room.code;
    $('lobby-link').textContent = link;
    $('lobby-count').textContent = `(${room.members.filter((m) => !m.off).length}/${TG.C.MAX_PLAYERS})`;
    const nT = teamCount(room);
    const pl = $('lobby-players');
    pl.innerHTML = '';
    for (const m of room.members) {
      const d = document.createElement('div');
      d.className = 'pl' + (m.off ? ' off' : '');
      const tc = TG.TEAM_COLORS[m.team];
      const team = nT ? `<span class="tg" style="${m.team && m.team <= nT ? `background:${rgb(tc)}33;color:${rgb(tc)}` : ''}">${m.team && m.team <= nT ? TG.TEAM_NAMES[m.team].toLowerCase() : 'авто'}</span>` : '';
      d.innerHTML = `<span class="sw" style="background:${rgb(m.color)}"></span><span class="nm">${m.pid === room.host ? '👑 ' : ''}${esc(m.name)}${m.pid === me ? ' (вы)' : ''}</span>${team}<span class="tg">${m.off ? 'нет связи' : (m.ping ? m.ping + ' мс' : '')}</span>`;
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
        if (tm) b.style.borderColor = rgb(TG.TEAM_COLORS[tm]);
        b.onclick = () => TG.Net.send({ t: 'team', team: tm });
        tb.appendChild(b);
      }
    }
    modeCards($('lobby-mode'), room.mode, (m) => TG.Net.send({ t: 'setup', mode: m, opts: UI.defaultOpts(m, false) }), !isHost);
    UI.buildOpts($('lobby-opts'), room.mode, room.opts, (o) => TG.Net.send({ t: 'setup', mode: room.mode, opts: o }), !isHost, false);
    $('lobby-mode-ro').textContent = isHost ? '' : 'Режим и настройки выбирает хост 👑';
    $('btn-start').hidden = !isHost;
    $('lobby-wait').hidden = isHost;
    $('btn-start').textContent = room.state === 'lobby' ? '▶ Начать игру' : '⏳ Игра идёт…';
    $('btn-start').disabled = room.state !== 'lobby';
  };

  UI.chatLine = function (m) {
    const line = document.createElement('div');
    if (m.sys) { line.className = 'sys'; line.textContent = m.text; }
    else line.innerHTML = `<b style="color:${rgb(m.color || [255, 255, 255])}">${esc(m.name)}:</b> ${esc(m.text)}`;
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
      b.style.background = rgb(c); b.style.color = rgb(c);
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
    const setRange = (id, v, fmt) => { $(id).value = v; $(id + '-v').textContent = fmt ? fmt(v) : v + '%'; };
    setRange('set-volume', S.volume); setRange('set-sfx', S.sfx); setRange('set-music', S.music);
    setRange('set-particles', S.particles); setRange('set-zoom', S.zoom);
    $('set-vibrate').checked = S.vibrate;
    $('set-quality').value = S.quality;
    $('set-fps').checked = S.showFps;
    $('set-shake').checked = S.shake;
    $('set-names').checked = S.names;
    $('set-dmg').checked = S.dmgNums;
    $('set-minimap').checked = S.minimap;
    $('set-autofire').checked = S.autoFire;
    $('set-lefty').checked = S.lefty;
    $('set-autofs').checked = S.autoFs;
    const stick = $('set-stick'); stick.innerHTML = '';
    for (const [k, nm] of [['s', 'Маленький'], ['m', 'Средний'], ['l', 'Большой']]) {
      const b = document.createElement('button'); b.className = 'btn small' + (S.stick === k ? ' sel' : ''); b.textContent = nm;
      b.onclick = () => { S.stick = k; UI.saveSettings(); UI.applyGameSettings(); UI.renderSettings(); };
      stick.appendChild(b);
    }
    const as = $('set-assist'); as.innerHTML = '';
    for (const [k, nm] of [[0, 'Выкл'], [1, 'Слабая'], [2, 'Сильная']]) {
      const b = document.createElement('button'); b.className = 'btn small' + (S.assist === k ? ' sel' : ''); b.textContent = nm;
      b.onclick = () => { S.assist = k; UI.saveSettings(); UI.applyGameSettings(); UI.renderSettings(); };
      as.appendChild(b);
    }
    drawPreview('set-preview');
  };

  UI.applyProfile = function () {
    UI.saveSettings();
    const p = UI.profile();
    TG.Net.profile = p;
    if (TG.Net.connected) TG.Net.send({ t: 'profile', name: p.name, color: p.color, shape: p.shape });
    drawPreview('main-preview');
  };

  UI.applyGameSettings = function () {
    const S = UI.settings;
    TG.Audio.setVolume(S.volume / 100, S.sfx / 100, S.music / 100);
    TG.Audio.vibrate = !!S.vibrate;
    const R = TG.Render.settings;
    const qChanged = R.quality !== S.quality;
    R.quality = S.quality; R.showFps = S.showFps; R.shake = S.shake; R.names = S.names;
    R.dmgNums = S.dmgNums; R.minimap = S.minimap; R.zoom = S.zoom / 100; R.particles = S.particles / 100;
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
      const cv = document.createElement('canvas'); cv.width = cv.height = 22; cv.style.verticalAlign = '-5px'; cv.style.marginRight = '8px';
      TG.Render.drawBoostIcon(cv.getContext('2d'), k, 22);
      d.appendChild(cv);
      const sp = document.createElement('span'); sp.innerHTML = `<b>${esc(info.name)}</b> — ${esc(info.desc)}`;
      d.appendChild(sp);
      bl.appendChild(d);
    }
    const hm = $('help-modes');
    hm.innerHTML = '';
    for (const id of TG.MODE_LIST) {
      const m = TG.MODE_INFO[id];
      const p = document.createElement('p');
      p.innerHTML = `${m.icon} <b>${esc(m.name)}</b> — ${esc(m.desc)}`;
      hm.appendChild(p);
    }
    const he = $('help-enemies');
    he.innerHTML = '';
    const desc = { scout: 'быстрый, хрупкий', soldier: 'стандартный боец, прячется за укрытиями', sniper: 'стреляет издалека очень быстрыми пулями и рикошетом', heavy: '5 HP, большие пули', gunner: 'стреляет очередями', rusher: 'бьёт дробью вплотную', medic: 'лечит союзников', elite: 'уклоняется от пуль, стреляет рикошетом', boss: 'кольцо пуль, веер, подкрепление', god: 'финальный босс' };
    for (const k of TG.BOT_KINDS) {
      if (!k || k.turret) continue;
      const d = document.createElement('div');
      d.innerHTML = `<i style="background:${rgb(k.c)}"></i><b>${esc(k.name)}</b> — ${esc(desc[k.key] || '')}`;
      he.appendChild(d);
    }
  };

  // ---------- Результаты ----------
  UI.boardTable = function (rows, opts) {
    opts = opts || {};
    if (!rows || !rows.length) return '';
    const lvl = opts.mode === 'survival';
    let h = `<table class="sb"><tr><th>Игрок</th>${lvl ? '<th class="n">Ур.</th>' : ''}<th class="n">Убийств</th><th class="n">Смертей</th><th class="n">Очки</th>${opts.pings ? '<th class="n">Пинг</th>' : ''}</tr>`;
    for (const r of rows) {
      const ping = opts.pings && r.pid ? (opts.pings.get(r.pid) || '') : '';
      h += `<tr class="${r.id === opts.meId ? 'me' : ''}"><td><span class="sw" style="background:${rgb(r.c)}"></span>${esc(r.name)}${r.bot ? ' <span class="muted small">бот</span>' : ''}${r.off ? ' <span class="muted small">(нет связи)</span>' : ''}</td>${lvl ? `<td class="n">${r.lvl}</td>` : ''}<td class="n">${r.k}</td><td class="n">${r.d}</td><td class="n">${r.s}</td>${opts.pings ? `<td class="n">${ping ? ping + ' мс' : ''}</td>` : ''}</tr>`;
    }
    return h + '</table>';
  };

  UI.showResult = function (res, ctx) {
    const t = $('res-title');
    t.textContent = res.title || '';
    let col = ctx.win ? '#00ff7a' : ctx.draw ? '#ffd23f' : '#ff4b5c';
    if (res.winTeam) col = rgb(TG.TEAM_COLORS[res.winTeam]);
    t.style.color = col;
    t.style.textShadow = `0 0 26px ${col}, 3px 3px 0 #000`;
    let sub = res.sub || '';
    if (res.winTeam || res.winTank) sub += (sub ? ' · ' : '') + (ctx.win ? 'Вы победили!' : 'Вы проиграли');
    if (res.stars) sub = '★'.repeat(res.stars) + '☆'.repeat(3 - res.stars) + '  ' + sub;
    $('res-sub').textContent = sub;
    $('res-board').innerHTML = UI.boardTable(res.board, { mode: ctx.mode, meId: ctx.meId });
    const canAct = ctx.local || ctx.isHost;
    $('res-next').hidden = !(canAct && res.next);
    $('res-again').hidden = !canAct;
    $('res-again').textContent = ctx.mode === 'levels' && ctx.win ? '↻ Пройти ещё раз' : '↻ Ещё раз';
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
    el.innerHTML = `<div class="title">⭐ Улучшение! (осталось: ${pers.pend})</div>`;
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
    const key = JSON.stringify([pers.coins, pers.blocks, pers.bw]);
    if (key === lastShop) return;
    lastShop = key;
    $('shop-coins').textContent = '💎 ' + pers.coins;
    const box = $('shop-items');
    box.innerHTML = '';
    TG.SHOP.forEach((it, i) => {
      const lvl = (pers.bw && pers.bw[it.key]) || 0;
      const maxed = it.max && lvl >= it.max;
      const b = document.createElement('button');
      b.className = 'shop-item' + (maxed || pers.coins < it.price ? ' na' : '');
      b.innerHTML = `<kbd>${i + 1}</kbd><span class="nm">${esc(it.name)}${it.max ? ` <span class="muted">(${lvl}/${it.max})</span>` : ''}<small>${esc(it.desc)}</small></span><span class="pr">${maxed ? 'MAX' : '💎 ' + it.price}</span>`;
      b.onclick = (e) => { e.stopPropagation(); if (performance.now() - UI.shopOpenedAt < 450) return; onBuy(i); };
      b.onpointerdown = (e) => e.stopPropagation();
      box.appendChild(b);
    });
    $('shop-hint').hidden = TG.Input.isTouch;
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
