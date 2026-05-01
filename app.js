// ============================================================
//  ТАБУ — главная логика
// ============================================================

const CFG = window.APP_CONFIG;
const TG = window.Telegram?.WebApp;

// Какие фичи Telegram реально поддерживает (по версии)
const TG_OK = !!TG && typeof TG.isVersionAtLeast === "function";
const TG_CLOUD   = TG_OK && TG.isVersionAtLeast("6.9");
const TG_HAPTIC  = TG_OK && TG.isVersionAtLeast("6.1");
const TG_BACKBTN = TG_OK && TG.isVersionAtLeast("6.1");

// Telegram Mini App инициализация (если запущено в Telegram)
if (TG) {
  try { TG.ready(); } catch {}
  try { TG.expand(); } catch {}
  document.body.classList.add("tg-app");
}

const haptic = (type = "light") => {
  try {
    if (TG_HAPTIC && TG.HapticFeedback) {
      if (type === "success") TG.HapticFeedback.notificationOccurred("success");
      else if (type === "error") TG.HapticFeedback.notificationOccurred("error");
      else if (type === "warning") TG.HapticFeedback.notificationOccurred("warning");
      else TG.HapticFeedback.impactOccurred(type);
      return;
    }
  } catch {}
  if (navigator.vibrate) navigator.vibrate(type === "heavy" ? 30 : 10);
};

// ============================================================
//  STATE
// ============================================================

const STORE_KEY = "tabu.v1.state";
const SETTINGS_KEY = "tabu.v1.settings";
const CARDS_KEY = "tabu.v1.cards";

const TOY_LABELS = {
  vibrator: "вибратор",
  dildo: "дилдо",
  handcuffs: "наручники",
  blindfold: "повязка на глаза",
  feather: "перо",
  mask: "маска",
  ice: "лёд",
  oil: "масло",
};

const CAT_LABELS = {
  task_soft: "Задание",
  task_mid: "Задание",
  task_hard: "Задание",
  task_anal: "Задание",
  task_toys: "Задание",
  task_roleplay: "Ролевая",
  truth: "Правда",
  for_him: "Для него",
  for_her: "Для неё",
  swap: "Смена ролей",
  bold: "Вызов",
  task_bold: "Вызов",
};

// клетки на поле (категория + уровень) — повторяющиеся типы
const BOARD_CELLS = [
  // 30 клеток от старта до финиша
  "start",
  "task_soft", "task_soft", "truth", "task_soft",
  "task_mid", "for_him", "task_mid", "swap", "task_mid",
  "truth", "task_hard", "task_toys", "task_mid", "for_her",
  "truth", "task_hard", "swap", "task_roleplay", "task_hard",
  "for_him", "bold", "truth", "task_hard", "task_anal",
  "for_her", "task_hard", "truth", "bold",
  "finish",
];

const DEFAULT_SETTINGS = {
  nameHim: "Он",
  nameHer: "Она",
  intensity: CFG.DEFAULT_INTENSITY ?? 2,
  toys: [],         // массив id игрушек, которые есть
  taboo: [],        // массив запрещённых тегов
};

let cards = [];        // полный пул
let settings = { ...DEFAULT_SETTINGS };
let game = null;       // активная игра

// ============================================================
//  STORAGE — LocalStorage + Telegram CloudStorage
// ============================================================

// Защитная обёртка: если Telegram CloudStorage не вызывает callback (баг в десктоп-клиенте) —
// падаем по таймауту через 2 сек, чтобы не зависнуть на await.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("storage timeout")), ms)),
  ]);
}

async function storageGet(key) {
  if (TG_CLOUD && TG.CloudStorage) {
    try {
      return await withTimeout(new Promise((resolve, reject) => {
        TG.CloudStorage.getItem(key, (err, value) => err ? reject(err) : resolve(value));
      }), 2000);
    } catch (e) { /* fallback to localStorage */ }
  }
  try { return localStorage.getItem(key); } catch { return null; }
}

async function storageSet(key, value) {
  if (TG_CLOUD && TG.CloudStorage) {
    try {
      await withTimeout(new Promise((resolve, reject) => {
        TG.CloudStorage.setItem(key, value, (err) => err ? reject(err) : resolve());
      }), 2000);
    } catch {}
  }
  try { localStorage.setItem(key, value); } catch {}
  return true;
}

async function storageDel(key) {
  if (TG_CLOUD && TG.CloudStorage) {
    try {
      await withTimeout(new Promise((r) => TG.CloudStorage.removeItem(key, () => r())), 2000);
    } catch {}
  }
  try { localStorage.removeItem(key); } catch {}
}

async function loadSettings() {
  const raw = await storageGet(SETTINGS_KEY);
  if (raw) {
    try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch {}
  }
}
async function saveSettings() { await storageSet(SETTINGS_KEY, JSON.stringify(settings)); }

