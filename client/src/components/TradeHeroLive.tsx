"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChartLineUp, Path, ShieldCheck } from "@phosphor-icons/react";

type Market = {
  name: string;
  market?: { N: number; fee: number; total: { weth: string; usdc: string } } | null;
};

type Quote = {
  route: { strategy: { name: string }; amountOut: string };
  quotes: { strategy: { name: string }; amountOut: string }[];
  sourcesChecked: number;
};

const usdc = (value: string) => Number(BigInt(value)) / 1e6;

export function TradeHeroLive() {
  const reduce = useReducedMotion();
  const [markets, setMarkets] = useState<Market[] | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/strategies?scope=markets&tradable=1", { cache: "no-store", signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error("markets unavailable");
        return r.json() as Promise<Market[]>;
      }),
      fetch("/api/quote/best?amount=10000000000000000&exactIn=1&sellEth=1", { cache: "no-store", signal: controller.signal }).then((r) => {
        if (!r.ok) throw new Error("quote unavailable");
        return r.json() as Promise<Quote>;
      }),
    ])
      .then(([nextMarkets, nextQuote]) => {
        setMarkets(nextMarkets);
        setQuote(nextQuote);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, []);

  const inventory = markets?.reduce((sum, market) => sum + usdc(market.market?.total.usdc ?? "0"), 0) ?? 0;
  const output = quote ? usdc(quote.route.amountOut) : null;

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, transform: "translateY(24px) scale(0.985)" }}
      animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
      transition={{ duration: 0.75, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
      className="relative mx-auto w-full max-w-[36rem] rounded-[1.35rem] bg-white/[0.045] p-1.5 ring-1 ring-white/[0.11]"
    >
      <div className="overflow-hidden rounded-[1rem] bg-[#101720] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <div>
            <div className="text-sm font-medium">WETH / USDC</div>
            <div className="mt-0.5 text-[11px] text-fg-3">Live Tide market</div>
          </div>
          <span className="rounded-full bg-accent/[0.1] px-2.5 py-1 text-[11px] text-accent">Auto-routed</span>
        </div>

        {error ? (
          <div className="p-6 text-sm text-fg-2">Live market data is temporarily unavailable.</div>
        ) : !markets || !quote ? (
          <div className="space-y-3 p-5" aria-label="Loading live Tide market">
            <div className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />
            <div className="h-32 animate-pulse rounded-xl bg-white/[0.03]" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-px bg-white/[0.06]">
              <div className="bg-[#101720] px-5 py-4">
                <div className="text-[11px] text-fg-3">0.01 WETH receives</div>
                <div className="num mt-1 text-2xl font-medium text-fg">{output?.toFixed(2)} <span className="text-sm text-fg-3">USDC</span></div>
              </div>
              <div className="bg-[#101720] px-5 py-4">
                <div className="text-[11px] text-fg-3">Liquidity available</div>
                <div className="num mt-1 text-2xl font-medium text-fg">${inventory.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="mb-3 flex items-center justify-between text-[11px] text-fg-3">
                <span>Route comparison</span>
                <span className="num">{quote.sourcesChecked} LPs quoted</span>
              </div>
              <div className="space-y-1.5">
                {quote.quotes.slice(0, 3).map((route, index) => (
                  <div key={route.strategy.name} className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${index === 0 ? "bg-accent/[0.09]" : "bg-white/[0.025]"}`}>
                    <span className="min-w-0">
                      <span className={`block truncate text-xs ${index === 0 ? "text-fg" : "text-fg-2"}`}>{route.strategy.name}</span>
                      <span className="block text-[10px] text-fg-3">{index === 0 ? "Best executable route" : "Compared live"}</span>
                    </span>
                    <span className={`num ml-4 text-xs ${index === 0 ? "text-accent" : "text-fg-2"}`}>{usdc(route.amountOut).toFixed(2)} USDC</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="grid grid-cols-3 border-t border-white/[0.07] text-center text-[10px] text-fg-3">
          <span className="flex items-center justify-center gap-1.5 px-2 py-3"><Path size={13} className="text-accent" /> Best route</span>
          <span className="flex items-center justify-center gap-1.5 border-x border-white/[0.07] px-2 py-3"><ChartLineUp size={13} className="text-accent" /> Live quote</span>
          <span className="flex items-center justify-center gap-1.5 px-2 py-3"><ShieldCheck size={13} className="text-accent" /> 0.5% limit</span>
        </div>
      </div>
    </motion.div>
  );
}
