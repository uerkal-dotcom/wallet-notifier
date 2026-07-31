import { config } from "./config.js";

const MIN_INTERVAL_MS = 1200;
let lastSendAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const wait = lastSendAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastSendAt = Date.now();
}

export async function sendTelegramMessage(text, options = {}) {
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`;
  const payload = {
    chat_id: config.telegramChatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  if (options.buttons?.length) {
    payload.reply_markup = { inline_keyboard: [options.buttons] };
  } else if (options.buttonUrl) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: options.buttonText || "Polymarket'te Ac", url: options.buttonUrl }]],
    };
  }

  const body = JSON.stringify(payload);

  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (res.ok) return;

    const errText = await res.text();
    if (res.status === 429) {
      let retryAfter = 3;
      try {
        retryAfter = JSON.parse(errText).parameters?.retry_after ?? retryAfter;
      } catch {
        // yoksay, varsayilan bekleme suresini kullan
      }
      console.error(`Telegram hiz limiti, ${retryAfter}s bekleniyor...`);
      await sleep((retryAfter + 1) * 1000);
      continue;
    }

    console.error("Telegram gonderim hatasi:", errText);
    return;
  }
}