async function loadGame() {
  const raw = await storageGet(STORE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
async function saveGame() {
  if (game) await storageSet(STORE_KEY, JSON.stringify(game));
}
async function clearGame() {
  game = null;
  await storageDel(STORE_KEY);
}

// ============================================================
//  CARDS
// ============================================================

async function loadCards() {
  // 1) сначала пробуем дополнительный пул из storage (сгенерированные через "ещё карточек")
  const extraRaw = await storageGet(CARDS_KEY);
  let extra = [];
  if (extraRaw) {
    try { extra = JSON.parse(extraRaw); } catch {}
  }

  // 2) загружаем базовый пул из data/cards.json (cache-bust по версии)
  try {
    const res = await fetch("data/cards.json?v=9", { cache: "no-cache" });
    const base = await res.json();
    cards = [...base, ...extra];
  } catch (e) {
    console.error("Не удалось загрузить cards.json", e);
    cards = extra;
  }
  console.log(`Загружено карточек: ${cards.length}`);
}

// нормализация — фикс косячных категорий из генерации
function normalizeCategory(cat) {
  if (cat === "task_bold") return "bold";
  return cat;
}

function pickCard(category) {
  const target = normalizeCategory(category);
  const allowedToys = new Set(settings.toys || []);
  const tabooSet = new Set(settings.taboo || []);
  const intensity = game?.intensity ?? settings.intensity;

  const filtered = cards.filter((c) => {
    const cat = normalizeCategory(c.category);
    if (cat !== target) {
      // task_* категории взаимозаменяемы для общих "task" клеток
      if (target.startsWith("task_") && cat.startsWith("task_")) {
        // ok
      } else {
        return false;
      }
    }
    if (c.required_toy && !allowedToys.has(c.required_toy)) return false;
    const tags = c.tags || [];
    if (tags.some((t) => tabooSet.has(t))) return false;
    if (c.level > intensity) return false;
    if (game?.usedIds?.includes(c.id)) return false;
    return true;
  });

  const pickInOrder = (pool) => {
    if (!game?.shuffledCardIds) return pool[Math.floor(Math.random() * pool.length)];
    const byId = new Map(pool.map((c) => [c.id, c]));
    for (const id of game.shuffledCardIds) {
      if (byId.has(id)) return byId.get(id);
    }
    return pool[Math.floor(Math.random() * pool.length)];
  };

  if (filtered.length === 0) {
    // fallback — разрешаем повтор уже выпавших, но СОХРАНЯЕМ остальные фильтры
    const fallback = cards.filter((c) => {
      const cat = normalizeCategory(c.category);
      const sameTarget = cat === target ||
        (target.startsWith("task_") && cat.startsWith("task_"));
      if (!sameTarget) return false;
      if (c.required_toy && !allowedToys.has(c.required_toy)) return false;
      if ((c.tags || []).some((t) => tabooSet.has(t))) return false;
      if (c.level > intensity) return false;
      return true;
    });
    if (fallback.length === 0) return null;
    return pickInOrder(fallback);
  }
  return pickInOrder(filtered);
}

// ============================================================
//  СКРИНЫ
// ============================================================

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.dataset.screen === name);
  });

  // BackButton телеги (только в новых версиях)
  if (TG_BACKBTN && TG.BackButton) {
    try {
      if (name === "menu") TG.BackButton.hide();
      else TG.BackButton.show();
    } catch {}
  }
}

// ============================================================
//  МЕНЮ
// ============================================================

// Event delegation — один listener на body, ловит все [data-action]
document.body.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  e.preventDefault();
  onAction({ currentTarget: el }).catch((err) => {
    console.error("[onAction]", el.dataset.action, err);
    alert("Ошибка: " + (err?.message || err));
  });
});

