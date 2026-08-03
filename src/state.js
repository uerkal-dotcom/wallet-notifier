import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

// DIKKAT - state.json SADECE kagit-trading modunda OLMAYAN cuzdanlar icin
// kullanilir. index.js'te akis su sekilde ayriliyor:
//
//   if (wallet.paper) checkPaperTrading(...)  -> paper-portfolio.json
//   else              checkWallet(state, ...) -> state.json  (burasi)
//
// Su anda TUM cuzdanlar (skyman44, joblessfinalboss) kagit modunda oldugu
// icin bu dosya hicbir cuzdan icin guncellenmiyor ve icerigi BAYAT kalir.
// Bu normaldir, ariza degildir.
//
// 2026-08-03: bu dosyadaki eski lastTimestamp'lere bakilip "bot 82 saattir
// islem kaciriyor, 87 islem gormemis" diye yanlis bir alarm verildi. Canli
// durum icin BAKILACAK YER paper-portfolio.json'dir. Yanlis yonlendirmemesi
// icin bayat icerik temizlendi.
const MAX_SEEN_HASHES_PER_WALLET = 100;

export function loadState() {
  if (!existsSync(config.statePath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(config.statePath, "utf-8"));
  } catch {
    return {};
  }
}

export function saveState(state) {
  const dir = dirname(config.statePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(config.statePath, JSON.stringify(state, null, 2));
}

export function getWalletState(state, address) {
  return state[address] || { lastTimestamp: 0, seenHashes: [], initialized: false };
}

export function updateWalletState(state, address, lastTimestamp, newHashes) {
  const prev = getWalletState(state, address);
  const mergedHashes = [...new Set([...newHashes, ...prev.seenHashes])].slice(
    0,
    MAX_SEEN_HASHES_PER_WALLET
  );
  state[address] = {
    lastTimestamp: Math.max(lastTimestamp, prev.lastTimestamp),
    seenHashes: mergedHashes,
    initialized: true,
  };
}
