"use client";

/**
 * ETH/USD candles (Coinbase Exchange, proxied) with this strategy's fills marked on them: a teal arrow where
 * a trader bought ETH from the strategy, a warm one where they sold ETH into it. Dark theme, page tokens.
 */
import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, HistogramSeries, createSeriesMarkers, type IChartApi, type UTCTimestamp, type SeriesMarker, type Time } from "lightweight-charts";
import type { TokenMeta } from "@/lib/tokens";

export type Fill = { block: number; at: number | null; tokenIn: string; amountIn: string; amountOut: string; tx: string };
type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };

const GRAN: Record<string, string> = { "15m": "900", "1h": "3600", "6h": "21600", "1d": "86400" };

export function CandleChart({ fills, baseToken, compact = false }: { fills: Fill[]; baseToken: TokenMeta; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [tf, setTf] = useState<keyof typeof GRAN>("1h");
  const [feed, setFeed] = useState<{ timeframe: string; candles: Candle[] | null; error: string | null } | null>(null);
  const candles = feed?.timeframe === tf ? feed.candles : null;
  const err = feed?.timeframe === tf ? feed.error : null;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/candles?granularity=${GRAN[tf]}&product=${encodeURIComponent(baseToken.usdProduct ?? "")}`, { signal: controller.signal })
      .then(async r => {
        const data = await r.json();
        if (!r.ok || !Array.isArray(data)) throw new Error(data.error || "Could not load candles");
        return data as Candle[];
      })
      .then(data => { if (!controller.signal.aborted) setFeed({ timeframe: tf, candles: data, error: null }); })
      .catch(e => { if (!controller.signal.aborted) setFeed({ timeframe: tf, candles: null, error: e.message }); });
    return () => controller.abort();
  }, [tf, baseToken.usdProduct]);

  useEffect(() => {
    if (!box.current || !candles?.length) return;
    const css = getComputedStyle(document.documentElement);
    const v = (k: string) => css.getPropertyValue(k).trim();
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: v("--fg-3") || "#8a94a3", fontFamily: v("--font-geist-mono") || "ui-monospace, monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", timeVisible: tf !== "1d", secondsVisible: false, rightOffset: 5 },
      crosshair: { vertLine: { color: "rgba(255,255,255,0.18)", labelBackgroundColor: v("--panel-2") || "#182029" }, horzLine: { color: "rgba(255,255,255,0.18)", labelBackgroundColor: v("--panel-2") || "#182029" } },
      handleScroll: { vertTouchDrag: false },
    });
    const accent = v("--accent") || "#58c9b6";
    const bad = v("--bad") || "#e07a6a";
    const series = chart.addSeries(CandlestickSeries, { upColor: accent, downColor: bad, borderVisible: false, wickUpColor: accent, wickDownColor: bad, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
    series.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", color: "rgba(255,255,255,0.08)" });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? "rgba(88,201,182,0.18)" : "rgba(224,122,106,0.18)" })));

    // fills snapped to the candle they landed in
    const step = Number(GRAN[tf]);
    const first = candles[0].time;
    const grouped = new Map<string, { time: UTCTimestamp; boughtEth: boolean; count: number }>();
    for (const fill of fills) {
      if (!fill.at || fill.at < first) continue;
      const boughtBase = fill.tokenIn.toLowerCase() !== baseToken.address.toLowerCase();
      const time = (Math.floor(fill.at / step) * step) as UTCTimestamp;
      const key = `${time}:${boughtBase ? "buy" : "sell"}`;
      const current = grouped.get(key);
      if (current) current.count += 1;
      else grouped.set(key, { time, boughtEth: boughtBase, count: 1 });
    }
    const markers: SeriesMarker<Time>[] = [...grouped.values()]
      .map(({ time, boughtEth, count }) => ({
        time,
        position: boughtEth ? "belowBar" : "aboveBar",
        color: boughtEth ? accent : bad,
        shape: boughtEth ? "arrowUp" : "arrowDown",
        text: count > 1 ? `×${count}` : "",
      }) as SeriesMarker<Time>)
      .sort((a, b) => (a.time as number) - (b.time as number));
    createSeriesMarkers(series, markers);
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [candles, fills, baseToken.address, tf]);

  return (
    <div className="relative">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0 text-sm font-medium">{baseToken.symbol} / USD <span className="text-fg-3">· {fills.length} fills across {new Set(fills.map((fill) => fill.block)).size} blocks</span></div>
        <div className="flex gap-1 rounded-full border border-white/10 p-0.5">
          {(Object.keys(GRAN) as (keyof typeof GRAN)[]).map((k) => (
            <button key={k} onClick={() => setTf(k)} className={`touch-exempt rounded-full px-2.5 py-1 text-[11px] ${tf === k ? "bg-white/[0.08] text-fg" : "text-fg-3 hover:text-fg"}`}>{k}</button>
          ))}
        </div>
      </div>
      <div ref={box} className={`${compact ? "h-[250px]" : "h-[320px]"} w-full min-w-0 overflow-hidden`} />
      {!candles && !err && <div className={`absolute inset-x-0 top-10 ${compact ? "h-[250px]" : "h-[320px]"} animate-pulse rounded-2xl bg-white/[0.03]`} />}
      {candles?.length === 0 && <p className="mt-2 text-xs text-fg-3">No candles available for this timeframe.</p>}
      {err && <div className="mt-2 text-xs text-bad">Price feed unavailable: {err}</div>}
    </div>
  );
}
