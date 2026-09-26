/**
 * Realised ETH volatility from public hourly candles (Coinbase Exchange, no key). Annualised standard
 * deviation of hourly log returns over the last ~14 days. Cached for ten minutes.
 */
let cache: { at: number; sigma: number; hours: number; last: number } | undefined;

export async function realisedVolatility(): Promise<{ sigma: number; hours: number; last: number; measuredAt: number }> {
  if (cache && Date.now() - cache.at < 10 * 60_000) return { ...cache, measuredAt: cache.at };
  const res = await fetch("https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=3600", { cache: "no-store" });
  if (!res.ok) throw new Error(`price feed ${res.status}`);
  const candles = (await res.json()) as number[][]; // [time, low, high, open, close, volume]
  const closes = candles.sort((a, b) => a[0] - b[0]).map((c) => c[4]);
  const r = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1);
  const sigma = Math.sqrt(v * 24 * 365);
  cache = { at: Date.now(), sigma, hours: r.length, last: closes[closes.length - 1] };
  return { ...cache, measuredAt: cache.at };
}