async function onAction(e) {
  const action = e.currentTarget.dataset.action;
  console.log("[action]", action);
  haptic("light");

  switch (action) {
    case "new-game": {
      // если уже есть сохранённая игра — спросить
      const saved = await loadGame();
      if (saved) {
        showModal({
          title: "Уже есть игра",
          text: "Продолжить ту, что не закончили, или начать новую?",
          actions: [
            { label: "Начать новую", primary: true, onClick: async () => { await clearGame(); hideModal(); openSetup(); } },
            { label: "Продолжить", onClick: async () => { game = saved; hideModal(); enterGame(); } },
          ],
        });
      } else {
        openSetup();
      }
      return;
    }
    case "continue": {
      const saved = await loadGame();
      if (saved) { game = saved; enterGame(); }
      return;
    }
    case "settings": openSetup(); return;
    case "rules": showScreen("rules"); return;
    case "back-to-menu": showScreen("menu"); return;
    case "start-game": startGame(); return;
    case "pause": showPauseMenu(); return;
    case "stop-word": showStopWord(); return;
    case "roll-dice": rollDice(); return;
    case "card-done": cardResult("done"); return;
    case "card-skip": cardResult("skip"); return;
    case "wish-own": {
      document.getElementById("wish-input").value = "";
      document.getElementById("wish-regen-btn").hidden = true;
      document.getElementById("wish-input-title").textContent = "Твоё желание";
      document.getElementById("wish-input-sub").textContent = "Партнёр увидит его на следующем экране";
      document.getElementById("wish-choice-stage").hidden = true;
      document.getElementById("wish-input-stage").hidden = false;
      document.getElementById("wish-reveal-stage").hidden = true;
      setTimeout(() => document.getElementById("wish-input").focus(), 300);
      return;
    }
    case "wish-ai": {
      document.getElementById("wish-input").value = "";
      document.getElementById("wish-regen-btn").hidden = false;
      document.getElementById("wish-input-title").textContent = "Подсказка от Claude";
      document.getElementById("wish-input-sub").textContent = "Можешь изменить или использовать как есть";
      document.getElementById("wish-choice-stage").hidden = true;
      document.getElementById("wish-input-stage").hidden = false;
      document.getElementById("wish-reveal-stage").hidden = true;
      wishSuggest();
      return;
    }
    case "wish-back-to-choice": {
      document.getElementById("wish-choice-stage").hidden = false;
      document.getElementById("wish-input-stage").hidden = true;
      document.getElementById("wish-reveal-stage").hidden = true;
      return;
    }
    case "wish-suggest": wishSuggest(); return;
    case "wish-reveal": wishReveal(); return;
    case "wish-edit": wishEdit(); return;
    case "wish-done": wishDone(); return;
  }
}

// ============================================================
//  SETUP — экран настройки
// ============================================================

function openSetup() {
  // заполнить из текущих настроек
  document.getElementById("name-him").value = settings.nameHim === "Он" ? "" : settings.nameHim;
  document.getElementById("name-her").value = settings.nameHer === "Она" ? "" : settings.nameHer;

  document.querySelectorAll("#intensity-seg button").forEach((b) => {
    b.classList.toggle("active", Number(b.dataset.val) === settings.intensity);
  });
  updateIntensityHint();

  document.querySelectorAll("#toy-grid .chip").forEach((b) => {
    b.classList.toggle("active", settings.toys.includes(b.dataset.toy));
  });
  document.querySelectorAll("#taboo-grid .chip").forEach((b) => {
    b.classList.toggle("active", settings.taboo.includes(b.dataset.taboo));
  });

  showScreen("setup");
}

function updateIntensityHint() {
  const hint = document.getElementById("intensity-hint");
  const map = {
    1: "Флирт, поцелуи, прикосновения, разговоры.",
    2: "Прелюдия, оральные ласки, петтинг, лёгкое доминирование.",
    3: "Без табу. Жёсткие позы, фистинг, доминирование.",
  };
  hint.textContent = map[settings.intensity];
}

