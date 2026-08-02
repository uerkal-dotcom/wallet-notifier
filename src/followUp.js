import { config } from "./config.js";
import { fetchOpenPositions } from "./positions.js";
import { sendTelegramMessage } from "./telegram.js";

// Olculen sorun: bildirimden sonra medyan 124 dakika gecikmeyle giriliyor ve
// islemlerin %82'sinde trader'in fiyatindan pahaliya girilmis. Bu modul iki
// sey yapar - hicbiri islem ACMAZ:
//   1) Takip hatirlatmasi: sinyal verildi, kendi cuzdanimda hala yok -> durt.
//   2) Slipaj korumasi: fiyat sinyal aninden cok kaydiysa "girme" de.

function fmt(n) {
  return `$${Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 2 })}`;
}

function buttons(wallet, existing) {
  return [
    {
      text: "Polymarket'te Ac",
      url: `https://polymarket.com/event/${existing.eventSlug || existing.slug}`,
    },
    { text: `${wallet.label} Profili`, url: `https://polymarket.com/@${wallet.label}` },
  ];
}

// Kendi cuzdanimdaki acik pozisyonlarin "conditionId:outcomeIndex" kumesi.
async function fetchMyPositionKeys() {
  const positions = await fetchOpenPositions(config.myWallet);
  return new Set(positions.map((p) => `${p.conditionId}:${p.outcomeIndex}`));
}

export async function checkFollowUps(paperState, wallet) {
  if (!config.myWallet) return;

  let myKeys;
  try {
    myKeys = await fetchMyPositionKeys();
  } catch (err) {
    console.error("[takip] kendi pozisyonlarim cekilemedi:", err.message);
    return;
  }

  const now = Date.now();

  for (const [key, pos] of Object.entries(paperState.positions)) {
    // Sadece gercekten bildirdigimiz, aksiyon beklenen pozisyonlar
    if (!pos.entryNotified || !pos.notifiedAt) continue;
    if (myKeys.has(key)) {
      // Girmisim - bu pozisyon icin isimiz bitti
      pos.followUpDone = true;
      continue;
    }
    if (pos.followUpDone) continue;

    const minutesSince = (now - pos.notifiedAt) / 60000;
    if (minutesSince < config.reminderAfterMinutes) continue;

    // Cok eskimis sinyal: fiyat coktan kaymis, mac baslamis olabilir.
    // Hatirlatmanin degeri kalmadi - sessizce kapat.
    if (minutesSince > config.staleAfterMinutes) {
      pos.followUpDone = true;
      continue;
    }

    // Sinyal anindaki fiyattan ne kadar kaydi?
    const signalPrice = pos.entryPrice;
    const nowPrice = pos.lastPrice;
    const slippagePct = ((nowPrice - signalPrice) / signalPrice) * 100;

    if (slippagePct > config.maxSlippagePct) {
      await sendTelegramMessage(
        `🛑 <b>${wallet.label}</b> GIRME — fiyat cok kaydi\n${pos.title} — ${pos.outcome}\n` +
          `Sinyal: ${(signalPrice * 100).toFixed(1)}c → Simdi: ${(nowPrice * 100).toFixed(1)}c ` +
          `(+%${slippagePct.toFixed(1)})\n` +
          `Bu fiyattan girisin beklenen getirisi sinyaldekinin cok altinda.`,
        { buttons: buttons(wallet, pos) }
      );
      pos.followUpDone = true; // bir kez soyle, birak
      continue;
    }

    await sendTelegramMessage(
      `⏰ <b>${wallet.label}</b> Hala girmedin (${minutesSince.toFixed(0)} dk gecti)\n` +
        `${pos.title} — ${pos.outcome}\n` +
        `Sinyal: ${(signalPrice * 100).toFixed(1)}c → Simdi: ${(nowPrice * 100).toFixed(1)}c ` +
        `(${slippagePct >= 0 ? "+" : ""}%${slippagePct.toFixed(1)})\n` +
        `Onerilen tutar: ${fmt(pos.stake)}`,
      { buttons: buttons(wallet, pos) }
    );
    pos.followUpDone = true; // tek hatirlatma yeterli, spam yapma
  }
}
