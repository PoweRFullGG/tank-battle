/* Tank Battle Online — игровые данные: усиления, типы ботов, кампания, магазин, улучшения. */
(function (TG) {
  'use strict';

  // ---------- Усиления (подбираемые бонусы) ----------
  // dur — длительность в тиках (60 = 1 с); w — вес выпадения
  TG.BOOSTS = ['speed', 'shield', 'health', 'rapid', 'big', 'triple', 'homing', 'damage', 'emp', 'invis'];
  TG.BOOST_INFO = {
    speed:  { c: [255, 200, 0],   name: 'Ускорение',        desc: 'скорость x1.7 на 6 с',                       dur: 360, w: 1.0 },
    shield: { c: [255, 255, 120], name: 'Щит',              desc: 'неуязвимость 4 с',                            dur: 240, w: 0.9 },
    health: { c: [255, 60, 110],  name: 'Ремонт',           desc: '+1 HP (или запасная жизнь при полном HP)',    dur: 0,   w: 1.3 },
    rapid:  { c: [255, 100, 255], name: 'Пулемёт',          desc: 'очень быстрая стрельба 5 с',                  dur: 300, w: 1.0 },
    big:    { c: [60, 130, 255],  name: 'Большие пули',     desc: 'пули x2 размера — сбивают обычные, 6 с',      dur: 360, w: 0.8 },
    triple: { c: [0, 230, 200],   name: 'Тройной выстрел',  desc: 'три пули веером 6 с',                         dur: 360, w: 1.0 },
    homing: { c: [255, 140, 40],  name: 'Самонаведение',    desc: 'пули доворачивают на врага 6 с',              dur: 360, w: 0.8 },
    damage: { c: [255, 40, 40],   name: 'Двойной урон',     desc: 'каждая пуля снимает 2 HP, 6 с',               dur: 360, w: 0.8 },
    emp:    { c: [120, 200, 255], name: 'ЭМИ-взрыв',        desc: 'оглушает врагов рядом на 1.5 с и сбивает их пули', dur: 0, w: 0.6 },
    invis:  { c: [190, 190, 215], name: 'Невидимость',      desc: 'боты не видят вас 5 с, враги — почти не видят', dur: 300, w: 0.6 }
  };
  // Предметы-ресурсы (режим «Бедварс»): тип 20+
  TG.ITEMS = {
    crystal: { c: [90, 220, 255],  name: 'Кристалл', v: 1, id: 20 },
    gem:     { c: [210, 110, 255], name: 'Алмаз',    v: 6, id: 21 }
  };
  TG.itemById = (id) => (id === 20 ? 'crystal' : id === 21 ? 'gem' : null);

  // ---------- Типы ботов ----------
  // sk — навыки ИИ: react (тики реакции), aimErr (разброс, рад), lead (доля упреждения), turn (рад/тик),
  // dodge (0..1 уклонение), rico (стрельба рикошетом), cover (укрытия), flank (обход), view (дальность обзора)
  const KINDS = [null,
    { key: 'scout',   name: 'Разведчик',  shape: 'Triangle', c: [255, 150, 40],  speed: 3.5, hp: 1,  r: 17, rate: 70, bs: 5.4, range: [180, 340], cost: 2,
      sk: { react: 30, aimErr: 0.14, lead: 0.4, turn: 0.12, dodge: 0.25, rico: 0, cover: 0, flank: 1, view: 750 } },
    { key: 'soldier', name: 'Солдат',     shape: 'Square',   c: [255, 70, 70],   speed: 2.8, hp: 2,  r: 20, rate: 62, bs: 5.4, range: [220, 400], cost: 3,
      sk: { react: 24, aimErr: 0.10, lead: 0.6, turn: 0.09, dodge: 0.30, rico: 0, cover: 1, flank: 1, view: 850 } },
    { key: 'sniper',  name: 'Снайпер',    shape: 'Diamond',  c: [200, 90, 255],  speed: 2.4, hp: 2,  r: 19, rate: 120, bs: 9,  range: [430, 720], cost: 4, longBarrel: 1,
      sk: { react: 24, aimErr: 0.04, lead: 0.85, turn: 0.06, dodge: 0.25, rico: 1, cover: 1, flank: 0, view: 1300 } },
    { key: 'heavy',   name: 'Тяжёлый',    shape: 'Hexagon',  c: [190, 40, 50],   speed: 2.0, hp: 5,  r: 26, rate: 90, bs: 4.8, range: [160, 340], cost: 5, bsize: 1.7,
      sk: { react: 28, aimErr: 0.12, lead: 0.6, turn: 0.05, dodge: 0.08, rico: 0, cover: 0, flank: 0, view: 800 } },
    { key: 'gunner',  name: 'Пулемётчик', shape: 'Pentagon', c: [255, 80, 200],  speed: 2.6, hp: 3,  r: 21, rate: 7,  bs: 5.6, range: [220, 380], cost: 4, burst: { n: 5, rest: 130 },
      sk: { react: 24, aimErr: 0.16, lead: 0.6, turn: 0.08, dodge: 0.25, rico: 0, cover: 1, flank: 1, view: 850 } },
    { key: 'rusher',  name: 'Штурмовик',  shape: 'Star',     c: [255, 220, 60],  speed: 3.15, hp: 2, r: 19, rate: 78, bs: 5.2, range: [0, 150],   cost: 3, spread: { n: 3, a: 0.3 },
      sk: { react: 24, aimErr: 0.14, lead: 0.4, turn: 0.11, dodge: 0.3, rico: 0, cover: 0, flank: 1, view: 750 } },
    { key: 'medic',   name: 'Медик',      shape: 'Circle',   c: [120, 255, 160], speed: 2.8, hp: 2,  r: 19, rate: 80, bs: 5.4, range: [330, 520], cost: 4, heal: { every: 200, rad: 230 },
      sk: { react: 26, aimErr: 0.12, lead: 0.5, turn: 0.09, dodge: 0.40, rico: 0, cover: 1, flank: 0, view: 850 } },
    { key: 'elite',   name: 'Элита',      shape: 'Triangle', c: [255, 40, 130],  speed: 3.2, hp: 3,  r: 20, rate: 56, bs: 6.0, range: [230, 430], cost: 7, elite: 1,
      sk: { react: 18, aimErr: 0.07, lead: 0.8, turn: 0.13, dodge: 0.45, rico: 1, cover: 1, flank: 1, view: 1100 } },
    { key: 'boss',    name: 'Крепость',   shape: 'Hexagon',  c: [255, 110, 30],  speed: 2.0, hp: 14, r: 34, rate: 110, bs: 4.6, range: [260, 500], cost: 20, bsize: 1.5, boss: 1,
      spread: { n: 3, a: 0.3 }, ring: { every: 420, n: 10 }, summon: { at: 0.5, kind: 1, n: 2 },
      sk: { react: 18, aimErr: 0.16, lead: 0.5, turn: 0.05, dodge: 0, rico: 1, cover: 0, flank: 0, view: 1400 } },
    { key: 'god',     name: 'Бог войны',  shape: 'Star',     c: [255, 235, 140], speed: 3.2, hp: 14, r: 28, rate: 44, bs: 6.4,   range: [240, 400], cost: 40, boss: 1, god: 1,
      ring: { every: 360, n: 10 },
      sk: { react: 12, aimErr: 0.055, lead: 0.85, turn: 0.2, dodge: 0.5, rico: 1, cover: 0, flank: 1, view: 2000 } },
    { key: 'turret',  name: 'Турель',     shape: 'Square',   c: [200, 200, 200], speed: 0,   hp: 6,  r: 22, rate: 40, bs: 6.5, range: [0, 600],   cost: 0, turret: 1,
      sk: { react: 12, aimErr: 0.04, lead: 0.9, turn: 0.12, dodge: 0, rico: 0, cover: 0, flank: 0, view: 620 } }
  ];
  TG.BOT_KINDS = KINDS;
  TG.KIND = {};
  KINDS.forEach((k, i) => { if (k) { k.id = i; TG.KIND[k.key] = i; } });

  // Профили сложности для ботов в командных режимах (Захват флага, Арена, Бедварс, Королевская битва)
  TG.DIFF = {
    1: { name: 'Легко',   rate: 60, sk: { react: 40, aimErr: 0.14, lead: 0.4, turn: 0.06, dodge: 0.10, rico: 0, cover: 0, flank: 0, view: 700 } },
    2: { name: 'Средне',  rate: 45, sk: { react: 24, aimErr: 0.08, lead: 0.7, turn: 0.10, dodge: 0.35, rico: 0, cover: 1, flank: 1, view: 900 } },
    3: { name: 'Сложно',  rate: 36, sk: { react: 14, aimErr: 0.045, lead: 0.9, turn: 0.16, dodge: 0.65, rico: 1, cover: 1, flank: 1, view: 1100 } },
    4: { name: 'Эксперт', rate: 30, sk: { react: 7, aimErr: 0.02, lead: 1, turn: 0.25, dodge: 0.9, rico: 1, cover: 1, flank: 1, view: 1300 } }
  };

  // ---------- Кампания: 30 уровней ----------
  // m — стиль карты; e — враги [[тип, кол-во]]; obj — цель (kill — уничтожить всех, survive — продержаться time секунд)
  // keep/pool — для survive: сколько врагов одновременно и из каких типов
  TG.CAMPAIGN = [
    { n: 'Первый контакт',     m: 'normal', e: [['soldier', 2]], tip: 'WASD — движение, мышь — прицел, ЛКМ — огонь. Пули отскакивают от стен!' },
    { n: 'Быстрые цели',       m: 'open',   e: [['scout', 4]], tip: 'Разведчики быстрые, но хрупкие — хватит одного попадания' },
    { n: 'Отряд',              m: 'normal', e: [['soldier', 2], ['scout', 2]], tip: 'Подбирайте бонусы — они сильно помогают' },
    { n: 'Снайпер',            m: 'maze',   e: [['sniper', 1], ['soldier', 2]], tip: 'Снайпер бьёт далеко и быстро — прячьтесь за стенами' },
    { n: 'Держать позицию',    m: 'normal', obj: 'survive', time: 30, keep: 3, pool: ['scout', 'soldier'], tip: 'Продержитесь 30 секунд — враги будут прибывать' },
    { n: 'Бронетехника',       m: 'normal', e: [['heavy', 1], ['scout', 2]], tip: 'Тяжёлый танк прочный (6 HP) и стреляет большими пулями' },
    { n: 'Штурм',              m: 'open',   e: [['rusher', 2], ['scout', 1]], tip: 'Штурмовики бьют дробью вплотную — держите дистанцию' },
    { n: 'Шквал огня',         m: 'normal', e: [['gunner', 1], ['soldier', 2]], tip: 'Пулемётчик стреляет очередями — атакуйте, пока он перезаряжается' },
    { n: 'Полевой госпиталь',  m: 'normal', e: [['medic', 1], ['soldier', 3]], tip: 'Медик лечит союзников — уничтожьте его первым' },
    { n: 'БОСС: Крепость',     m: 'fort',   e: [['boss', 1]], bossHp: 0.8, tip: 'Босс выпускает кольцо пуль и вызывает подкрепление' },
    { n: 'Перекрёстный огонь', m: 'maze',   e: [['sniper', 2], ['heavy', 1]] },
    { n: 'Лавина',             m: 'open',   e: [['rusher', 2], ['gunner', 1], ['scout', 1]] },
    { n: 'Элита',              m: 'normal', e: [['elite', 1], ['soldier', 2]], tip: 'Элита уклоняется от пуль и стреляет рикошетом из-за укрытий' },
    { n: 'Осада',              m: 'normal', obj: 'survive', time: 30, keep: 3, pool: ['soldier', 'scout', 'rusher'] },
    { n: 'Тяжёлая пехота',     m: 'normal', e: [['heavy', 1], ['soldier', 1], ['medic', 1], ['sniper', 1]] },
    { n: 'Лабиринт',           m: 'maze',   e: [['soldier', 3], ['sniper', 2]] },
    { n: 'Ураган',             m: 'normal', e: [['elite', 1], ['gunner', 2]] },
    { n: 'Рой',                m: 'open',   e: [['rusher', 3], ['scout', 3]] },
    { n: 'Спецназ',            m: 'normal', e: [['elite', 1], ['soldier', 2], ['medic', 1]] },
    { n: 'БОСС: Двойной удар', m: 'fort',   e: [['boss', 1], ['gunner', 1]], bossHp: 0.85 },
    { n: 'Тени',               m: 'maze',   e: [['elite', 2], ['sniper', 1]] },
    { n: 'Последний рубеж',    m: 'normal', obj: 'survive', time: 45, keep: 3, pool: ['sniper', 'rusher', 'gunner', 'soldier'] },
    { n: 'Броня и сталь',      m: 'normal', e: [['heavy', 2], ['gunner', 1], ['medic', 1]] },
    { n: 'Засада',             m: 'maze',   e: [['sniper', 3], ['rusher', 3]] },
    { n: 'Звено',              m: 'normal', e: [['elite', 2], ['soldier', 2]] },
    { n: 'Армия',              m: 'arena',  e: [['elite', 1], ['heavy', 1], ['medic', 1], ['sniper', 1], ['gunner', 1]] },
    { n: 'Ад',                 m: 'normal', obj: 'survive', time: 40, keep: 3, pool: ['elite', 'heavy', 'rusher', 'sniper'] },
    { n: 'Легион',             m: 'arena',  e: [['elite', 2], ['soldier', 2], ['medic', 1]] },
    { n: 'Два колосса',        m: 'fort',   e: [['boss', 2]], bossHp: 0.55 },
    { n: 'БОГ ВОЙНЫ',          m: 'arena',  e: [['god', 1], ['soldier', 2]], tip: 'Финал. Бог войны видит каждую пулю. Удачи!' }
  ];

  // Сложность кампании: hp — бонус HP игрока, aim — множитель разброса ботов, rate — множитель перезарядки ботов
  TG.CAMPAIGN_DIFF = {
    1: { name: 'Лёгкая',     hp: 2,  aim: 1.7, rate: 1.3, dodge: -0.2 },
    2: { name: 'Нормальная', hp: 0,  aim: 1,   rate: 1,   dodge: 0 },
    3: { name: 'Сложная',    hp: -1, aim: 0.7, rate: 0.85, dodge: 0.15 }
  };

  // ---------- Магазин режима «Бедварс» ----------
  TG.SHOP = [
    { key: 'blocks', name: 'Блоки ×4',          price: 6,  desc: 'стены для защиты (клавиша E — поставить)' },
    { key: 'armor',  name: '+1 Броня',          price: 16, max: 3, desc: '+1 максимальное HP' },
    { key: 'dmg',    name: '+1 Урон',           price: 30, max: 2, desc: 'пули снимают больше HP' },
    { key: 'rate',   name: 'Скорострельность',  price: 20, max: 3, desc: 'перезарядка −15%' },
    { key: 'speed',  name: 'Двигатель',         price: 14, max: 2, desc: 'скорость +12%' },
    { key: 'repair', name: 'Ремонт ядра +15',   price: 20, desc: 'восстанавливает ядро команды' },
    { key: 'turret', name: 'Турель',            price: 40, desc: 'ставит пушку рядом (до 2 на команду)' },
    { key: 'shield', name: 'Щит 6 с',           price: 10, desc: 'временная неуязвимость' }
  ];

  // ---------- Улучшения режима «Выживание (RPG)» ----------
  TG.UPGRADES = {
    speed:  { name: '+Скорость танка',     ok: (t) => t.baseSpeed < 6.2,     apply: (t) => { t.baseSpeed = +(t.baseSpeed + 0.35).toFixed(2); } },
    bspeed: { name: '+Скорость пуль',      ok: (t) => t.bulletSpeedMod < 2.6, apply: (t) => { t.bulletSpeedMod = +(t.bulletSpeedMod + 0.2).toFixed(2); } },
    bsize:  { name: '+Размер пуль',        ok: (t) => t.sizeMult < 2.2,      apply: (t) => { t.sizeMult = +(t.sizeMult + 0.2).toFixed(2); } },
    hp:     { name: '+1 Макс. HP',         ok: (t) => t.maxHp < 10,          apply: (t) => { t.maxHp++; t.hp = Math.min(t.maxHp, t.hp + 1); } },
    reload: { name: 'Быстрая перезарядка', ok: (t) => t.reloadMult > 0.4,    apply: (t) => { t.reloadMult = +(t.reloadMult * 0.87).toFixed(3); } },
    regen:  { name: 'Регенерация',         ok: (t) => (t.regen || 0) < 3,    apply: (t) => { t.regen = (t.regen || 0) + 1; } },
    multi:  { name: '+1 Боковой ствол',    ok: (t) => (t.multi || 0) < 2,    apply: (t) => { t.multi = (t.multi || 0) + 1; } },
    dmg:    { name: '+1 Урон пуль',        ok: (t) => (t.dmgBonus || 0) < 2, apply: (t) => { t.dmgBonus = (t.dmgBonus || 0) + 1; } }
  };
})(typeof globalThis !== 'undefined' ? (globalThis.TG = globalThis.TG || {}) : (self.TG = self.TG || {}));
