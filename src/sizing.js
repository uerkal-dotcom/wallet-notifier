// wallet-analytics raporundaki ham (satir bazli, 873 pozisyon) geriye donuk
// analize dayanan boyutlandirma kurallari: boyut trader'in yatirdigi tutara
// degil, fiyat bandina ve market tipine gore belirlenir.
// Bant sinirlari 0.05'lik ince dilimleme + odeme carpani (1/fiyat) capraz
// kontrolleriyle dogrulandi (bkz. polymarket-sizing-modulu_6.md, bolum 8).

const EVENT_CAP_FRACTION = 0.125; // kasa'nin %10-15 araliginin ortasi
const TOURNAMENT_FIXED_STAKE = 4; // sabit kucuk tutar (3-5$ araliginin ortasi)
const MIN_STAKE = 1; // bu tutarin altindaki oneriler atlanir

export function classifyMarketType(title) {
  if (/map handicap/i.test(title)) return "map_handicap";
  if (/map \d+ winner/i.test(title)) return "map_number";
  if (/^will .+ win /i.test(title)) return "tournament_winner";
  return "match_winner";
}

export function priceBandLabel(price) {
  if (price >= 0.75 && price <= 0.9) return "0.75-0.90";
  if (price > 0.9) return "0.90-1.00";
  if (price >= 0.6 && price < 0.75) return "0.60-0.75 (atlanan)";
  if (price >= 0.3 && price < 0.6) return "0.30-0.60";
  return "0.00-0.30";
}

function baseSizeForPrice(price) {
  if (price >= 0.75 && price <= 0.9) return 0.035; // guclu kanitli bant (~%97.6 isabet, n=42, ROI +%16-24)
  if (price > 0.9) return 0.01; // zayif ama pozitif, n=6 kucuk ornek (ROI +%4-8)
  if (price >= 0.6 && price < 0.75) return 0; // n=195, 3 ayri dilimde tutarli negatif ROI (-%4 ila -%24) - atla
  if (price >= 0.3 && price < 0.6) return 0.025; // n=447, tutarli pozitif (ROI ~%15)
  return 0.0075; // 0.00-0.30: gurultulu/zayif, n=85
}

// title/price/bankroll: pozisyonun bilgileri ve kasa buyuklugu.
// currentEventExposure: bu eventSlug altinda ZATEN acik olan diger
// pozisyonlarin toplam payi (bu pozisyon haric).
export function suggestedStake({ title, price, bankroll, currentEventExposure }) {
  const marketType = classifyMarketType(title);
  const band = priceBandLabel(price);

  if (marketType === "map_number") {
    return { marketType, band, stake: 0, skippedReason: "map_number: gecmis kayip kategorisi" };
  }

  const rate = baseSizeForPrice(price);
  if (marketType !== "tournament_winner" && rate === 0) {
    return { marketType, band, stake: 0, skippedReason: "0.60-0.75 bandi: tutarli negatif ROI (n=195), atlaniyor" };
  }

  let stake =
    marketType === "tournament_winner" ? Math.min(TOURNAMENT_FIXED_STAKE, bankroll * 0.01) : bankroll * rate;

  const cap = bankroll * EVENT_CAP_FRACTION;
  const remainingCap = Math.max(0, cap - currentEventExposure);
  const cappedByEvent = stake > remainingCap;
  if (cappedByEvent) stake = remainingCap;

  // Polymarket'te $9.38 gibi kusuratli tutarlarla giris pratik degil -
  // onerileri tam dolara yuvarla. Tavan asilmasin diye asagi yuvarla,
  // ama tavan sorun degilse en yakina yuvarlamak daha dogru boyut verir.
  stake = cappedByEvent ? Math.floor(stake) : Math.round(stake);

  if (stake < MIN_STAKE) {
    return {
      marketType,
      band,
      stake: 0,
      cap,
      currentEventExposure,
      skippedReason: cappedByEvent ? "olay tavanina ulasildi" : "onerilen tutar minimum esigin altinda",
    };
  }

  return { marketType, band, stake, cap, currentEventExposure, cappedByEvent };
}
