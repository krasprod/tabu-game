// Догенерация task_hard в две пачки (по 35 шт), чтобы влезть в max_tokens
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const configText = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const ANTHROPIC_KEY = configText.match(/ANTHROPIC_API_KEY:\s*["']([^"']+)["']/)?.[1];
const MODEL = "claude-sonnet-4-6";

const SYSTEM = `Ты — автор контента для эротической онлайн-игры «ТАБУ» 18+ для гетеро-пар.
Безупречный русский: правильные падежи, согласование родов, никаких канцеляризмов.

Категория: task_hard — ЖЁСТКОЕ ЗАДАНИЕ, СИММЕТРИЧНОЕ (вытянуть может Он или Она).
- Описывай позы и интенсивные действия БЕЗ привязки к роду: «вы оба», «друг к другу», «партнёра», императив без рода.
- Если действие гендерное (минет/куни/проникновение) — НЕ ставь сюда. Эта категория про обоюдные интенсивные действия.
- Используй: «целуйтесь», «прикасайтесь», «двигайтесь», «удерживай партнёра», «оба замрите», «вместе», «прижмись», «обхвати».
- БЕЗ слов «её/ей/она», «его/ему/он» — это сломает карточку для половины игроков.
- Уровень: жёстко, откровенно, страстно. Длительность 30-180 секунд или до результата.
- Запреты: БДСМ с реальной болью, бывшие, бэйби-токинг, групповуха, костюмы.

ФОРМАТ — JSON-массив, без \`\`\`. Каждая:
{"id":"task_hard_NNN","category":"task_hard","level":3,"text":"...","timer":число_или_null,"tags":[],"required_toy":null}

tags: можно ["dom_sub"] или ["intense"] или [] для нейтральных.`;

const ANTHROPIC_HEADERS = {
  "x-api-key": ANTHROPIC_KEY,
  "anthropic-version": "2023-06-01",
  "content-type": "application/json",
};

async function batch(startIdx, count) {
  const user = `Сгенерируй ${count} карточек task_hard. ID начинай с "task_hard_${String(startIdx).padStart(3,"0")}" и далее по порядку. Верни одним JSON-массивом.`;

  console.log(`🤖 task_hard ${startIdx}-${startIdx+count-1}...`);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: ANTHROPIC_HEADERS,
    body: JSON.stringify({ model: MODEL, max_tokens: 6000, system: SYSTEM, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) { console.error(await res.text()); return []; }
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    const arr = JSON.parse(cleaned);
    console.log(`  ✅ ${arr.length} карточек, in=${data.usage.input_tokens}, out=${data.usage.output_tokens}`);
    return arr;
  } catch (e) { console.error("parse:", e.message, cleaned.slice(0,300)); return []; }
}

const a = await batch(1, 35);
const b = await batch(36, 35);
const newCards = [...a, ...b];

const cardsPath = path.join(ROOT, "data", "cards.json");
const existing = JSON.parse(fs.readFileSync(cardsPath, "utf8"));
const merged = [...existing, ...newCards];
fs.writeFileSync(cardsPath, JSON.stringify(merged, null, 2));
console.log(`\n✅ Добавлено ${newCards.length} task_hard. Всего в пуле: ${merged.length}`);
