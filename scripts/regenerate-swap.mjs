// Регенерация swap-карточек — конкретные, без абстракций про "ведущего"
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const configText = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const ANTHROPIC_KEY = configText.match(/ANTHROPIC_API_KEY:\s*["']([^"']+)["']/)?.[1];

const SYSTEM = `Ты — автор контента для эротической игры «ТАБУ» 18+ для пары.
Безупречный русский, никаких канцеляризмов.

Категория: swap (СМЕНА РОЛЕЙ).
КЛЮЧЕВОЕ ПРАВИЛО: карточка должна быть ПОНЯТНА С ПЕРВОЙ СЕКУНДЫ. Никаких абстракций «ведущий становится ведомым», «активный игрок», «инициатор» — это непонятно паре, которая только начала играть.

Хорошие swap-карточки описывают КОНКРЕТНОЕ действие смены ролей:
- «Поменяйтесь местами в кровати: кто слева — переходит направо. Поцелуйтесь в новой позиции 30 секунд.»
- «Кто вытянул карточку, кладёт руки за голову. Партнёр следующие 60 секунд делает с твоим телом всё что хочет — ты не двигаешь руками.»
- «Закрой глаза и не открывай 90 секунд. Партнёр в это время решает что с тобой делать — ты только чувствуешь.»
- «Тот, кто читает карточку — берёт инициативу: целует партнёра туда, куда хочет, в течение 60 секунд. Партнёр не сопротивляется и не направляет.»
- «Возьми партнёра за запястья и удерживай над его головой 60 секунд. Целуй шею и грудь, пока партнёр не двигает руками.»
- «Переверни партнёра на спину (или встань над ним сам). Следующие 90 секунд тот, кто внизу — не двигается, тот кто сверху — делает что хочет в рамках уровня.»

ПЛОХИЕ карточки (так НЕЛЬЗЯ):
- «Меняетесь ролями» (что меняем?)
- «Ведущий становится ведомым» (а кто ведущий?)
- «Партнёр решает что происходит» (нужно описать что именно)

Каждая swap-карточка должна:
1) Однозначно сказать кто что делает (используй «тот, кто читает карточку» или «вытянувший карточку», или «один из вас» с явным описанием)
2) Описать конкретное физическое действие
3) Указать длительность

СИММЕТРИЧНО: партнёра не привязывай к гендеру. «Партнёр», «друг друга», «он/она» НЕ использовать.

ЗАПРЕТЫ: БДСМ с реальной болью, бывшие, бэйби-токинг, групповуха, костюмы.

ФОРМАТ — JSON-массив, без \`\`\`. Каждая карточка:
{"id":"swap_NNN","category":"swap","level":1_или_2,"text":"...","timer":число_секунд_или_null,"tags":[],"required_toy":null}

Распределение уровней: 12 карточек level=1 (легкие, без секса — поцелуи, прикосновения, позиции тел), 13 карточек level=2 (средние — раздевание, оральные ласки с переменой ролей, петтинг).`;

async function batch(level, count, startIdx) {
  const userMsg = `Сгенерируй ${count} swap-карточек level=${level}. Все КОНКРЕТНЫЕ, без абстракций. ID начинай с "swap_${String(startIdx).padStart(3,"0")}". Верни одним JSON-массивом.`;
  console.log(`🤖 swap level=${level} (${count} шт)...`);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });
  if (!res.ok) { console.error(await res.text()); return []; }
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const arr = JSON.parse(cleaned);
    console.log(`  ✅ ${arr.length} карточек, in=${data.usage.input_tokens}, out=${data.usage.output_tokens}`);
    return arr;
  } catch (e) {
    console.error("parse error:", e.message);
    console.error(cleaned.slice(-300));
    return [];
  }
}

const easy = await batch(1, 12, 1);
const mid = await batch(2, 13, 13);
const newSwap = [...easy, ...mid];
console.log(`\n✅ Итого ${newSwap.length} swap-карточек`);

// Заменяем swap в cards.json
const cardsPath = path.join(ROOT, "data", "cards.json");
const all = JSON.parse(fs.readFileSync(cardsPath, "utf8"));
const without = all.filter((c) => c.category !== "swap");
const merged = [...without, ...newSwap];
fs.writeFileSync(cardsPath, JSON.stringify(merged, null, 2));
console.log(`✅ Заменено в cards.json. Всего: ${merged.length}`);

// Образцы
console.log("\nОбразцы (3 первых):");
for (const c of newSwap.slice(0, 5)) console.log(`  L${c.level}: ${c.text}`);