document.querySelectorAll("#intensity-seg button").forEach((b) => {
  b.addEventListener("click", () => {
    settings.intensity = Number(b.dataset.val);
    document.querySelectorAll("#intensity-seg button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    updateIntensityHint();
    haptic("light");
  });
});

document.querySelectorAll("#toy-grid .chip").forEach((b) => {
  b.addEventListener("click", () => {
    const t = b.dataset.toy;
    if (settings.toys.includes(t)) settings.toys = settings.toys.filter((x) => x !== t);
    else settings.toys = [...settings.toys, t];
    b.classList.toggle("active");
    haptic("light");
  });
});
document.querySelectorAll("#taboo-grid .chip").forEach((b) => {
  b.addEventListener("click", () => {
    const t = b.dataset.taboo;
    if (settings.taboo.includes(t)) settings.taboo = settings.taboo.filter((x) => x !== t);
    else settings.taboo = [...settings.taboo, t];
    b.classList.toggle("active");
    haptic("light");
  });
});

async function startGame() {
  settings.nameHim = document.getElementById("name-him").value.trim() || "Он";
  settings.nameHer = document.getElementById("name-her").value.trim() || "Она";
  await saveSettings();

  game = {
    posHim: 0,
    posHer: 0,
    turn: "him",
    cells: BOARD_CELLS.slice(),
    usedIds: [],
    shuffledCardIds: shuffle(cards.map((c) => c.id)),
    history: [],
    finished: null,
    pendingCard: null,
    intensity: settings.intensity,   // текущий уровень (может расти по ходу игры)
    turnsTotal: 0,                   // всего ходов сделано
    turnsSinceLevelCheck: 0,         // ходов с момента последнего вопроса о повышении
  };
  await saveGame();
  enterGame();
}

// ============================================================
//  GAME
// ============================================================

function enterGame() {
  showScreen("game");
  drawBoard();
  updateUI();
  // если есть незавершённая карточка — показать
  if (game.pendingCard) {
    setTimeout(() => showCard(game.pendingCard), 400);
  }
}

function updateUI() {
  document.querySelector(".player-him .pname").textContent = settings.nameHim;
  document.querySelector(".player-her .pname").textContent = settings.nameHer;
  document.getElementById("steps-him").textContent = game.posHim;
  document.getElementById("steps-her").textContent = game.posHer;

  document.querySelector(".player-him").classList.toggle("active", game.turn === "him");
  document.querySelector(".player-her").classList.toggle("active", game.turn === "her");

  document.getElementById("turn-name").textContent =
    game.turn === "him" ? settings.nameHim : settings.nameHer;

  // бейдж текущего уровня
  const badge = document.getElementById("level-badge");
  if (badge) {
    const intensity = game.intensity ?? settings.intensity;
    const labels = { 1: "мягко", 2: "средне", 3: "жёстко" };
    badge.textContent = labels[intensity];
    badge.dataset.level = intensity;
  }
}

// частота проверки уровня — каждые N ходов
const LEVEL_CHECK_EVERY = 4;

function maybeAskLevelUp() {
  if (!game) return;
  if (game.intensity >= 3) return;                  // уже максимум
  if (game.turnsSinceLevelCheck < LEVEL_CHECK_EVERY) return;

  game.turnsSinceLevelCheck = 0;
  saveGame();

  const next = game.intensity + 1;
  const nextLabel = next === 2 ? "СРЕДНИЙ — прелюдия, оральные ласки, петтинг"
                                : "ЖЁСТКИЙ — без табу, позы, доминирование";

  showModal({
    title: "Поднять градус?",
    text: `Перейти на уровень ${nextLabel}? Если ещё не готовы — играем дальше как есть, спрошу через ${LEVEL_CHECK_EVERY} хода.`,
    actions: [
      { label: "Да, поднимаем", primary: true, onClick: () => {
        game.intensity = next;
        saveGame();
        updateUI();
        const badge = document.getElementById("level-badge");
        if (badge) {
          badge.classList.remove("level-up-flash");
          void badge.offsetWidth;
          badge.classList.add("level-up-flash");
        }
        haptic("success");
        hideModal();
      } },
      { label: "Пока нет", onClick: () => { haptic("light"); hideModal(); } },
    ],
  });
}

// ============================================================
//  ИГРОВОЕ ПОЛЕ — canvas
// ============================================================

const boardCanvas = () => document.getElementById("board");
const cellColors = {
  task_soft: "#9c2a3a",
  task_mid:  "#b81c2a",
  task_hard: "#7a0d18",
  task_anal: "#7a0d18",
  task_toys: "#b87333",
  task_roleplay: "#6a3580",
  truth:     "#1f5d8c",
  for_him:   "#2270c9",
  for_her:   "#c13d7a",
  swap:      "#c9a961",
  bold:      "#3a0a12",
  start:     "#0a0506",
  finish:    "#c9a961",
};

function drawBoard() {
  const canvas = boardCanvas();
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const cells = BOARD_CELLS;
  const positions = computeBoardPath(rect.width, rect.height, cells.length);

  // фон поля
  ctx.fillStyle = "rgba(0,0,0,0.0)";
  ctx.fillRect(0, 0, rect.width, rect.height);

  // дорожка — линия между клетками
  ctx.strokeStyle = "rgba(201,169,97,0.18)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  positions.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.setLineDash([]);

  // клетки
  positions.forEach((p, i) => {
    const cell = cells[i];
    const color = cellColors[cell] || "#444";
    drawCell(ctx, p.x, p.y, cell, color, i, cells.length);
  });

  // фишки
  drawToken(ctx, positions[game.posHim], "#4DA6FF", -10);
  drawToken(ctx, positions[game.posHer], "#FF6FB3", 10);
}

function computeBoardPath(w, h, n) {
  // змейка: 5 рядов по 6 клеток (для 30)
  const cols = 6;
  const rows = Math.ceil(n / cols);
  const padX = 30, padY = 30;
  const innerW = w - padX * 2;
  const innerH = h - padY * 2;
  const dx = innerW / (cols - 1);
  const dy = innerH / (rows - 1);
  const positions = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    let col = i % cols;
    if (row % 2 === 1) col = cols - 1 - col;
    positions.push({
      x: padX + col * dx,
      y: padY + row * dy,
    });
  }
  return positions;
}

