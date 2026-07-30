import { fetchOpenPositions } from "./positions.js";
import { sendTelegramMessage } from "./telegram.js";

// skyman44'in bir marketteki toplam yatirdigi tutara (initialValue) gore
// bizim ne kadarlik kagit pozisyon acacagimizi belirleyen kademe tablosu.
const TIERS = [
  { min: 20000, stake: 20 },
  { min: 15000, stake: 15 },
  { min: 10000, stake: 10 },
  { min: 5000, stake: 6 },
  { min: 0, stake: 3 },
];

function tierStake(investedUsd) {
  if (!investedUsd || investedUsd <= 0) return 0;
  for (const tier of TIERS) {
    if (investedUsd >= tier.min) return tier.stake;
  }
  return 0;
}

function fmt(n) {
  return `$${Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

function positionKey(position) {
  return `${position.conditionId}:${position.outcomeIndex}`;
}

async function openPosition(paperState, wallet, position, targetStake) {
  if (paperState.balance < targetStake) {
    await sendTelegramMessage(
      `⚠️ <b>${wallet.label}</b> [KAĞIT] Bakiye yetersiz — ${position.title} (${position.outcome}) icin ${fmt(
        targetStake
      )} gerekiyordu, mevcut bakiye ${fmt(paperState.balance)}.`
    );
    return;
  }

  const key = positionKey(position);
  const size = targetStake / position.curPrice;
  paperState.balance -= targetStake;
  paperState.positions[key] = {
    title: position.title,
    outcome: position.outcome,
    slug: position.slug,
    eventSlug: position.eventSlug,
    stake: targetStake,
    entryPrice: position.curPrice,
    size,
    lastPrice: position.curPrice,
  };

  await sendTelegramMessage(
    `📝 <b>${wallet.label}</b> [KAĞIT] Yeni pozisyon\n${position.title} — ${position.outcome}\n` +
      `Onun yatirdigi: ${fmt(position.initialValue)} → Bizim pay: ${fmt(targetStake)} @ ${(
        position.curPrice * 100
      ).toFixed(1)}c\n` +
      `Bakiye: ${fmt(paperState.balance)}`
  );
}

async function increasePosition(paperState, wallet, position, existing, targetStake) {
  const delta = targetStake - existing.stake;
  if (paperState.balance < delta) {
    await sendTelegramMessage(
      `⚠️ <b>${wallet.label}</b> [KAĞIT] Bakiye yetersiz — ${position.title} pozisyonunu ${fmt(
        targetStake
      )}'a cikaramadik (gereken ek: ${fmt(delta)}, bakiye: ${fmt(paperState.balance)}).`
    );
    return;
  }

  const addedSize = delta / position.curPrice;
  const newSize = existing.size + addedSize;
  paperState.balance -= delta;
  existing.stake = targetStake;
  existing.size = newSize;
  existing.entryPrice = targetStake / newSize;
  existing.lastPrice = position.curPrice;

  await sendTelegramMessage(
    `📈 <b>${wallet.label}</b> [KAĞIT] Pozisyon artirildi\n${position.title} — ${position.outcome}\n` +
      `+${fmt(delta)} @ ${(position.curPrice * 100).toFixed(1)}c → toplam ${fmt(targetStake)}\n` +
      `Bakiye: ${fmt(paperState.balance)}`
  );
}

async function reducePosition(paperState, wallet, position, existing, targetStake) {
  const sellFraction = (existing.stake - targetStake) / existing.stake;
  const soldSize = existing.size * sellFraction;
  const proceeds = soldSize * position.curPrice;
  const soldCost = existing.stake * sellFraction;
  const realized = proceeds - soldCost;

  paperState.balance += proceeds;
  paperState.realizedPnl += realized;
  existing.stake = targetStake;
  existing.size = existing.size - soldSize;
  existing.lastPrice = position.curPrice;

  const emoji = realized >= 0 ? "📉" : "📉🔻";
  await sendTelegramMessage(
    `${emoji} <b>${wallet.label}</b> [KAĞIT] Pozisyon azaltildi\n${position.title} — ${position.outcome}\n` +
      `${fmt(soldCost)}'lik kisim satildi @ ${(position.curPrice * 100).toFixed(1)}c, gerceklesen K/Z: ${fmt(
        realized
      )}\n` +
      `Kalan: ${fmt(targetStake)} — Bakiye: ${fmt(paperState.balance)}`
  );
}

async function closePosition(paperState, wallet, key, existing) {
  const proceeds = existing.size * existing.lastPrice;
  const realized = proceeds - existing.stake;

  paperState.balance += proceeds;
  paperState.realizedPnl += realized;
  delete paperState.positions[key];

  const emoji = realized >= 0 ? "✅" : "❌";
  await sendTelegramMessage(
    `${emoji} <b>${wallet.label}</b> [KAĞIT] Pozisyon kapandi\n${existing.title} — ${existing.outcome}\n` +
      `Tahmini kapanis fiyati: ${(existing.lastPrice * 100).toFixed(1)}c (son bilinen)\n` +
      `Gerceklesen K/Z: ${fmt(realized)} — Bakiye: ${fmt(paperState.balance)}`
  );
}

export async function checkPaperTrading(paperState, wallet) {
  const allPositions = await fetchOpenPositions(wallet.address);
  // redeemable=true, market cozulmus (kazanmis/kaybetmis) ama henuz redeem
  // edilmemis eski bahisler demektir; bunlar artik "acik pozisyon" degildir.
  const positions = allPositions.filter((p) => !p.redeemable);
  const seenKeys = new Set();

  for (const position of positions) {
    const key = positionKey(position);
    seenKeys.add(key);
    const targetStake = tierStake(position.initialValue);
    const existing = paperState.positions[key];

    if (!existing && targetStake > 0) {
      await openPosition(paperState, wallet, position, targetStake);
    } else if (existing && targetStake > existing.stake) {
      await increasePosition(paperState, wallet, position, existing, targetStake);
    } else if (existing && targetStake < existing.stake && targetStake > 0) {
      await reducePosition(paperState, wallet, position, existing, targetStake);
    } else if (existing) {
      existing.lastPrice = position.curPrice;
    }
  }

  for (const key of Object.keys(paperState.positions)) {
    if (!seenKeys.has(key)) {
      await closePosition(paperState, wallet, key, paperState.positions[key]);
    }
  }
}
