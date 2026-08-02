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

function profileUrl(wallet) {
  return `https://polymarket.com/@${wallet.label}`;
}

function notificationButtons(wallet, eventSlug, slug) {
  return [
    { text: "Polymarket'te Ac", url: polymarketUrl(eventSlug, slug) },
    { text: `${wallet.label} Profili`, url: profileUrl(wallet) },
  ];
}

// Kazanan pozisyonlar cogunlukla hizlica redeem edildigi icin `redeemable:true`
// durumunu hic yakalayamadan positions API'sinden kayboluyor - sadece bu
// endpoint'e bakmak "kazandi, hizli redeem edildi" ile "sattı" (panik) ayirt
// edemiyor. Gamma'dan marketin gercekten kapanip kapanmadigini sormak daha
// guvenilir: market hala acik gorunuyorsa (closed:false) ve pozisyon yine de
// kayboldu ise, gercekten satmis olma ihtimali yuksek.
async function isMarketClosed(slug) {
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets/slug/${slug}`);
    if (!res.ok) return null;
    const market = await res.json();
    return Boolean(market.closed);
  } catch {
    return null;
  }
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

// Ayni conditionId'de zaten takip ettigimiz baska bir outcome (kars taraf)
// var mi diye bakar - varsa bu yeni bacak bagimsiz bir bahis degil, mevcut
// pozisyonun hedge'idir.
function findHedgeLeg(paperState, position) {
  const prefix = `${position.conditionId}:`;
  for (const [key, existingLeg] of Object.entries(paperState.positions)) {
    if (key !== positionKey(position) && key.startsWith(prefix)) {
      return { key, existingLeg, existingOutcomeIndex: Number(key.split(":")[1]) };
    }
  }
  return null;
}

function findRealLeg(positions, conditionId, outcomeIndex) {
  return positions.find((p) => p.conditionId === conditionId && p.outcomeIndex === outcomeIndex);
}

// Sanal takip (bankroll/olay tavani hesabi icin) her zaman sessizce calisir.
// Telegram bildirimi sadece uc durumda gider: gercek giris 500$ ustundeyse,
// onerilen tutar arttiysa, veya trader panik yapip satarsa.
async function openPosition(paperState, wallet, position, suggestion) {
  const { stake, marketType, band, cap, currentEventExposure } = suggestion;
  const key = positionKey(position);
  const size = stake / position.curPrice;

  const entryNotified = position.initialValue > ENTRY_NOTIFY_THRESHOLD;
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
    entryNotified,
  };

  if (!entryNotified) return; // sessiz - sadece sanal takip (henuz 500$ altinda)

  await sendTelegramMessage(
    `📝 <b>${wallet.label}</b> Yeni giris (${fmt(position.initialValue)})\n` +
      `[TÜR: ${marketType}] [BANT: ${band}]\n` +
      `${position.title} — ${position.outcome}\n` +
      `Fiyat: ${(position.curPrice * 100).toFixed(1)}c\n` +
      `Olay: ${position.eventSlug} — maruziyet: ${fmt(currentEventExposure + stake)} / tavan: ${fmt(cap)}\n` +
      `Onerilen tutar: ${fmt(stake)}`,
    { buttons: notificationButtons(wallet, position.eventSlug, position.slug) }
  );
}

// Hedge: trader'in ayni conditionId'deki karsi tarafa girisi. Yeni bagimsiz
// bir sinyal degil, mevcut pozisyonu ayarlama - boyutu trader'in iki
// bacaktaki gercek oranina gore, bizim mevcut payimizin uzerinden hesaplanir.
async function openHedgePosition(paperState, wallet, position, hedge, hedgeRatio) {
  const hedgeStake = hedge.existingLeg.stake * hedgeRatio;
  if (hedgeStake < 1) return; // ihmal edilebilir kadar kucuk, sessizce atla

  if (paperState.balance < hedgeStake) {
    await sendTelegramMessage(
      `⚠️ <b>${wallet.label}</b> Hedge icin bakiye yetersiz — ${position.title} (${position.outcome}) icin ${fmt(
        hedgeStake
      )} gerekiyordu.`
    );
    return;
  }

  const key = positionKey(position);
  const size = hedgeStake / position.curPrice;
  paperState.balance -= hedgeStake;
  paperState.positions[key] = {
    title: position.title,
    outcome: position.outcome,
    slug: position.slug,
    eventSlug: position.eventSlug,
    stake: hedgeStake,
    entryPrice: position.curPrice,
    size,
    lastPrice: position.curPrice,
    lastNotifiedAmount: hedgeStake,
    entryNotified: true,
    isHedge: true,
  };

  await sendTelegramMessage(
    `🔀 <b>${wallet.label}</b> HEDGE tespit edildi\n` +
      `${position.title}\n` +
      `Var olan: ${hedge.existingLeg.outcome} (${fmt(hedge.existingLeg.stake)})\n` +
      `Hedge: ${position.outcome} (${fmt(hedgeStake)}) @ ${(position.curPrice * 100).toFixed(1)}c\n` +
      `Trader'in hedge orani: ${(hedgeRatio * 100).toFixed(1)}%`,
    { buttons: notificationButtons(wallet, position.eventSlug, position.slug) }
  );
}