function drawCell(ctx, x, y, type, color, i, total) {
  const size = 22;
  ctx.save();
  ctx.translate(x, y);

  // тень
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;

  ctx.fillStyle = color;
  if (type === "start" || type === "finish") {
    // золотой круг с буквой
    ctx.beginPath();
    ctx.arc(0, 0, size + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#0A0506";
    ctx.font = "bold 11px 'Bebas Neue', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(type === "start" ? "СТАРТ" : "ФИНИШ", 0, 0);
  } else {
    // ромб (повёрнутый квадрат)
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.rotate(-Math.PI / 4);

    // иконка по типу
    ctx.fillStyle = "rgba(245,232,213,0.95)";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const labels = {
      task_soft: "💋", task_mid: "💋", task_hard: "💋",
      task_anal: "🔥", task_toys: "🎁", task_roleplay: "🎭",
      truth: "👁", for_him: "♂", for_her: "♀",
      swap: "↻", bold: "😈",
    };
    ctx.font = "13px system-ui";
    ctx.fillText(labels[type] || "•", 0, 0);
  }
  ctx.restore();
}

function drawToken(ctx, pos, color, offsetX) {
  if (!pos) return;
  ctx.save();
  ctx.translate(pos.x + offsetX, pos.y - 18);
  // свечение
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 14);
  grad.addColorStop(0, color);
  grad.addColorStop(0.6, color + "88");
  grad.addColorStop(1, "transparent");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.fill();
  // ядро
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 6, 0, Math.PI * 2);
  ctx.fill();
  // обводка
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

window.addEventListener("resize", () => {
  if (game) drawBoard();
});

// ============================================================
//  3D КУБИК (Three.js)
// ============================================================

let rolling = false;
let diceSpins3D = 0;
let _diceMesh = null, _diceRenderer = null;

const TILT3D = { x: -0.26, y: -0.31 };
const FACE_EULER = {
  1: [0, 0],
  2: [0, -Math.PI / 2],
  3: [-Math.PI / 2, 0],
  4: [Math.PI / 2, 0],
  5: [0, Math.PI / 2],
  6: [0, Math.PI],
};

function makeDotTexture(value) {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d");

  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, "#3a0a12");
  bg.addColorStop(1, "#1a0308");
  const r = 28;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.arcTo(S, 0, S, S, r);
  ctx.arcTo(S, S, 0, S, r);
  ctx.arcTo(0, S, 0, 0, r);
  ctx.arcTo(0, 0, S, 0, r);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(201,169,97,0.5)";
  ctx.lineWidth = 4;
  ctx.stroke();

  const M = 68, C = 128;
  const dots = {
    1: [[C, C]],
    2: [[M, M], [S - M, S - M]],
    3: [[M, M], [C, C], [S - M, S - M]],
    4: [[M, M], [S - M, M], [M, S - M], [S - M, S - M]],
    5: [[M, M], [S - M, M], [C, C], [M, S - M], [S - M, S - M]],
    6: [[M, M], [S - M, M], [M, C], [S - M, C], [M, S - M], [S - M, S - M]],
  };

  for (const [x, y] of dots[value]) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    const g = ctx.createRadialGradient(x - 3, y - 3, 0, x, y, 18);
    g.addColorStop(0, "#F5E8D5");
    g.addColorStop(0.4, "#C9A961");
    g.addColorStop(1, "#8B6914");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return new THREE.CanvasTexture(c);
}

function setupDice3D() {
  if (!window.THREE) return;
  const canvas = document.getElementById("dice-canvas");
  if (!canvas) return;

  _diceRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  _diceRenderer.setSize(144, 144);
  _diceRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _diceRenderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.z = 4.8;

  scene.add(new THREE.AmbientLight(0xfff5e8, 1.4));
  const key = new THREE.DirectionalLight(0xc9a961, 3.5);
  key.position.set(2, 3, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8b1a1a, 0.8);
  rim.position.set(-3, -1, -2);
  scene.add(rim);

  const geo = new THREE.BoxGeometry(1.8, 1.8, 1.8);
  // BoxGeometry material index: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z, 5=-Z
  const faceValues = [2, 5, 3, 4, 1, 6];
  const mats = faceValues.map((v) => new THREE.MeshStandardMaterial({
    map: makeDotTexture(v),
    roughness: 0.22,
    metalness: 0.06,
  }));

  _diceMesh = new THREE.Mesh(geo, mats);
  _diceMesh.rotation.x = TILT3D.x;
  _diceMesh.rotation.y = TILT3D.y;
  scene.add(_diceMesh);

  (function loop() {
    requestAnimationFrame(loop);
    _diceRenderer.render(scene, camera);
  })();
}

