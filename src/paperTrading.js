import { fetchOpenPositions } from "./positions.js";
import { sendTelegramMessage } from "./telegram.js";
import { suggestedStake } from "./sizing.js";

function fmt(n) {
  return `$${Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

function positionKey(position) {
  return `${position.conditionId}:${position.outcomeIndex}`;
}

function computeBankroll(paperState) {
  const staked = Object.values(paperState.positions).reduce((s, p) => s + p.stake, 0);
  return paperState.balance + staked;
}

function eventExposure(paperState, eventSlug) {
  return Object.values(paperState.positions)
    .filter((p) => p.eventSlug === eventSlug)
    .reduce((s, p) => s + p.stake, 0);
}

async function openPosition(paperState, wallet, position, suggestion) {
  const { stake, marketType, band, cap, currentEventExposure } = suggestion;

  if (paperState.balance < stake) {
    await sendTelegramMessage(
      `⚠️ <b>${wallet.label}</b> [KAĞIT] Bakiye yetersiz — ${position.title} (${position.outcome}) icin ${fmt(
        stake
      )} onerilmisti, mevcut bakiye ${fmt(paperState.balance)}.`
    );
    return;
  }

  const key = positionKey(position);
  const size = stake / position.curPrice;
  paperState.balance -= stake;
  paperState.positions[key] = {
    title: position.title,
    outcome: position.outcome,
    slug: position.slug,
    eventSlug: position.eventSlug,
    stake,
    entryPrice: position.curPrice,
    size,
    lastPrice: position.curPrice,
  };

  await sendTelegramMessage(
    `📝 <b>${wallet.label}</b> [KAĞIT] Yeni pozisyon\n` +
      `[TÜR: ${marketType}] [BANT: ${band}]\n` +
      `${position.title} — ${position.outcome}\n` +
      `Fiyat: ${(position.curPrice * 100).toFixed(1)}c\n` +
      `Olay: ${position.eventSlug} — maruziyet: ${fmt(currentEventExposure + stake)} / tavan: ${fmt(cap)}\n` +
      `Onerilen tutar: ${fmt(stake)}\n` +
      `Bakiye: ${fmt(paperState.balance)}`
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

    if (paperState.positions[key]) {
      // Zaten acik: boyut giriste sabitlenir, fiyat dalgalanmasiyla tekrar
      // hesaplanmaz. Sadece son fiyati guncelle (kapanista kullanilacak).
      paperState.positions[key].lastPrice = position.curPrice;
      continue;
    }

    const bankroll = computeBankroll(paperState);
    const currentEventExposure = eventExposure(paperState, position.eventSlug);
    const suggestion = suggestedStake({
      title: position.title,
      price: position.curPrice,
      bankroll,
      currentEventExposure,
    });

    if (suggestion.stake <= 0) continue; // map_number veya olay tavani - sessizce atla

    await openPosition(paperState, wallet, position, suggestion);
  }

  for (const key of Object.keys(paperState.positions)) {
    if (!seenKeys.has(key)) {
      await closePosition(paperState, wallet, key, paperState.positions[key]);
    }
  }
}
