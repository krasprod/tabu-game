// Генерация картинок через NanoBanana Pro (Gemini 3 Pro Image) на OpenRouter
// Запуск: node scripts/generate-images.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const configText = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const OPENROUTER_KEY = configText.match(/OPENROUTER_API_KEY:\s*["']([^"']+)["']/)?.[1];
const IMAGE_MODEL = configText.match(/IMAGE_MODEL:\s*["']([^"']+)["']/)?.[1];

if (!OPENROUTER_KEY || OPENROUTER_KEY.startsWith("ВСТАВЬ")) {
  console.error("❌ OPENROUTER_API_KEY не задан в config.js");
  process.exit(1);
}

const OUT_DIR = path.join(ROOT, "assets");
fs.mkdirSync(OUT_DIR, { recursive: true });

async function generateImage(filename, prompt) {
  console.log(`\n🎨 Генерирую: ${filename}`);
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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }

  const data = await res.json();
  const message = data.choices?.[0]?.message;
  const images = message?.images || [];
  if (!images.length) {
    console.error("⚠️  Нет картинок:", JSON.stringify(message).slice(0, 500));
    return false;
  }
  const url = images[0].image_url?.url || images[0].url;
  const base64 = url.split(",")[1];
  const buffer = Buffer.from(base64, "base64");
  const outPath = path.join(OUT_DIR, filename);
  fs.writeFileSync(outPath, buffer);
  console.log(`✅ ${outPath} (${(buffer.length / 1024).toFixed(0)} KB)`);
  return true;
}

// ============================================================
//  TABU — премиальный тёмно-красный, не пиксельный
// ============================================================

const BRAND = `Brand: "TABU" — premium adult game for couples.
Aesthetic: dark luxurious speakeasy after midnight. NOT pixelated, NOT grunge.
Color palette: deep oxblood / wine red (#3A0A12 to #8B1A1A), pure black (#0A0506),
subtle warm gold accents (#C9A961). Smooth velvet and liquid surfaces, not mosaics.
Mood: forbidden, sensual, classy, expensive. Like Tom Ford packaging meets a sealed envelope.
Texture: matte velvet, ink-like fluid, fine film grain. Soft glow, deep shadows.
NO faces, NO bodies, NO pixel patterns, NO emojis, NO sloppy lettering.`;

const targets = [
  {
    file: "tabu-splash.png",
    prompt: `Vertical poster 9:16 for the TABU adult game splash screen. ${BRAND}
Centered: a stylized bold letter "T" mark with small subtle devil horns on top corners
(white off-white color, hand-drawn distressed edges, slightly grungy texture, NOT clean —
similar in spirit to a hand-stenciled rebellious logo).
Below the T mark — bold heavy Cyrillic title "ТАБУ" in distressed/grunge sans-serif font,
white off-white color, rough textured edges (like spray paint or worn stencil),
strong heavy weight, slightly uneven baseline, cinematic.
Below title in smaller cleaner font: "игра для двоих • 18+".
Background: deep oxblood velvet with soft red glow behind the T mark, matte black edges,
subtle film grain. Dark moody, like a forbidden poster on a brick wall after midnight.
NO pixels, NO emojis, NO faces, NO bodies. Distressed grunge aesthetic for the typography.`,
  },
];

for (const t of targets) {
  try {
    await generateImage(t.file, t.prompt);
  } catch (e) {
    console.error(`❌ ${t.file}:`, e.message);
  }
}

console.log("\n🎉 Готово.");