async function rollDice() {
  if (rolling) return;
  if (game.finished) return;
  rolling = true;

  const value = 1 + Math.floor(Math.random() * 6);
  haptic("medium");

  if (_diceMesh) {
    diceSpins3D += 2;
    const [bx, by] = FACE_EULER[value];
    const targetX = TILT3D.x + bx + Math.PI * 2 * diceSpins3D;
    const targetY = TILT3D.y + by + Math.PI * 2 * diceSpins3D;
    const startX = _diceMesh.rotation.x;
    const startY = _diceMesh.rotation.y;

    await new Promise((resolve) => {
      const duration = 1400;
      const t0 = performance.now();
      function frame(now) {
        const t = Math.min((now - t0) / duration, 1);
        const e = 1 - Math.pow(1 - t, 3);
        _diceMesh.rotation.x = startX + (targetX - startX) * e;
        _diceMesh.rotation.y = startY + (targetY - startY) * e;
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  } else {
    await wait(500);
  }

  rolling = false;
  await movePlayer(value);
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
//  ХОД
// ============================================================

async function movePlayer(steps) {
  const key = game.turn === "him" ? "posHim" : "posHer";
  const max = BOARD_CELLS.length - 1;
  for (let i = 0; i < steps; i++) {
    if (game[key] >= max) break;
    game[key]++;
    drawBoard();
    haptic("light");
    await wait(180);
  }

  // дошёл до финиша?
  if (game[key] >= max) {
    game.finished = game.turn;
    await saveGame();
    showWin();
    return;
  }

  const cell = BOARD_CELLS[game[key]];

  // бонусные клетки → передача хода без карточки
  if (cell === "start") {
    nextTurn();
    return;
  }

  // вытянуть карточку
  drawCardFor(cell);
}

function drawCardFor(cellType) {
  const card = pickCard(cellType);
  if (!card) {
    nextTurn();
    return;
  }
  game.pendingCard = card;
  game.usedIds = [...(game.usedIds || []), card.id];
  saveGame();
  showCard(card);
}

// ============================================================
//  CARD UI
// ============================================================

let timerHandle = null;
function showCard(card) {
  const overlay = document.getElementById("card-overlay");
  const cardEl = document.getElementById("card");
  cardEl.classList.remove("flipped");
  overlay.hidden = false;

  document.getElementById("card-cat").textContent = (CAT_LABELS[normalizeCategory(card.category)] || "Карточка").toUpperCase();
  document.getElementById("card-text").textContent = card.text;

  const toyEl = document.getElementById("card-toy");
  if (card.required_toy && TOY_LABELS[card.required_toy]) {
    toyEl.textContent = "нужно: " + TOY_LABELS[card.required_toy];
    toyEl.hidden = false;
  } else {
    toyEl.hidden = true;
  }

  // таймер
  const timerEl = document.getElementById("card-timer");
  const timerText = document.getElementById("card-timer-text");
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  if (card.timer && Number(card.timer) > 0) {
    timerEl.hidden = false;
    let left = card.timer;
    const fmt = (s) => {
      const m = Math.floor(s / 60), x = s % 60;
      return `${String(m).padStart(2,"0")}:${String(x).padStart(2,"0")}`;
    };
    timerText.textContent = fmt(left);
    const circle = timerEl.querySelector("circle");
    const total = card.timer;
    timerHandle = setInterval(() => {
      left--;
      timerText.textContent = fmt(Math.max(0, left));
      const pct = Math.max(0, left / total);
      circle.style.strokeDashoffset = `${276.46 * (1 - pct)}`;
      if (left <= 0) {
        clearInterval(timerHandle);
        haptic("success");
      }
    }, 1000);
  } else {
    timerEl.hidden = true;
  }

  // переворот через секунду
  setTimeout(() => cardEl.classList.add("flipped"), 80);
}

function hideCard() {
  document.getElementById("card-overlay").hidden = true;
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

function cardResult(result) {
  haptic(result === "done" ? "success" : "warning");
  game.history.push({
    cardId: game.pendingCard.id,
    player: game.turn,
    result,
    at: Date.now(),
  });
  game.pendingCard = null;

  hideCard();

  // штраф за пропуск: партнёру даём +1 шаг
  if (result === "skip") {
    const otherKey = game.turn === "him" ? "posHer" : "posHim";
    const max = BOARD_CELLS.length - 1;
    if (game[otherKey] < max) game[otherKey]++;
    drawBoard();
  }

  saveGame();
  setTimeout(nextTurn, 400);
}

function nextTurn() {
  game.turn = game.turn === "him" ? "her" : "him";
  game.turnsTotal = (game.turnsTotal || 0) + 1;
  game.turnsSinceLevelCheck = (game.turnsSinceLevelCheck || 0) + 1;
  saveGame();
  updateUI();
  // спрашиваем про повышение уровня
  setTimeout(() => maybeAskLevelUp(), 600);
}

// ============================================================
//  WIN
// ============================================================

function showWin() {
  const isHe = game.finished === "him";
  const winner = isHe ? settings.nameHim : settings.nameHer;
  document.getElementById("wish-winner-name").textContent = winner;
  document.getElementById("wish-winner-suffix").textContent = isHe ? "" : "а"; // "победил" / "победила"
  document.getElementById("wish-label-suffix").textContent = isHe ? "я" : "ьницы"; // "победителя" / "победительницы"
  document.getElementById("wish-from-name").textContent = winner;

  // показываем экран выбора типа желания
  document.getElementById("wish-choice-stage").hidden = false;
  document.getElementById("wish-input-stage").hidden = true;
  document.getElementById("wish-reveal-stage").hidden = true;
  document.getElementById("wish-overlay").hidden = false;

  spawnConfetti();
  haptic("success");
}

function spawnConfetti() {
  const box = document.getElementById("confetti");
  box.innerHTML = "";
  const colors = ["#C9A961", "#E5C97D", "#B81C2A", "#FF6B6B", "#F5E8D5"];
  for (let i = 0; i < 60; i++) {
    const s = document.createElement("span");
    s.style.left = `${Math.random() * 100}%`;
    s.style.background = colors[i % colors.length];
    s.style.width = `${4 + Math.random() * 6}px`;
    s.style.height = `${10 + Math.random() * 10}px`;
    s.style.animationDuration = `${3 + Math.random() * 3}s`;
    s.style.animationDelay = `${Math.random() * 2}s`;
    s.style.setProperty("--dx", `${(Math.random() - 0.5) * 200}px`);
    box.appendChild(s);
  }
}

async function wishSuggest() {
  const winner = game.finished === "him" ? settings.nameHim : settings.nameHer;
  const winnerIsHer = game.finished === "her";
  if (!CFG.ANTHROPIC_API_KEY || CFG.ANTHROPIC_API_KEY.startsWith("ВСТАВЬ")) {
    // оффлайн-фолбек
    const offline = winnerIsHer
      ? "Сделай мне массаж всего тела с маслом. И никаких отвлечений на телефон."
      : "Покажи мне стриптиз под мою любимую песню. Я просто смотрю.";
    document.getElementById("wish-input").value = offline;
    return;
  }

  const input = document.getElementById("wish-input");
  input.disabled = true;
  input.placeholder = "Claude думает…";

  try {
    const intensity = game.intensity ?? settings.intensity;
    const sys = `Ты помогаешь победителю эротической игры «ТАБУ» придумать одно конкретное желание для партнёра.
Игроки: гетеро-пара. Уровень откровенности: ${intensity}/3.
Победитель: ${winner} (${winnerIsHer ? "женщина" : "мужчина"}).
Запреты: БДСМ с реальной болью, групповуха, бывшие, костюмы, унижение.
Доступные у пары игрушки: ${(settings.toys || []).map(t => TOY_LABELS[t]).join(", ") || "нет"}.

ФОРМАТ — ТОЛЬКО одно желание (1-3 предложения), безупречный русский, конкретное, уважительное к партнёру.
БЕЗ преамбул типа «Вот ваше желание», БЕЗ кавычек, БЕЗ нумерации. Просто текст желания.`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": CFG.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: CFG.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: sys,
        messages: [{ role: "user", content: "Придумай одно желание для партнёра." }],
      }),
    });
    const data = await res.json();
    const text = (data.content?.[0]?.text || "").trim().replace(/^["«»']+|["«»']+$/g, "");
    input.value = text;
    haptic("light");
  } catch (e) {
    console.error(e);
  } finally {
    input.disabled = false;
    input.placeholder = "Напиши своё желание словами. Партнёр увидит его на следующем экране.";
  }
}

function wishReveal() {
  const text = document.getElementById("wish-input").value.trim();
  if (!text) {
    document.getElementById("wish-input").focus();
    return;
  }
  document.getElementById("wish-card-text").textContent = text;
  document.getElementById("wish-input-stage").hidden = true;
  document.getElementById("wish-reveal-stage").hidden = false;
  haptic("medium");
}

function wishEdit() {
  document.getElementById("wish-input-stage").hidden = false;
  document.getElementById("wish-reveal-stage").hidden = true;
  haptic("light");
}

async function wishDone() {
  document.getElementById("wish-overlay").hidden = true;
  document.getElementById("confetti").innerHTML = "";
  haptic("success");
  await clearGame();
  showModal({
    title: "Конец игры",
    text: "Желание принято. До следующего раза.",
    actions: [
      { label: "Новая игра", primary: true, onClick: async () => { hideModal(); openSetup(); } },
      { label: "В меню", onClick: () => { hideModal(); showScreen("menu"); checkContinue(); } },
    ],
  });
}

// ============================================================
//  PAUSE / STOP
// ============================================================

function showPauseMenu() {
  showModal({
    title: "Пауза",
    text: `Карточек в пуле: ${cards.length}. Игра сохранена.`,
    actions: [
      { label: "Продолжить", primary: true, onClick: hideModal },
      { label: "Сгенерировать ещё карточек", onClick: () => { hideModal(); generateMoreCards(); } },
      { label: "В меню", onClick: () => { hideModal(); showScreen("menu"); checkContinue(); } },
      { label: "Закончить игру", onClick: async () => { await clearGame(); hideModal(); showScreen("menu"); checkContinue(); } },
    ],
  });
}

// ============================================================
//  ГЕНЕРАЦИЯ ДОПОЛНИТЕЛЬНЫХ КАРТОЧЕК ЧЕРЕЗ CLAUDE API
// ============================================================

async function generateMoreCards() {
  if (!CFG.ANTHROPIC_API_KEY || CFG.ANTHROPIC_API_KEY.startsWith("ВСТАВЬ")) {
    showModal({
      title: "Нет API-ключа",
      text: "Для генерации новых карточек нужен ключ Anthropic в config.js",
      actions: [{ label: "Понял", primary: true, onClick: hideModal }],
    });
    return;
  }

  showModal({
    title: "Генерируем…",
    text: "Claude пишет 50 свежих карточек под ваши настройки. Займёт ~15 секунд.",
    actions: [],
  });

  try {
    const newCards = await fetchMoreCards(50);
    if (!newCards || newCards.length === 0) throw new Error("Пусто");

    cards = [...cards, ...newCards];
    // сохраняем в storage отдельно от базового пула
    const extraRaw = await storageGet(CARDS_KEY);
    let extra = [];
    try { extra = extraRaw ? JSON.parse(extraRaw) : []; } catch {}
    await storageSet(CARDS_KEY, JSON.stringify([...extra, ...newCards]));

    showModal({
      title: "Готово",
      text: `Добавлено ${newCards.length} карточек. Всего в пуле: ${cards.length}.`,
      actions: [{ label: "Продолжить", primary: true, onClick: hideModal }],
    });
    haptic("success");
  } catch (e) {
    console.error(e);
    showModal({
      title: "Не получилось",
      text: "Ошибка: " + (e?.message || e),
      actions: [{ label: "Закрыть", primary: true, onClick: hideModal }],
    });
    haptic("error");
  }
}

async function fetchMoreCards(count = 50) {
  const userTaboo = settings.taboo.join(", ") || "—";
  const userToys = settings.toys.map((t) => TOY_LABELS[t]).join(", ") || "никаких";

  const SYSTEM_RUS = `Ты — автор контента для эротической онлайн-игры «ТАБУ» 18+ для гетеро-пары.
Тон: дерзкий, игривый, сексуальный, конкретный, без пошлятины и колхоза. На «ты». Коротко (1-2 предложения), часто с таймером.
Запреты: БДСМ с реальной болью, групповуха, бывшие, бэйби-токинг, костюмы для ролёвок, унижения, насилие.
Учёт настроек игроков:
- Запрещённые теги (НЕ генерируй): ${userTaboo}
- Доступные игрушки: ${userToys}
- Уровень откровенности: ${settings.intensity} (1=мягко, 2=средне, 3=жёстко)

Формат: чистый JSON-массив, без \`\`\`. Каждая карточка:
{"id":"gen_NNNNNN","category":"task_soft|task_mid|task_hard|task_anal|task_toys|task_roleplay|truth|for_him|for_her|swap|bold","level":0-3,"text":"...","timer":число_или_null,"tags":[],"required_toy":null_или_строка}

Делай разнообразный микс категорий. Для toys — указывай required_toy ТОЛЬКО из доступных у пары (или null).`;

  const user = `Сгенерируй ${count} новых карточек разных категорий. Уникальные ID начинай с "gen_${Date.now()}_". Верни одним JSON-массивом.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": CFG.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: CFG.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 5000,
      system: SYSTEM_RUS,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  return JSON.parse(cleaned);
}

function showStopWord() {
  showModal({
    title: "✋ Стоп",
    text: "Закончить игру? Уважение к слову партнёра — главное.",
    actions: [
      { label: "Да, закончить", primary: true, onClick: async () => { await clearGame(); hideModal(); showScreen("menu"); checkContinue(); } },
      { label: "Отмена", onClick: hideModal },
    ],
  });
}

// ============================================================
//  MODAL
// ============================================================

function showModal({ title, text, actions }) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-text").textContent = text;
  const ac = document.getElementById("modal-actions");
  ac.innerHTML = "";
  for (const a of actions) {
    const b = document.createElement("button");
    b.className = "btn " + (a.primary ? "btn-primary" : "btn-ghost");
    b.textContent = a.label;
    b.onclick = a.onClick;
    ac.appendChild(b);
  }
  document.getElementById("modal").hidden = false;
}
function hideModal() { document.getElementById("modal").hidden = true; }

// ============================================================
//  TELEGRAM BackButton
// ============================================================

if (TG_BACKBTN && TG.BackButton) {
  try {
    TG.BackButton.onClick(() => {
      const active = document.querySelector(".screen.active")?.dataset.screen;
      if (active === "setup" || active === "rules") showScreen("menu");
      else if (active === "game") showPauseMenu();
    });
  } catch {}
}

// ============================================================
//  CONTINUE кнопка
// ============================================================

async function checkContinue() {
  const saved = await loadGame();
  document.getElementById("btn-continue").hidden = !saved;
}

// ============================================================
//  ИНИЦИАЛИЗАЦИЯ
// ============================================================

(async () => {
  await loadSettings();
  await loadCards();
  await checkContinue();
  showScreen("menu");
  setupDice3D();

  // регистрация service worker (для оффлайн работы)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    try { await navigator.serviceWorker.register("sw.js"); } catch (e) { console.warn("SW", e); }
  }
})();
