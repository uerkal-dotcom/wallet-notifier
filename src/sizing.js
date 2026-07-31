// wallet-analytics raporundaki geriye donuk analize dayanan boyutlandirma
// kurallari: boyut trader'in yatirdigi tutara degil, fiyat bandina ve market
// tipine gore belirlenir (bkz. polymarket-sizing-modulu.md).

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
  return "0.00-0.75";
}

function baseSizeForPrice(price, bankroll) {
  // 0.00-0.75 tek bant birakildi: elimizde sadece bandin TOPLAM kar rakami
  // var, islem bazli dagilim yok - 0.00-0.40 ile 0.40-0.75'i ayri oranlarla
  // ayirmak ozetin ozetini almak olurdu (bkz. sizing modulu bolum 8).
  if (price >= 0.75 && price <= 0.9) return bankroll * 0.035; // guclu kanitli bant (~%97.6 isabet, n=42)
  if (price > 0.9) return bankroll * 0.01; // buyuk pozisyon ama dolar-basina zayif getiri, n=6 zayif ornek
  return bankroll * 0.015; // 0.00-0.75 flat oran
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

  let stake =
    marketType === "tournament_winner"
      ? Math.min(TOURNAMENT_FIXED_STAKE, bankroll * 0.01)
      : baseSizeForPrice(price, bankroll);

  const cap = bankroll * EVENT_CAP_FRACTION;
  const remainingCap = Math.max(0, cap - currentEventExposure);
  const cappedByEvent = stake > remainingCap;
  if (cappedByEvent) stake = remainingCap;

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
