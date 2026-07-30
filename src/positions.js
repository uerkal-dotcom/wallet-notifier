const POSITIONS_URL = "https://data-api.polymarket.com/positions";

export async function fetchOpenPositions(address) {
  const url = new URL(POSITIONS_URL);
  url.searchParams.set("user", address);
  url.searchParams.set("sizeThreshold", "1");
  url.searchParams.set("limit", "500");
  url.searchParams.set("sortBy", "INITIAL");
  url.searchParams.set("sortDirection", "DESC");

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Polymarket API hatasi (${res.status}): ${await res.text()}`);
  }
  return res.json();
}
