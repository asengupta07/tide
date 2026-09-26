"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, CheckCircle, Waves } from "@phosphor-icons/react";

import { TradePanel } from "@/components/TradePanel";
import { CandleChart } from "@/components/CandleChart";
import { ImpactCurve } from "@/components/ImpactCurve";
import { Bezel, Nav } from "@/components/ui";
import { isTradeReady } from "@/lib/trade-readiness";
import { short } from "@/lib/chain";
import { ADDR, short } from "@/lib/chain";

type StrategyRow = {
  label: string;
  name: string;
  owner: string;
  records: { lambda: number; N: number; delta: number; fee?: number } | null;
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

export default function TradePage() {
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
  const [snapshot, setSnapshot] = useState<TradeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/strategies?scope=public&tradable=1", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load Tide markets");
        return body as StrategyRow[];
      })
      .then((markets) => {
        if (!alive) return;
        setRows(markets);
        // Direct links can still open an unlisted strategy; discovery only lists published markets.
        const initial = requested
          ?? markets.find((market) => market.name === "eth-usdc.tide.eth")?.name
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
            router.replace(`/trade?strategy=${encodeURIComponent(fallback.name)}`, { scroll: false });
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

  const choose = (name: string) => {
    setSelected(name);
    router.replace(`/trade?strategy=${encodeURIComponent(name)}`, { scroll: false });
  };

  const activeSnapshot = snapshot && (snapshot.strategy.name === selected || snapshot.strategy.label === selected) ? snapshot : null;
  const totals = {
    weth: units(activeSnapshot?.block?.total.weth, 18),
    usdc: units(activeSnapshot?.block?.total.usdc, 6),
  };
  const feeBps = activeSnapshot?.onchain?.fee ?? activeSnapshot?.records.fee ?? 30;

  return (
    <>
      <Nav current="trade" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-20 pt-28 sm:px-7 sm:pt-32 lg:px-10">
        <header className="flex flex-col gap-6 border-b border-line pb-9 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/25 bg-accent/[0.06] px-3 py-1 text-xs text-accent">
              <Waves size={14} aria-hidden="true" /> Tide strategies only
            </div>
            <h1 className="max-w-[17ch] text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Built for lower slippage. Verified live.</h1>
            <p className="mt-4 max-w-[62ch] text-sm leading-relaxed text-fg-2 sm:text-base">Choose a live strategy and compare its quote with a constant-product pool holding the same inventory. Tide only calls it an advantage when the current quote proves it.</p>
          </div>
          <Link href="/app" className="inline-flex items-center gap-2 text-sm text-fg-2 transition-colors hover:text-fg">
            Provide liquidity <ArrowRight size={14} />
          </Link>
        </header>

        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)]">
          <Bezel small>
            <aside aria-label="Tide markets">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <h2 className="text-sm font-medium">Markets</h2>
                <span className="num text-xs text-fg-3">{rows?.length ?? "–"} strategies</span>
              </div>
              {rows === null && !error && (
                <div className="space-y-2 p-3" aria-label="Loading markets">
                  {[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-white/[0.035]" />)}
                </div>
              )}
              {rows?.length === 0 && <p className="p-5 text-sm text-fg-3">No published strategies are currently ready to trade.</p>}
              {rows && rows.length > 0 && (
                <div className="max-h-[30rem] overflow-y-auto p-2 [scrollbar-width:thin]">
                  {rows.map((market) => {
                    const active = market.name === selected;
                    return (
                      <button
                        key={market.name}
                        type="button"
                        onClick={() => choose(market.name)}
                        aria-pressed={active}
                        className={`touch-exempt flex w-full items-center justify-between gap-4 rounded-lg px-3 py-3 text-left transition-colors ${active ? "bg-accent/[0.1]" : "hover:bg-white/[0.04]"}`}
                      >
                        <span>
                          <span className="block text-sm font-medium">WETH / USDC</span>
                          <span className="num mt-0.5 block text-[11px] text-fg-3">{market.name}</span>
                        </span>
                        <span className="text-right">
                          <span className={`num block text-sm ${active ? "text-accent" : "text-fg-2"}`}>{market.records ? `${market.records.N}×` : "–"}</span>
                          <span className="block text-[10px] text-fg-3">depth</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </aside>
          </Bezel>

          <div className="min-w-0">
            {error && (
              <div className="rounded-xl border border-bad/30 bg-bad/[0.06] p-5 text-sm text-bad" role="alert">{error}</div>
            )}
            {!error && selected && activeSnapshot === null && <div className="h-[30rem] animate-pulse rounded-xl bg-white/[0.035]" aria-label="Loading quote" />}
            {activeSnapshot && (
              <Bezel>
                <div className="border-b border-line px-5 py-4 sm:px-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-lg font-medium">WETH / USDC <CheckCircle size={16} className="text-accent" weight="fill" aria-label="Live strategy" /></div>
                      <div className="num mt-1 text-xs text-fg-3">{activeSnapshot.strategy.name} · maker {short(activeSnapshot.strategy.owner)}</div>
                    </div>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-fg-3">Sepolia</span>
                  </div>
                </div>
                <TradePanel
                  strategy={activeSnapshot.strategy}
                  totals={totals}
                  feeBps={feeBps}
                  mode="trade"
                  onFilled={() => setRefreshToken((value) => value + 1)}
                />
                <div className="grid border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-line">
                  <MarketFact value={`${activeSnapshot.records.N}×`} label="virtual depth for follow-on flow" />
                  <MarketFact value={`${activeSnapshot.records.delta / 100}%`} label="deep-price guard band" />
                  <MarketFact value={`${activeSnapshot.records.lambda / 100}%`} label="inventory visible on the first fill" />
                </div>
              </Bezel>
            )}

            <div className="mt-5 px-1 text-xs leading-relaxed text-fg-3">
              <strong className="font-medium text-fg-2">Why the quote can be better:</strong> after a block&apos;s first fill, trades inside the guard band are priced against a curve that is {activeSnapshot ? `${activeSnapshot.records.N}×` : "N×"} deeper. The first fill uses the visible λ slice instead, so always judge the live comparison—not a promised rate.
            </div>
          </div>
        </div>

        {activeSnapshot && (
          <section className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium">Market context</h2>
                <p className="mt-1 text-sm text-fg-3">Price history, this strategy&apos;s fills, and the execution curve behind the live quote.</p>
              </div>
              <span className="text-xs text-fg-3">Live reserves · fee excluded from impact curves</span>
            </div>
            <div className="mt-5 grid gap-5 xl:grid-cols-[1.45fr_1fr] [&>*]:min-w-0">
              <Bezel small>
                <div className="min-w-0 overflow-hidden p-5">
                  <CandleChart fills={activeSnapshot.fills} weth={ADDR.weth} />
                </div>
              </Bezel>
              <Bezel small>
                <div className="p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-sm font-medium">WETH → USDC price impact</div>
                    <span className="text-xs text-fg-3">by order size</span>
                  </div>
                  <div className="mt-4">
                    <ImpactCurve
                      totalIn={totals.weth}
                      totalOut={totals.usdc}
                      lambda={activeSnapshot.records.lambda / 10_000}
                      N={activeSnapshot.records.N}
                      deltaBps={activeSnapshot.records.delta}
                    />
                  </div>
                </div>
              </Bezel>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function MarketFact({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-5 py-4">
      <div className="num text-lg font-medium text-fg">{value}</div>
      <div className="mt-1 text-[11px] leading-snug text-fg-3">{label}</div>
    </div>
  );
}

function TradeShell() {
  return (
    <>
      <Nav current="trade" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-20 pt-32 sm:px-7 lg:px-10">
        <div className="h-[38rem] animate-pulse rounded-xl bg-white/[0.035]" />
      </main>
    </>
  );
}
