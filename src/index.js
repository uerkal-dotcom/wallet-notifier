import { config } from "./config.js";
import { fetchRecentTrades } from "./market.js";
import { sendTelegramMessage } from "./telegram.js";
import { loadState, saveState, getWalletState, updateWalletState } from "./state.js";
import { loadPaperState, savePaperState } from "./paperState.js";
import { checkPaperTrading } from "./paperTrading.js";

function formatTrade(walletLabel, trade) {
  const sideEmoji = trade.side === "BUY" ? "🟢" : "🔴";
  const sizeStr = trade.usdcSize
    ? `$${Number(trade.usdcSize).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}`
    : "";
  const priceStr = trade.price ? `${(Number(trade.price) * 100).toFixed(1)}c` : "";

  return (
    `${sideEmoji} <b>${walletLabel}</b> ${trade.side} — ${trade.outcome}\n` +
    `${trade.title}\n` +
    `${sizeStr} @ ${priceStr}`
  );
}

async function checkWallet(state, wallet) {
  const trades = await fetchRecentTrades(wallet.address);
  const wState = getWalletState(state, wallet.address);
  const isFirstRun = !wState.initialized;

  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  const newTrades = sorted.filter((t) => {
    if (t.timestamp < wState.lastTimestamp) return false;
    if (t.timestamp === wState.lastTimestamp && wState.seenHashes.includes(t.transactionHash)) {
      return false;
    }
    return true;
  });

  if (!isFirstRun) {
    for (const trade of newTrades) {
      if (Number(trade.usdcSize || 0) < config.minUsdcSize) continue;
      const buttonUrl = trade.slug
        ? `https://polymarket.com/event/${trade.eventSlug || trade.slug}`
        : undefined;
      await sendTelegramMessage(formatTrade(wallet.label, trade), { buttonUrl });
    }
  }

  if (sorted.length > 0) {
    const maxTimestamp = sorted[sorted.length - 1].timestamp;
    const hashesAtMax = sorted
      .filter((t) => t.timestamp === maxTimestamp)
      .map((t) => t.transactionHash);
    updateWalletState(state, wallet.address, maxTimestamp, hashesAtMax);
  }
}

async function pollOnce(state, paperState) {
  for (const wallet of config.wallets) {
    try {
      if (wallet.paper) {
        await checkPaperTrading(paperState, wallet);
      } else {
        await checkWallet(state, wallet);
      }
    } catch (err) {
      console.error(`[${wallet.label}] hata:`, err.message);
    }
  }
  saveState(state);
  savePaperState(paperState);
}

async function main() {
  const runOnce = process.env.RUN_ONCE === "1";
  console.log(
    `Baslatildi. ${config.wallets.length} cuzdan izleniyor, her ${config.pollIntervalSeconds}s kontrol edilecek.`
  );
  const state = loadState();
  const paperState = loadPaperState();

  await pollOnce(state, paperState);

  if (runOnce) {
    console.log("Tek seferlik calisma tamamlandi.");
    return;
  }

  setInterval(() => pollOnce(state, paperState), config.pollIntervalSeconds * 1000);
}

main().catch((err) => {
  console.error("Beklenmeyen hata:", err);
  process.exit(1);
});
