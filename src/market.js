const ACTIVITY_URL = "https://data-api.polymarket.com/activity";

// `limit` sabit kucuk bir pencereyle (ör. son 25 islem) calisirsa, trader
// kisa surede bundan fazla islem yaparsa eski islemler pencereden disari
// itilir ve tekrar pencereye girene kadar (saatlerce) hic gorunmez - bot
// duzenli calissa bile. `start` (zaman damgasi imleci) kullanmak, son
// bilinen noktadan itibaren TUM yeni islemleri garantiler.
export async function fetchRecentTrades(address, { start, limit = 500 } = {}) {
  const url = new URL(ACTIVITY_URL);
  url.searchParams.set("user", address);
  url.searchParams.set("type", "TRADE");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sortBy", "TIMESTAMP");
  url.searchParams.set("sortDirection", "DESC");
  if (start !== undefined) url.searchParams.set("start", String(start));

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Polymarket API hatasi (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
