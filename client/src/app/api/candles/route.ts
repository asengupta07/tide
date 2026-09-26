import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Supported USD candles from Coinbase Exchange (public, no key), proxied for the terminal. */
let cache: { at: number; key: string; body: unknown } | null = null;

export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  const g = query.get("granularity") ?? "3600";
  const product = query.get("product") ?? "ETH-USD";
  if (!["300", "900", "3600", "21600", "86400"].includes(g)) return NextResponse.json({ error: "granularity" }, { status: 400 });
  if (!["ETH-USD", "LINK-USD"].includes(product)) return NextResponse.json({ error: "market feed unavailable" }, { status: 400 });
  const key = `${product}:${g}`;
  if (cache && cache.key === key && Date.now() - cache.at < 60_000) return NextResponse.json(cache.body);
  const r = await fetch(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=${g}`, { cache: "no-store" });
  if (!r.ok) return NextResponse.json({ error: `price feed ${r.status}` }, { status: 502 });
  const rows = (await r.json()) as number[][]; // [time, low, high, open, close, volume]
  const candles = rows.sort((a, b) => a[0] - b[0]).map(([time, low, high, open, close, volume]) => ({ time, open, high, low, close, volume }));
  cache = { at: Date.now(), key, body: candles };
  return NextResponse.json(candles);
}
