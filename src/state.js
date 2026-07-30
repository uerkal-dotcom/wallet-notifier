import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

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
