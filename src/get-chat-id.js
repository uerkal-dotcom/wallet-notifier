const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Once TELEGRAM_BOT_TOKEN ortam degiskenini ayarlayin.");
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
const data = await res.json();

if (!data.result || data.result.length === 0) {
  console.log(
    "Henuz mesaj bulunamadi. Once Telegram'da botunuza /start yazip bir mesaj gonderin, sonra bu scripti tekrar calistirin."
  );
  process.exit(0);
}

const chatIds = new Set();
for (const update of data.result) {
  const chat = update.message?.chat || update.channel_post?.chat;
  if (chat) chatIds.add(`${chat.id} (${chat.type}${chat.title ? ": " + chat.title : ""}${chat.username ? " @" + chat.username : ""})`);
}

console.log("Bulunan chat id'ler:");
for (const id of chatIds) console.log(" -", id);
