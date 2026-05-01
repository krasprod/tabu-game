// Образец карточек — 30 шт по разным категориям, чтобы утвердить тон
// Запуск: node scripts/generate-cards-sample.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const configText = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const ANTHROPIC_KEY = configText.match(/ANTHROPIC_API_KEY:\s*["']([^"']+)["']/)?.[1];
const MODEL = configText.match(/CLAUDE_MODEL:\s*["']([^"']+)["']/)?.[1] || "claude-haiku-4-5-20251001";

if (!ANTHROPIC_KEY || ANTHROPIC_KEY.startsWith("ВСТАВЬ")) {
  console.error("❌ ANTHROPIC_API_KEY не задан в config.js");
  process.exit(1);
}

// Категории карточек по аналогии с оригиналом «Розпуста»
const REQUEST = {
  task_soft: { count: 5, ru: "ЗАДАНИЕ — мягкое (флирт, прелюдия, поцелуи, разговоры с прикосновениями)", level: 1 },
  task_mid: { count: 5, ru: "ЗАДАНИЕ — среднее (раздевание, эротический массаж, оральные ласки, фростинг)", level: 2 },
  task_hard: { count: 5, ru: "ЗАДАНИЕ — жёсткое (откровенный секс, позы, доминирование, без табу)", level: 3 },
  truth: { count: 5, ru: "ВОПРОС-ПРАВДА — откровенный вопрос про фантазии, опыт, желания партнёра", level: 0 },
  for_him: { count: 4, ru: "ЛИЧНОЕ ДЛЯ НЕГО — задание, которое выполняет только мужчина", level: 2 },
  for_her: { count: 4, ru: "ЛИЧНОЕ ДЛЯ НЕЁ — задание, которое выполняет только женщина", level: 2 },
  swap: { count: 1, ru: "ОБМЕН — задание поменяться ролями (доминатор/подчинённый)", level: 2 },
  bold: { count: 1, ru: "ШТРАФ-ДЬЯВОЛ — особое жёсткое задание-вызов", level: 3 },
};

const SYSTEM = `Ты — автор контента для взрослой настольной игры «Розпуста» 18+ для пар.
Игра — для гетеро-пары в спальне. Партнёров двое: Он и Она.
Тон: дерзкий, игривый, сексуальный, конкретный, без пошлятины и колхоза.
Язык: русский, на «ты», обращение к игроку (а не «партнёр X сделает»).
Стиль как в оригинале: коротко (1-2 предложения), часто с таймером (10-30 секунд / 1 минута).
Никакой воды, никакого "почувствуй страсть" — только конкретные действия или вопросы.

ВАЖНО:
- НИКОГДА не используй пошлые/уличные слова. Будь сексуально, но изысканно.
- Конкретика > абстракция. "Поцелуй за ушком 10 секунд" лучше чем "проведи время вместе".
- Разнообразие. Не повторяйся.
- Уважение и согласие — встроены в формулировки. Никакого принуждения.
- Если задание подразумевает интимные действия — называй части тела взрослыми, но нормальными словами.
- Не используй слова: "интим", "интимное место", "ласка" слишком часто. Будь точнее.

Формат ответа: строго JSON-массив объектов вида:
[{"id":"task_soft_01","category":"task_soft","level":1,"text":"...","timer":30}]
- id: уникальный идентификатор формата category_NN
- category: ключ категории
- level: 0 (правда) / 1 / 2 / 3
- text: текст задания (1-2 предложения, без переводов строк)
- timer: число секунд (если уместно), иначе null

Не оборачивай в \`\`\`json. Верни чистый JSON-массив.`;

const userPrompts = [];
for (const [cat, info] of Object.entries(REQUEST)) {
  userPrompts.push(`${info.count} карточек категории "${cat}" (${info.ru})`);
}

const userMsg = `Сгенерируй карточки в количестве:
${userPrompts.join("\n")}

Итого 30 карточек. Верни одним JSON-массивом.`;

console.log(`🤖 Запрашиваю у ${MODEL}...`);

const res = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "x-api-key": ANTHROPIC_KEY,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  }),
});

if (!res.ok) {
  console.error("❌ Anthropic", res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
const text = data.content?.[0]?.text || "";

// Вытащим JSON
let cards;
try {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  cards = JSON.parse(cleaned);
} catch (e) {
  console.error("❌ Не удалось распарсить ответ как JSON:");
  console.error(text);
  process.exit(1);
}

const outPath = path.join(ROOT, "data", "cards-sample.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(cards, null, 2));

console.log(`\n✅ Сгенерировано ${cards.length} карточек → ${outPath}\n`);
console.log("─".repeat(60));
const grouped = {};
for (const c of cards) {
  (grouped[c.category] ||= []).push(c);
}
for (const [cat, list] of Object.entries(grouped)) {
  console.log(`\n📂 ${cat} (${list.length}):`);
  for (const c of list) {
    const t = c.timer ? ` [${c.timer}с]` : "";
    console.log(`   • ${c.text}${t}`);
  }
}
console.log("\n" + "─".repeat(60));
console.log(`Использовано токенов: in=${data.usage.input_tokens}, out=${data.usage.output_tokens}`);
