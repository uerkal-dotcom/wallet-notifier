import { fetchOpenPositions } from "./positions.js";
import { sendTelegramMessage } from "./telegram.js";
import { suggestedStake } from "./sizing.js";

const ENTRY_NOTIFY_THRESHOLD = 500; // sadece bunun ustundeki gercek girisler bildirilir

function fmt(n) {
  return `$${Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

function positionKey(position) {
  return `${position.conditionId}:${position.outcomeIndex}`;
}

function polymarketUrl(eventSlug, slug) {
  return `https://polymarket.com/event/${eventSlug || slug}`;
}

function computeBankroll(paperState) {
  const staked = Object.values(paperState.positions).reduce((s, p) => s + p.stake, 0);
  return paperState.balance + staked;
}

function eventExposure(paperState, eventSlug, excludeKey) {
  return Object.entries(paperState.positions)
    .filter(([key, p]) => key !== excludeKey && p.eventSlug === eventSlug)
    .reduce((s, [, p]) => s + p.stake, 0);
}

// Sanal takip (bankroll/olay tavani hesabi icin) her zaman sessizce calisir.
// Telegram bildirimi sadece uc durumda gider: gercek giris 500$ ustundeyse,
// onerilen tutar arttiysa, veya trader panik yapip satarsa.
async function openPosition(paperState, wallet, position, suggestion) {
  const { stake, marketType, band, cap, currentEventExposure } = suggestion;
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
    lastNotifiedAmount: stake,
  };

  if (position.initialValue <= ENTRY_NOTIFY_THRESHOLD) return; // sessiz - sadece sanal takip

  await sendTelegramMessage(
    `📝 <b>${wallet.label}</b> Yeni giris (${fmt(position.initialValue)})\n` +
      `[TÜR: ${marketType}] [BANT: ${band}]\n` +
      `${position.title} — ${position.outcome}\n` +
      `Fiyat: ${(position.curPrice * 100).toFixed(1)}c\n` +
      `Olay: ${position.eventSlug} — maruziyet: ${fmt(currentEventExposure + stake)} / tavan: ${fmt(cap)}\n` +
      `Onerilen tutar: ${fmt(stake)}`,
    { buttonUrl: polymarketUrl(position.eventSlug, position.slug) }
  );
}

async function notifySuggestionIncrease(wallet, existing, newAmount) {
  await sendTelegramMessage(
    `📈 <b>${wallet.label}</b> Onerilen tutar artti\n${existing.title} — ${existing.outcome}\n` +
      `${fmt(existing.lastNotifiedAmount)} → ${fmt(newAmount)}`,
    { buttonUrl: polymarketUrl(existing.eventSlug, existing.slug) }
  );
}

async function closePosition(paperState, wallet, key, existing, { panicSell }) {
  const proceeds = existing.size * existing.lastPrice;
  const realized = proceeds - existing.stake;

  paperState.balance += proceeds;
  paperState.realizedPnl += realized;
  delete paperState.positions[key];

  if (!panicSell) return; // normal cozum - sessiz, sadece sanal takip guncellenir

  await sendTelegramMessage(
    `🚨 <b>${wallet.label}</b> PANIK SATIS suphesi\n${existing.title} — ${existing.outcome}\n` +
      `Pozisyon cozulmeden ortadan kayboldu - trader muhtemelen sattı.\n` +
      `Son bilinen fiyat: ${(existing.lastPrice * 100).toFixed(1)}c`,
    { buttonUrl: polymarketUrl(existing.eventSlug, existing.slug) }
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
    const existing = paperState.positions[key];

    if (!existing) {
      const bankroll = computeBankroll(paperState);
      const currentEventExposure = eventExposure(paperState, position.eventSlug);
      const suggestion = suggestedStake({
        title: position.title,
        price: position.curPrice,
        bankroll,
        currentEventExposure,
      });

      if (suggestion.stake <= 0) continue; // map_number veya olay tavani - sanal takibe bile girmiyor

      await openPosition(paperState, wallet, position, suggestion);
      continue;
    }

    existing.lastPrice = position.curPrice;

    // Boyut sabit kalir ama "onerilen tutar" arttiysa kullaniciya bildir
    // (kasa buyudukce veya olay tavaninda yer acildikca artabilir).
    const bankroll = computeBankroll(paperState);
    const currentEventExposure = eventExposure(paperState, position.eventSlug, key);
    const freshSuggestion = suggestedStake({
      title: existing.title,
      price: existing.entryPrice,
      bankroll,
      currentEventExposure,
    });

    const lastNotifiedAmount = existing.lastNotifiedAmount ?? existing.stake;
    if (freshSuggestion.stake > lastNotifiedAmount) {
      await notifySuggestionIncrease(wallet, existing, freshSuggestion.stake);
      existing.lastNotifiedAmount = freshSuggestion.stake;
    } else if (existing.lastNotifiedAmount === undefined) {
      existing.lastNotifiedAmount = lastNotifiedAmount;
    }
  }

  for (const key of Object.keys(paperState.positions)) {
    if (seenKeys.has(key)) continue;
    // Pozisyon hala redeemable=true olarak (cozulmus ama redeem edilmemis)
    // allPositions icinde goruluyorsa normal cozum demektir. Hic gorunmuyorsa
    // trader'in hisseleri satmis olmasi (panik/erken cikis) daha olasidir.
    const stillResolving = allPositions.some((p) => positionKey(p) === key && p.redeemable);
    await closePosition(paperState, wallet, key, paperState.positions[key], {
      panicSell: !stillResolving,
    });
  }
}
