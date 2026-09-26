import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** ETH-USD candles from Coinbase Exchange (public, no key), proxied so the browser has no CORS or rate issues. */
let cache: { at: number; key: string; body: unknown } | null = null;

export async function GET(req: Request) {
  const g = new URL(req.url).searchParams.get("granularity") ?? "3600";
  if (!["300", "900", "3600", "21600", "86400"].includes(g)) return NextResponse.json({ error: "granularity" }, { status: 400 });
  if (cache && cache.key === g && Date.now() - cache.at < 60_000) return NextResponse.json(cache.body);
  const r = await fetch(`https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=${g}`, { cache: "no-store" });
  if (!r.ok) return NextResponse.json({ error: `price feed ${r.status}` }, { status: 502 });
  const rows = (await r.json()) as number[][]; // [time, low, high, open, close, volume]
  const candles = rows.sort((a, b) => a[0] - b[0]).map(([time, low, high, open, close, volume]) => ({ time, open, high, low, close, volume }));
  cache = { at: Date.now(), key: g, body: candles };
  return NextResponse.json(candles);
}