// Pozisyon ilk goruldugunde 500$ altinda olup sonradan buyumus olabilir -
// boyle bir durumda "gec giris" bildirimi gonderilir.
async function notifyLateEntry(wallet, existing, position) {
  await sendTelegramMessage(
    `📝 <b>${wallet.label}</b> Giris tutari 500$'i gecti (${fmt(position.initialValue)})\n` +
      `${existing.title} — ${existing.outcome}\n` +
      `Fiyat: ${(position.curPrice * 100).toFixed(1)}c\n` +
      `Bizim payimiz: ${fmt(existing.stake)}`,
    { buttons: notificationButtons(wallet, existing.eventSlug, existing.slug) }
  );
}

async function notifySuggestionIncrease(wallet, existing, newAmount) {
  await sendTelegramMessage(
    `📈 <b>${wallet.label}</b> Onerilen tutar artti\n${existing.title} — ${existing.outcome}\n` +
      `${fmt(existing.lastNotifiedAmount)} → ${fmt(newAmount)}`,
    { buttons: notificationButtons(wallet, existing.eventSlug, existing.slug) }
  );
}

async function notifyHedgeIncrease(wallet, existing, siblingLeg, topUp, hedgeRatio) {
  await sendTelegramMessage(
    `🔀📈 <b>${wallet.label}</b> HEDGE buyudu\n${existing.title} — ${existing.outcome}\n` +
      `+${fmt(topUp)} (yeni toplam: ${fmt(existing.stake)})\n` +
      `Trader'in guncel hedge orani: ${(hedgeRatio * 100).toFixed(1)}% (${siblingLeg.outcome} tarafina gore)`,
    { buttons: notificationButtons(wallet, existing.eventSlug, existing.slug) }
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
    { buttons: notificationButtons(wallet, existing.eventSlug, existing.slug) }
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
      const hedge = findHedgeLeg(paperState, position);
      if (hedge) {
        const realExistingLeg = findRealLeg(positions, position.conditionId, hedge.existingOutcomeIndex);
        // Sadece YENI bacak kucuk olan (yani gercek hedge) ise oranla boyutlandir.
        // Yeni bacak buyukse bu bir hedge degil, asil pozisyondur - normal
        // fiyat-bandi akisina birak (oran>1 ile sisirmek yanlis olurdu).
        if (
          realExistingLeg &&
          realExistingLeg.initialValue > 0 &&
          position.initialValue < realExistingLeg.initialValue
        ) {
          const hedgeRatio = position.initialValue / realExistingLeg.initialValue;
          await openHedgePosition(paperState, wallet, position, hedge, hedgeRatio);
          continue;
        }
      }

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

    if (!existing.entryNotified && position.initialValue > ENTRY_NOTIFY_THRESHOLD) {
      await notifyLateEntry(wallet, existing, position);
      existing.entryNotified = true;
    } else if (existing.entryNotified === undefined) {
      existing.entryNotified = position.initialValue > ENTRY_NOTIFY_THRESHOLD;
    }

    // Kars taraf (hedge) hala aciksa: hedge iliskisi SIMETRIK DEGILDIR.
    // Buyuk bacak = trader'in asil pozisyonu, kucuk bacak = onun hedge'i.
    // Oran SADECE kucuk (hedge) bacaga uygulanir; ana bacak kendi fiyat-bandi
    // boyutunda kalir. Simetrik uygulamak ana pozisyonu oran>1 ile sisirir.
    const sibling = findHedgeLeg(paperState, position);
    if (sibling) {
      const realSibling = findRealLeg(positions, position.conditionId, sibling.existingOutcomeIndex);
      if (realSibling && realSibling.initialValue > 0 && position.initialValue > 0) {
        const isHedgeLeg = position.initialValue < realSibling.initialValue;

        if (isHedgeLeg) {
          const currentRatio = position.initialValue / realSibling.initialValue; // daima < 1
          // Hedge hicbir kosulda ana bacagin payini asamaz.
          const targetStake = Math.min(
            sibling.existingLeg.stake * currentRatio,
            sibling.existingLeg.stake
          );
          const topUp = targetStake - existing.stake;

          if (targetStake > existing.stake * 1.05 && topUp >= 1 && paperState.balance >= topUp) {
            paperState.balance -= topUp;
            existing.size += topUp / position.curPrice;
            existing.stake = targetStake;
            await notifyHedgeIncrease(wallet, existing, sibling.existingLeg, topUp, currentRatio);
          }
          existing.isHedge = true;
          continue;
        }

        // Ana bacak: hedge mantigi boyutunu DEGISTIRMEZ, normal akisa devam.
        existing.isHedge = false;
      }
    }

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
    const existing = paperState.positions[key];

    // Son bilinen fiyat zaten 0c veya 100c'ye çok yakinsa, bu fiyat tek
    // basina cozulmus (kazanmis/kaybetmis) oldugunun guclu kaniti - Gamma'ya
    // sormaya bile gerek yok, panik satis kategorisine hic girmez.
    const nearResolved = existing.lastPrice >= 0.98 || existing.lastPrice <= 0.02;
    const closed = nearResolved ? true : await isMarketClosed(existing.slug);

    // Sadece marketin KESIN olarak hala acik oldugunu biliyorsak (closed:false)
    // panik satis say. Bilinmiyorsa (API hatasi) veya kapandiysa (normal
    // cozum, kazanmis olabilir) sessiz kal - yanlis alarm vermemek daha onemli.
    await closePosition(paperState, wallet, key, existing, {
      panicSell: closed === false,
    });
  }
}
