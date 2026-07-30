function loadWallets(paperTradingAddresses) {
  const raw = process.env.WALLETS;
  if (!raw) {
    throw new Error(
      "WALLETS ortam degiskeni tanimli degil. Ornek: WALLETS=0xabc...:Ahmet,0xdef...:Mehmet"
    );
  }
  return raw.split(",").map((entry) => {
    const [address, label] = entry.trim().split(":");
    const lowerAddress = address.toLowerCase();
    return {
      address: lowerAddress,
      label: label || address.slice(0, 8),
      paper: paperTradingAddresses.has(lowerAddress),
    };
  });
}

function loadPaperTradingAddresses() {
  const raw = process.env.PAPER_TRADING_WALLETS || "";
  return new Set(
    raw
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean)
  );
}

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS || 30),
  minUsdcSize: Number(process.env.MIN_USDC_SIZE || 0),
  statePath: process.env.STATE_PATH || "./data/state.json",
  paperStatePath: process.env.PAPER_STATE_PATH || "./data/paper-portfolio.json",
  paperStartBalance: Number(process.env.PAPER_START_BALANCE || 380),
  wallets: loadWallets(loadPaperTradingAddresses()),
};

if (!config.telegramBotToken) {
  throw new Error("TELEGRAM_BOT_TOKEN ortam degiskeni tanimli degil.");
}
if (!config.telegramChatId) {
  throw new Error("TELEGRAM_CHAT_ID ortam degiskeni tanimli degil.");
}
