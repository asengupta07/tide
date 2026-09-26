"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowSquareOut, CheckCircle, ChartLineUp } from "@phosphor-icons/react";

import { TradePanel } from "@/components/TradePanel";
import { CandleChart } from "@/components/CandleChart";
import { ImpactCurve } from "@/components/ImpactCurve";
import { Bezel, Nav } from "@/components/ui";
import { isTradeReady } from "@/lib/trade-readiness";
import { short } from "@/lib/chain";
import { marketForTokens, marketKey, type MarketPair, type TokenMeta } from "@/lib/tokens";

type StrategyRow = {
  label: string;
  name: string;
  owner: string;
  tokenA: string;
  tokenB: string;
  salt: string;
  pair: MarketPair | null;
  tokens: { tokenA: TokenMeta; tokenB: TokenMeta };
  records: { lambda: number; N: number; delta: number; fee?: number } | null;
  market?: {
    lambda: number;
    N: number;
    delta: number;
    fee: number;
    total: { tokenA: string; tokenB: string };
  } | null;
};

type TradeSnapshot = {
  strategy: {
    label: string;
    name: string;
    owner: string;
    tokenA: string;
    tokenB: string;
    salt: string;
  };
  records: { lambda: number; N: number; delta: number; fee?: number };
  onchain: { fee: number; owner: string; N: number; lambda: number } | null;
  block: {
    total: { tokenA: string; tokenB: string };
  } | null;
  fills: {
    block: number;
    at: number | null;
    tokenIn: string;
    amountIn: string;
    amountOut: string;
    tx: string;
  }[];
  stale?: boolean;
  error?: string;
};

const units = (value: string | undefined, decimals: number) =>
  value ? Number(BigInt(value)) / 10 ** decimals : 0;

export default function TradeMarketPage() {
  return (
    <Suspense fallback={<TradeShell />}>
      <TradeMarket />
    </Suspense>
  );
}

