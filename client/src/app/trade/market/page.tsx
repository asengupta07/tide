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
import { ADDR, short } from "@/lib/chain";

type StrategyRow = {
  label: string;
  name: string;
  owner: string;
  tokenA: string;
  tokenB: string;
  salt: string;
  records: { lambda: number; N: number; delta: number; fee?: number } | null;
  market?: {
    lambda: number;
    N: number;
    delta: number;
    fee: number;
    total: { weth: string; usdc: string };
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
    total: { weth: string; usdc: string };
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
  const totals = {
    weth: units(activeSnapshot?.block?.total.weth, 18),
    usdc: units(activeSnapshot?.block?.total.usdc, 6),
  };
  const feeBps = activeSnapshot?.onchain?.fee ?? activeSnapshot?.records.fee ?? 30;

  const sources = rows?.map((source) => ({
    strategy: source,
    totals: { weth: units(source.market?.total.weth, 18), usdc: units(source.market?.total.usdc, 6) },
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
              <div className="flex items-center gap-2 text-lg font-medium">WETH / USDC <CheckCircle size={15} className="text-accent" weight="fill" aria-label="Live market" /></div>
              <div className="text-[11px] text-fg-3">Tide routed market / Sepolia</div>
            </div>
          </div>
          <div className="flex items-center gap-5 text-[11px] text-fg-3">
            <span><strong className="num mr-1.5 font-normal text-fg-2">{rows?.length ?? 0}</strong>funded LPs</span>
            <span><strong className="num mr-1.5 font-normal text-fg-2">0.5%</strong>slippage limit</span>
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
                  <span className="num text-[10px] text-fg-3">{rows?.length ?? 0} LPs</span>
                </div>
                <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-1.5 [scrollbar-width:thin]">
                  {rows?.map((market) => {
                    const viewing = market.name === selected;
                    const best = market.name === routed;
                    const params = market.market ?? market.records;
                    const weth = units(market.market?.total.weth, 18);
                    const usdc = units(market.market?.total.usdc, 6);
                    return (
                      <button key={market.name} type="button" onClick={() => choose(market.name)} aria-pressed={viewing} aria-label={`Inspect ${market.name}${best ? ", current best route" : ""}`} className={`touch-exempt w-full rounded-lg px-3 py-3 text-left transition-colors duration-200 ${best ? "bg-accent/[0.09]" : viewing ? "bg-white/[0.055]" : "hover:bg-white/[0.035]"}`}>
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0"><span className="num block truncate text-[11px] text-fg-2">{market.name}</span><span className="num mt-1 block text-[10px] text-fg-3">{weth.toFixed(3)} WETH / {usdc.toLocaleString(undefined, { maximumFractionDigits: 0 })} USDC</span></span>
                          <span className={`num shrink-0 text-xs ${best ? "text-accent" : "text-fg-2"}`}>{params?.N ?? "-"}×</span>
                        </span>
                        <span className="mt-2 flex items-center justify-between text-[10px] text-fg-3"><span>{best ? "Best route" : viewing ? "Viewing" : short(market.owner)}</span><span className="num">λ {params ? params.lambda / 100 : "-"}%</span></span>
                      </button>
                    );
                  })}
                </div>
              </aside>
            </Bezel>

            <div className="order-2 min-w-0 space-y-3">
              <Bezel small>
                <section className="min-w-0 overflow-hidden p-4" aria-label="Price chart">
                  <CandleChart fills={activeSnapshot.fills} weth={ADDR.weth} compact />
                </section>
              </Bezel>

              <div className="grid gap-3 lg:grid-cols-2">
                <Bezel small>
                  <section className="p-4" aria-label="Price impact">
                    <div className="flex items-baseline justify-between gap-2"><h2 className="text-xs font-medium">WETH to USDC impact</h2><span className="text-[10px] text-fg-3">live reserves</span></div>
                    <div className="mt-3"><ImpactCurve totalIn={totals.weth} totalOut={totals.usdc} lambda={activeSnapshot.records.lambda / 10_000} N={activeSnapshot.records.N} deltaBps={activeSnapshot.records.delta} /></div>
                  </section>
                </Bezel>
                <Bezel small>
                  <RecentFills fills={activeSnapshot.fills} />
                </Bezel>
              </div>
            </div>

            <div className="order-1 min-w-0 space-y-3 xl:order-3 xl:sticky xl:top-24">
              <Bezel small>
                <div className="border-b border-line px-4 py-3">
                  <div className="flex items-center justify-between gap-3"><div><div className="text-xs font-medium">Auto-routed order</div><div className="mt-0.5 text-[10px] text-fg-3">Best executable quote across {rows?.length ?? 0} funded LPs</div></div><ChartLineUp size={16} className="text-accent" /></div>
                </div>
                <TradePanel strategy={activeSnapshot.strategy} totals={totals} feeBps={feeBps} mode="trade" compact sources={sources} onRoute={markRoute} onFilled={() => setRefreshToken((value) => value + 1)} />
              </Bezel>
              <Bezel small>
                <div className="grid grid-cols-3 divide-x divide-line">
                  <MarketFact value={`${activeSnapshot.records.N}×`} label="depth" />
                  <MarketFact value={`${activeSnapshot.records.delta / 100}%`} label="guard" />
                  <MarketFact value={`${activeSnapshot.records.lambda / 100}%`} label="visible" />
                </div>
              </Bezel>
              <p className="px-2 text-[10px] leading-relaxed text-fg-3">The inspected LP drives charts and fills. Swap execution still uses the strongest live route across every eligible Tide LP.</p>
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

function RecentFills({ fills }: { fills: TradeSnapshot["fills"] }) {
  const recent = fills.slice(-6).reverse();
  return (
    <section className="p-4" aria-label="Recent fills">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-xs font-medium">Recent fills</h2><span className="num text-[10px] text-fg-3">{fills.length} total</span></div>
      {recent.length === 0 ? <p className="py-10 text-center text-xs text-fg-3">No fills for this LP yet.</p> : (
        <div className="overflow-hidden">
          <div className="grid grid-cols-[3.5rem_1fr_4.5rem_1.5rem] gap-2 pb-2 text-[9px] text-fg-3"><span>Side</span><span>Size</span><span className="text-right">Block</span><span /></div>
          {recent.map((fill) => {
            const sellsWeth = fill.tokenIn.toLowerCase() === ADDR.weth.toLowerCase();
            const amount = units(fill.amountIn, sellsWeth ? 18 : 6);
            const size = amount > 0 && amount < 0.000001
              ? "<0.000001"
              : amount.toLocaleString(undefined, { maximumFractionDigits: sellsWeth ? 6 : 2 });
            return (
              <div key={fill.tx} className="grid grid-cols-[3.5rem_1fr_4.5rem_1.5rem] items-center gap-2 border-t border-white/[0.055] py-2 text-[10px]">
                <span className={sellsWeth ? "text-bad" : "text-accent"}>{sellsWeth ? "Sell" : "Buy"}</span>
                <span className="num truncate text-fg-2">{size} {sellsWeth ? "WETH" : "USDC"}</span>
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
