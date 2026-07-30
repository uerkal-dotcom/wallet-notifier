import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

export function loadPaperState() {
  if (!existsSync(config.paperStatePath)) {
    return { balance: config.paperStartBalance, realizedPnl: 0, positions: {} };
  }
  try {
    return JSON.parse(readFileSync(config.paperStatePath, "utf-8"));
  } catch {
    return { balance: config.paperStartBalance, realizedPnl: 0, positions: {} };
  }
}

export function savePaperState(paperState) {
  const dir = dirname(config.paperStatePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(config.paperStatePath, JSON.stringify(paperState, null, 2));
}