function TradeMarket() {
  const router = useRouter();
  const query = useSearchParams();
  const requested = query.get("strategy")?.trim() || null;
  const [rows, setRows] = useState<StrategyRow[] | null>(null);
  const [selected, setSelected] = useState("");
  const [routed, setRouted] = useState("");
  const [snapshot, setSnapshot] = useState<TradeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/strategies?scope=markets&tradable=1", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load Tide markets");
        return body as StrategyRow[];
      })
      .then((markets) => {
        if (!alive) return;
        setRows(markets);
        // Every initialized, funded strategy is a market. Publishing controls
        // Explore metadata, not access to public on-chain liquidity.
        const initial = requested
          ?? markets[0]?.name
          ?? "";
        setSelected(initial);
      })
      .catch((cause) => alive && setError((cause as Error).message));
    return () => { alive = false; };
  }, [requested]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    fetch(`/api/state?strategy=${encodeURIComponent(selected)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok || body.error) throw new Error(body.error || "Could not load this strategy");
        if (alive) setError(null);
        return body as TradeSnapshot;
      })
      .then((state) => {
        if (!alive) return;
        if (!isTradeReady(state.strategy.owner, state.onchain, state.block)) {
          setSnapshot(null);
          const fallback = rows?.find(m => m.name !== selected && m.label !== selected);
          if (fallback) {
            setSelected(fallback.name);
            router.replace(`/trade/market?strategy=${encodeURIComponent(fallback.name)}`, { scroll: false });
          } else {
            setError("This strategy is not currently tradable. Its liquidity may be empty or its deployment may be incomplete.");
          }
          return;
        }
        setSnapshot(state);
      })
      .catch((cause) => alive && setError((cause as Error).message));
    return () => { alive = false; };
  }, [selected, refreshToken, rows, router]);

  const choose = useCallback((name: string) => {
    setSelected(name);
    router.replace(`/trade/market?strategy=${encodeURIComponent(name)}`, { scroll: false });
  }, [router]);
  const markRoute = useCallback((name: string) => setRouted(name), []);

  const activeSnapshot = snapshot && (snapshot.strategy.name === selected || snapshot.strategy.label === selected) ? snapshot : null;
  const selectedRow = rows?.find((row) => row.name === selected || row.label === selected);
  const pair = selectedRow?.pair ?? (activeSnapshot ? marketForTokens(activeSnapshot.strategy.tokenA, activeSnapshot.strategy.tokenB) : null);
  const selectedPairKey = pair ? marketKey(pair.base.address, pair.quote.address) : "";
  const marketRows = rows?.filter((row) => marketKey(row.tokenA, row.tokenB) === selectedPairKey) ?? [];
  const availablePairs = [...new Map((rows ?? []).flatMap((row) => row.pair ? [[row.pair.key, row.pair] as const] : [])).values()];
  const totals = activeSnapshot?.block ? {
    tokenA: units(activeSnapshot.block.total.tokenA, selectedRow?.tokens.tokenA.decimals ?? 18),
    tokenB: units(activeSnapshot.block.total.tokenB, selectedRow?.tokens.tokenB.decimals ?? 18),
  } : { tokenA: 0, tokenB: 0 };
  const feeBps = activeSnapshot?.onchain?.fee ?? activeSnapshot?.records.fee ?? 30;

  const sources = marketRows.map((source) => ({
    strategy: source,
    totals: { tokenA: units(source.market?.total.tokenA, source.tokens.tokenA.decimals), tokenB: units(source.market?.total.tokenB, source.tokens.tokenB.decimals) },
    feeBps: source.market?.fee ?? source.records?.fee ?? 30,
    params: {
      lambdaBps: source.market?.lambda ?? source.records?.lambda ?? 0,
      N: source.market?.N ?? source.records?.N ?? 1,
      deltaBps: source.market?.delta ?? source.records?.delta ?? 0,
    },
  }));

  return (
    <>
      <Nav current="trade" />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-10 pt-24 sm:px-6 lg:px-8">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-3">
            <Link href="/trade" aria-label="Back to trade overview" className="touch-exempt flex h-9 w-9 items-center justify-center rounded-full text-fg-3 transition-colors duration-200 hover:bg-white/[0.05] hover:text-fg"><ArrowLeft size={16} /></Link>
            <div>
              <div className="flex items-center gap-2 text-lg font-medium">{pair ? `${pair.base.symbol} / ${pair.quote.symbol}` : "Tide market"} <CheckCircle size={15} className="text-accent" weight="fill" aria-label="Live market" /></div>
              <div className="text-[11px] text-fg-3">Tide routed market / Sepolia</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-fg-3">
            <div className="flex rounded-full border border-white/10 p-0.5" aria-label="Choose market">
              {availablePairs.map((market) => (
                <button key={market.key} type="button" onClick={() => { const first = rows?.find((row) => row.pair?.key === market.key); if (first) choose(first.name); }} className={`touch-exempt rounded-full px-3 py-1 transition-colors ${market.key === pair?.key ? "bg-white/[0.09] text-fg" : "text-fg-3 hover:text-fg"}`}>
                  {market.base.symbol}/{market.quote.symbol}
                </button>
              ))}
            </div>
            <span><strong className="num mr-1.5 font-normal text-fg-2">{marketRows.length}</strong>liquidity sources</span>
            <span><strong className="num mr-1.5 font-normal text-fg-2">0.5%</strong>maximum price movement</span>
          </div>
        </header>

        {error && <div className="mb-3 rounded-xl bg-bad/[0.08] p-4 text-sm text-bad ring-1 ring-bad/25" role="alert">{error}</div>}
        {!error && selected && activeSnapshot === null && <div className="h-[44rem] animate-pulse rounded-xl bg-white/[0.035]" aria-label="Loading market terminal" />}

        {activeSnapshot && (
          <div className="grid items-start gap-3 xl:grid-cols-[15.5rem_minmax(32rem,1fr)_22rem]">
            <Bezel small className="order-3 min-w-0 xl:order-1 xl:sticky xl:top-24">
              <aside aria-label="Tide liquidity routes">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <div><h2 className="text-xs font-medium">Liquidity routes</h2><p className="mt-0.5 text-[10px] text-fg-3">Click to inspect</p></div>
                  <span className="num text-[10px] text-fg-3">{marketRows.length} sources</span>
                </div>
                <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-1.5 [scrollbar-width:thin]">
                  {marketRows.map((market) => {
                    const viewing = market.name === selected;
                    const best = market.name === routed;
                    const params = market.market ?? market.records;
                    const amountA = units(market.market?.total.tokenA, market.tokens.tokenA.decimals);
                    const amountB = units(market.market?.total.tokenB, market.tokens.tokenB.decimals);
                    return (
                      <button key={market.name} type="button" onClick={() => choose(market.name)} aria-pressed={viewing} aria-label={`Inspect ${market.name}${best ? ", current best route" : ""}`} className={`touch-exempt w-full rounded-lg px-3 py-3 text-left transition-colors duration-200 ${best ? "bg-accent/[0.09]" : viewing ? "bg-white/[0.055]" : "hover:bg-white/[0.035]"}`}>
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0"><span className="num block truncate text-[11px] text-fg-2">{market.name}</span><span className="num mt-1 block text-[10px] text-fg-3">{formatToken(amountA, market.tokens.tokenA)} / {formatToken(amountB, market.tokens.tokenB)}</span></span>
                          <span className={`num shrink-0 text-xs ${best ? "text-accent" : "text-fg-2"}`}>{params ? `${params.N}× lower impact` : "-"}</span>
                        </span>
                        <span className="mt-2 flex items-center justify-between text-[10px] text-fg-3"><span>{best ? "Best price" : viewing ? "Viewing" : short(market.owner)}</span><span className="num">{params ? `${params.lambda / 100}% available` : "-"}</span></span>
                      </button>
                    );
                  })}
                </div>
              </aside>
            </Bezel>

            <div className="order-2 min-w-0 space-y-3">
              <Bezel small>
                <section className="min-w-0 overflow-hidden p-4" aria-label="Price chart">
                  {pair && <CandleChart fills={activeSnapshot.fills} baseToken={pair.base} compact />}
                </section>
              </Bezel>

              <div className="grid gap-3 lg:grid-cols-2">
                <Bezel small>
                  <section className="p-4" aria-label="Price impact">
                    <div className="flex items-baseline justify-between gap-2"><h2 className="text-xs font-medium">Price impact for {pair?.base.symbol} → {pair?.quote.symbol}</h2><span className="text-[10px] text-fg-3">current liquidity</span></div>
                    <div className="mt-3"><ImpactCurve totalIn={pair ? balanceFor(totals, activeSnapshot.strategy, pair.base.address) : 0} totalOut={pair ? balanceFor(totals, activeSnapshot.strategy, pair.quote.address) : 0} lambda={activeSnapshot.records.lambda / 10_000} N={activeSnapshot.records.N} deltaBps={activeSnapshot.records.delta} /></div>
                  </section>
                </Bezel>
                <Bezel small>
                  {pair && <RecentFills fills={activeSnapshot.fills} pair={pair} />}
                </Bezel>
              </div>
            </div>

            <div className="order-1 min-w-0 space-y-3 xl:order-3 xl:sticky xl:top-24">
              <Bezel small>
                <div className="border-b border-line px-4 py-3">
                  <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-medium">Your order</div><div className="mt-0.5 text-[10px] text-fg-3">Best live price across {marketRows.length} liquidity sources</div></div><ChartLineUp size={16} className="text-accent" /></div>
                </div>
                {pair && <TradePanel strategy={activeSnapshot.strategy} totals={totals} feeBps={feeBps} mode="trade" compact pair={pair} sources={sources} onRoute={markRoute} onFilled={() => setRefreshToken((value) => value + 1)} />}
              </Bezel>
              <Bezel small>
                <div className="grid grid-cols-3 divide-x divide-line">
                  <MarketFact value={`${activeSnapshot.records.N}×`} label="lower price impact" />
                  <MarketFact value={`${activeSnapshot.records.delta / 100}%`} label="price-move range" />
                  <MarketFact value={`${activeSnapshot.records.lambda / 100}%`} label="available each block" />
                </div>
              </Bezel>
              <p className="px-2 text-[10px] leading-relaxed text-fg-3">Charts show the selected liquidity source. Your order still uses whichever Tide source gives you the most.</p>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function MarketFact({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-3 py-3 text-center">
      <div className="num text-sm font-medium text-fg">{value}</div>
      <div className="mt-0.5 text-[9px] text-fg-3">{label}</div>
    </div>
  );
}

function RecentFills({ fills, pair }: { fills: TradeSnapshot["fills"]; pair: MarketPair }) {
  const recent = fills.slice(-6).reverse();
  return (
    <section className="p-4" aria-label="Recent fills">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-medium">Recent fills</h2><span className="num text-[10px] text-fg-3">{fills.length} total</span></div>
      {recent.length === 0 ? <p className="py-10 text-center text-xs text-fg-3">No fills for this LP yet.</p> : (
        <div className="overflow-hidden">
          <div className="grid grid-cols-[3.5rem_1fr_4.5rem_1.5rem] gap-2 pb-2 text-[9px] text-fg-3"><span>Side</span><span>Size</span><span className="text-right">Block</span><span /></div>
          {recent.map((fill) => {
            const sellsBase = fill.tokenIn.toLowerCase() === pair.base.address.toLowerCase();
            const input = sellsBase ? pair.base : pair.quote;
            const amount = units(fill.amountIn, input.decimals);
            const size = amount > 0 && amount < 0.000001
              ? "<0.000001"
              : amount.toLocaleString(undefined, { maximumFractionDigits: input.decimals > 6 ? 6 : 2 });
            return (
              <div key={fill.tx} className="grid grid-cols-[3.5rem_1fr_4.5rem_1.5rem] items-center gap-2 border-t border-white/[0.055] py-2 text-[10px]">
                <span className={sellsBase ? "text-bad" : "text-accent"}>{sellsBase ? "Sell" : "Buy"}</span>
                <span className="num truncate text-fg-2">{size} {input.symbol}</span>
                <span className="num text-right text-fg-3">{fill.block}</span>
                <a href={`https://sepolia.etherscan.io/tx/${fill.tx}`} aria-label="Open fill receipt" className="text-fg-3 transition-colors hover:text-accent"><ArrowSquareOut size={12} /></a>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function balanceFor(totals: { tokenA: number; tokenB: number }, strategy: { tokenA: string }, token: string) {
  return token.toLowerCase() === strategy.tokenA.toLowerCase() ? totals.tokenA : totals.tokenB;
}

function formatToken(value: number, token: TokenMeta) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: token.decimals > 6 ? 4 : 0 })} ${token.symbol}`;
}

function TradeShell() {
  return (
    <>
      <Nav current="trade" />
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 pb-10 pt-24 sm:px-6 lg:px-8">
        <div className="h-[44rem] animate-pulse rounded-xl bg-white/[0.035]" />
      </main>
    </>
  );
}
