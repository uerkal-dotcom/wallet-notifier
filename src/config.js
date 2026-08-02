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

  // Kendi cuzdanim - "bu pozisyona girdim mi" kontrolu icin (salt okunur,
  // sadece pozisyon listesi cekilir; hicbir islem acilmaz).
  myWallet: (process.env.MY_WALLET || "").toLowerCase(),
  // Sinyalden bu kadar dakika sonra hala girmemissem hatirlat.
  reminderAfterMinutes: Number(process.env.REMINDER_AFTER_MINUTES || 15),
  // Fiyat sinyal anindan bu kadar (goreli %) kaydiysa "girme" uyarisi ver.
  maxSlippagePct: Number(process.env.MAX_SLIPPAGE_PCT || 15),
  // Bu kadar dakika gectiyse hatirlatmanin degeri kalmadi, sessizce kapat.
  staleAfterMinutes: Number(process.env.STALE_AFTER_MINUTES || 120),
  // Ayni anda acik TUM pozisyonlarin kasaya orani bu tavani asamaz.
  // Olay bazli tavandan (%12.5) ayridir - iki trader birden sinyal
  // uretmeye baslayinca toplam maruziyet hizla sisebilir.
  maxTotalExposurePct: Number(process.env.MAX_TOTAL_EXPOSURE_PCT || 60),
};

if (!config.telegramBotToken) {
  throw new Error("TELEGRAM_BOT_TOKEN ortam degiskeni tanimli degil.");
}
if (!config.telegramChatId) {
  throw new Error("TELEGRAM_CHAT_ID ortam degiskeni tanimli degil.");
}
