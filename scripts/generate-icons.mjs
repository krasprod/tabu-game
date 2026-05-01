// Иконки категорий + рубашка карточки + app icon
// Запуск: node scripts/generate-icons.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const configText = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const OPENROUTER_KEY = configText.match(/OPENROUTER_API_KEY:\s*["']([^"']+)["']/)?.[1];
const IMAGE_MODEL = configText.match(/IMAGE_MODEL:\s*["']([^"']+)["']/)?.[1];

const OUT_DIR = path.join(ROOT, "assets");

async function gen(filename, prompt) {
  console.log(`🎨 ${filename}`);
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://tabu.local",
      "X-Title": "TABU Game",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      modalities: ["image", "text"],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) { console.error(await res.text()); return; }
  const data = await res.json();
  const url = data.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!url) { console.error("no image"); return; }
  const buffer = Buffer.from(url.split(",")[1], "base64");
  fs.writeFileSync(path.join(OUT_DIR, filename), buffer);
  console.log(`  ✅ ${(buffer.length/1024).toFixed(0)} KB`);
}

const ICON_STYLE = `Style: bold modern flat icon, white-cream color (#F5E8D5),
distressed grunge edges (rough hand-drawn / stencil look),
on transparent dark background, clean silhouette,
single subject centered, minimal, recognizable at small size.
Square 1024x1024. NO text, NO frames, NO watermarks.`;

const targets = [
  // Иконка приложения
  { file: "app-icon.png", prompt: `App icon for an adult game called TABU. Square 1024x1024.
Round red wax seal with thin gold rim, embossed letter "T" in gold sans-serif at center,
small subtle horns above the T. Background: deep oxblood velvet with soft red glow,
matte black corners. Premium luxurious feel. NO text other than the T. Centered, full square.` },

  // Рубашка карточки
  { file: "card-back.png", prompt: `Card back design for a luxury adult playing card.
Vertical aspect 5:8. Dark deep oxblood velvet background with subtle wine ripples and soft red glow.
Centered: stylized white grunge letter "T" with small devil horns (off-white, distressed edges).
Thin gold border frame around the card edges. Subtle film grain. NO text other than T.
Premium, mysterious, like the back of an exclusive members-only card.` },

  // Иконки категорий (4 штуки)
  { file: "icon-task.png", prompt: `Icon: stylized red lips (kiss mark), distressed grunge edges, ${ICON_STYLE}` },
  { file: "icon-truth.png", prompt: `Icon: stylized eye (open eye, sensual), distressed grunge edges, ${ICON_STYLE}` },
  { file: "icon-swap.png", prompt: `Icon: two circular arrows forming a swap/exchange symbol, distressed grunge, ${ICON_STYLE}` },
  { file: "icon-bold.png", prompt: `Icon: stylized devil head silhouette with horns and curling tail, distressed grunge, ${ICON_STYLE}` },
  { file: "icon-skip.png", prompt: `Icon: prohibition symbol (circle with diagonal slash), distressed grunge, ${ICON_STYLE}` },
];

for (const t of targets) {
  try { await gen(t.file, t.prompt); }
  catch (e) { console.error(`❌ ${t.file}:`, e.message); }
}
console.log("\n🎉 Готово");
