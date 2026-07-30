const ACTIVITY_URL = "https://data-api.polymarket.com/activity";

export async function fetchRecentTrades(address, limit = 25) {
  const url = new URL(ACTIVITY_URL);
  url.searchParams.set("user", address);
  url.searchParams.set("type", "TRADE");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sortBy", "TIMESTAMP");
  url.searchParams.set("sortDirection", "DESC");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Polymarket API hatasi (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
