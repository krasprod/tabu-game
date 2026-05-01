// ============================================================
//  КОНФИГУРАЦИЯ — API КЛЮЧИ
// ============================================================
//
//  Для локальной разработки с AI-фичами:
//  скопируй config.local.js → config.js  (не коммить его)
//
//  Где получить ключи:
//  1) ANTHROPIC_API_KEY: https://console.anthropic.com/settings/keys
//  2) OPENROUTER_API_KEY: https://openrouter.ai/settings/keys
//
// ============================================================

window.APP_CONFIG = {
  ANTHROPIC_API_KEY: "ВСТАВЬ_КЛЮЧ_ANTHROPIC",
  OPENROUTER_API_KEY: "ВСТАВЬ_КЛЮЧ_OPENROUTER",

  CLAUDE_MODEL: "claude-haiku-4-5-20251001",
  IMAGE_MODEL: "google/gemini-3-pro-image-preview",

  LANGUAGE: "ru",
  DEFAULT_INTENSITY: 2,
};
