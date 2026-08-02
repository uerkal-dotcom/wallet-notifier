// Boyutlandirma kurallari TRADER'A OZELDIR - piyasaya genel degil.
// wallet-analytics'teki ham (satir bazli, cozulmus pozisyon) analiz iki
// trader'in neredeyse ters profile sahip oldugunu gosterdi:
//
//   Bant        joblessfinalboss     skyman44
//   0.00-0.30   n=65   +%40.3        n=89  -%0.7
//   0.30-0.60   n=590  +%18.9        n=555 +%9.9
//   0.60-0.75   n=214  +%11.9        n=207 -%11.4   <- zit
//   0.75-0.90   n=64   -%14.6        n=44  +%22.8   <- zit
//   0.90-1.00   n=4    +%10.0        n=8   +%5.7
//
// Bu yuzden ayni kural setini ikisine birden uygulamak zarar ettirir.

const EVENT_CAP_FRACTION = 0.125; // kasa'nin %10-15 araliginin ortasi
const MIN_STAKE = 1; // bu tutarin altindaki oneriler atlanir

export function classifyMarketType(title) {
  if (/handicap/i.test(title)) return "map_handicap";
  if (/map \d+ winner/i.test(title)) return "map_number";
  if (/^will .+ win /i.test(title)) return "tournament_winner";
  if (/total/i.test(title)) return "totals";
  return "match_winner";
}

const RULE_SETS = {
  skyman44: {
    // <$500 kumesi: ham ROI +%13.2 gorunuyor ama en buyuk 3 kazanc toplam
    // karin %92'si; uc degerler ayiklaninca -%3.8'e duşuyor, medyan +$7.
    // Yani sinyal degil gurultu - bu tutarin altina hic girilmiyor.
    minEntry: 500,
    tournamentFixed: 4,
    // map_number: n=60, -%18.9 - net kaybeden kategori
    skipType: (type) => type === "map_number",
    band: (p) => {
      if (p >= 0.75 && p <= 0.9) return { label: "0.75-0.90", rate: 0.035 }; // n=44, +%22.8
      if (p > 0.9) return { label: "0.90-1.00", rate: 0.01 }; // n=8, zayif ornek
      if (p >= 0.6) return { label: "0.60-0.75", rate: 0 }; // n=207, -%11.4 -> atla
      if (p >= 0.3) return { label: "0.30-0.60", rate: 0.025 }; // n=447, ~+%15
      return { label: "0.00-0.30", rate: 0.0075 }; // n=85, gurultulu
    },
  },
  joblessfinalboss: {
    // Onda esik daha yukarida olmali: <$500 kumesi uc degerler cikinca
    // -%7.3 (medyan -$0.03, isabet %49.5 = yazi tura) ve $500-$1.000
    // dilimi -%20.2 (n=120). Sinyal ancak $1.000 ustunde basliyor.
    minEntry: 1000,
    tournamentFixed: 3, // n=12, +%0.85 ~ sifir: sadece takip amacli kucuk tutar
    // map_number geneli +%3.5 (n=288) - skyman44'un aksine atlanmiyor.
    // Ama 0.30 altindaki map_number'lari cok kotu: n=10, -%79.6
    skipType: (type, price) => type === "map_number" && price < 0.3,
    band: (p) => {
      if (p >= 0.75 && p <= 0.9) return { label: "0.75-0.90", rate: 0 }; // n=64, -%14.6 -> atla
      if (p > 0.9) return { label: "0.90-1.00", rate: 0.01 }; // n=4, zayif ornek
      if (p >= 0.6) return { label: "0.60-0.75", rate: 0.02 }; // n=214, +%11.9
      if (p >= 0.3) return { label: "0.30-0.60", rate: 0.035 }; // n=590, +%18.9 (ana bant)
      return { label: "0.00-0.30", rate: 0.02 }; // n=65, +%40.3 ama isabet %21.5 (yuksek varyans)
    },
  },
};

export function rulesFor(traderLabel) {
  return RULE_SETS[String(traderLabel || "").toLowerCase()] || null;
}

// trader: kural setini secen etiket (ör. "skyman44"). Tanimli degilse
// sessizce atlanir - yanlis kural setiyle boyutlandirmaktansa hic onerme.
export function suggestedStake({ title, price, bankroll, currentEventExposure, trader }) {
  const rules = rulesFor(trader);
  const marketType = classifyMarketType(title);

  if (!rules) {
    return { marketType, band: "-", stake: 0, skippedReason: `'${trader}' icin kural seti tanimli degil` };
  }

  const { label: band, rate } = rules.band(price);

  if (rules.skipType(marketType, price)) {
    return { marketType, band, stake: 0, skippedReason: `${marketType}: bu trader icin kaybeden kategori` };
  }

  if (marketType !== "tournament_winner" && rate === 0) {
    return { marketType, band, stake: 0, skippedReason: `${band} bandi: bu trader icin negatif ROI, atlaniyor` };
  }

  let stake =
    marketType === "tournament_winner"
      ? Math.min(rules.tournamentFixed, bankroll * 0.01)
      : bankroll * rate;

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
