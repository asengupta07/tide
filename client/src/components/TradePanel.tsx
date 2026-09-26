"use client";

/**
 * Fill this strategy from a wallet: quote through TideTaker, compare with what a plain pool of the same
 * inventory would give, approve exactly the input, swap. Output lands in the wallet; the inventory never
 * leaves the maker's.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { parseUnits, formatUnits, type Address, type Hex } from "viem";
import { ArrowRight, ArrowsLeftRight, CircleNotch, TrendUp } from "@phosphor-icons/react";

import { ADDR, erc20Abi, tideTakerAbi } from "@/lib/chain";
import { marketForTokens, marketKey, tokenMeta, type MarketPair } from "@/lib/tokens";

type StrategyConfig = { label?: string; name: string; owner: string; tokenA: string; tokenB: string; salt: string };
type CurveParams = { lambdaBps: number; N: number; deltaBps: number };
type PairTotals = { tokenA: number; tokenB: number };
type RouteSource = { strategy: StrategyConfig; totals: PairTotals; feeBps: number; params: CurveParams };

type Props = {
  strategy: StrategyConfig;
  totals: PairTotals; // live inventory in the strategy's tokenA/tokenB order
  feeBps: number;
  lambdaBps?: number;
  N?: number;
  deltaBps?: number;
  onFilled?: () => void;
  onRoute?: (strategyName: string) => void;
  sources?: RouteSource[];
  mode?: "trade" | "preview";
  compact?: boolean;
  pair?: MarketPair;
};

export function TradePanel({ strategy, totals, feeBps, lambdaBps, N, deltaBps, onFilled, onRoute, sources, mode = "trade", compact = false, pair }: Props) {
  const { address, isConnected } = useAccount();
  const pc = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const market = pair ?? marketForTokens(strategy.tokenA, strategy.tokenB) ?? { key: marketKey(strategy.tokenA, strategy.tokenB), base: tokenMeta(strategy.tokenA), quote: tokenMeta(strategy.tokenB) };
  const [sellBase, setSellBase] = useState(true);
  const [amount, setAmount] = useState(defaultAmount(market.base));
  const [quote, setQuote] = useState<{ out: bigint; key: string; strategy: StrategyConfig; aToB: boolean; checked: number } | null>(null);
  const [busy, setBusy] = useState<"quote" | "approve" | "swap" | "mining" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ tx: string; out: string } | null>(null);
  const autoRoute = mode === "trade" && !!sources?.length;
  const tokenInMeta = sellBase ? market.base : market.quote;
  const tokenOutMeta = sellBase ? market.quote : market.base;
  const tokenIn = tokenInMeta.address;
  const decIn = tokenInMeta.decimals;
  const decOut = tokenOutMeta.decimals;
  const singleAToB = tokenIn.toLowerCase() === strategy.tokenA.toLowerCase();
  const okAmount = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 && (amount.split(".")[1]?.length ?? 0) <= decIn;
  const wei = okAmount ? parseUnits(amount, decIn) : 0n;
  const quoteKey = okAmount ? `${autoRoute ? market.key : strategy.name}:${wei}:${tokenIn.toLowerCase()}:${address?.toLowerCase() ?? ""}` : "";
  const quoteUrl = autoRoute
    ? `/api/quote/best?amount=${wei}&exactIn=1&tokenIn=${tokenIn}&tokenOut=${tokenOutMeta.address}${address ? `&excludeOwner=${address}` : ""}`
    : `/api/quote?strategy=${encodeURIComponent(strategy.name)}&amount=${wei}&exactIn=1&aToB=${singleAToB ? "1" : "0"}`;
  const currentQuote = quote?.key === quoteKey ? quote : null;
  const currentStrategy = currentQuote?.strategy ?? strategy;
  const currentSource = sources?.find((source) => source.strategy.name === currentStrategy.name);
  const currentTotals = currentSource?.totals ?? totals;
  const currentFeeBps = currentSource?.feeBps ?? feeBps;
  const currentParams = currentSource?.params ?? (lambdaBps !== undefined && N !== undefined && deltaBps !== undefined ? { lambdaBps, N, deltaBps } : null);
  const aToB = currentQuote?.aToB ?? singleAToB;
  const isOwner = !!address && address.toLowerCase() === currentStrategy.owner.toLowerCase();

  useEffect(() => {
    if (!quoteKey) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      setErr(null);
      setBusy("quote");
      try {
        const r = await fetch(quoteUrl, { signal: controller.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setQuote({
          out: BigInt(j.route.amountOut),
          key: quoteKey,
          strategy: j.route.strategy as StrategyConfig,
          aToB: Boolean(j.route.aToB),
          checked: Number(j.sourcesChecked ?? (Array.isArray(j.quotes) ? j.quotes.length : 1)),
        });
        onRoute?.(j.route.strategy.name);
      } catch (e) {
        if (!controller.signal.aborted) setErr((e as Error).message);
      } finally {
        if (!controller.signal.aborted) setBusy(null);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [quoteKey, quoteUrl, onRoute]);

  // what a plain constant-product pool with the same inventory and fee would give
  const plain = (() => {
    const x = balanceFor(currentTotals, currentStrategy, tokenIn);
    const y = balanceFor(currentTotals, currentStrategy, tokenOutMeta.address);
    if (!okAmount || !(x > 0 && y > 0)) return null;
    const q = Number(amount) * (1 - currentFeeBps / 1e4);
    return (q * y) / (x + q);
  })();
  const outNum = currentQuote ? Number(formatUnits(currentQuote.out, decOut)) : null;
  const price = outNum && okAmount ? (sellBase ? outNum / Number(amount) : Number(amount) / outNum) : null;
  const vsPlain = outNum && plain ? (outNum / plain - 1) * 1e4 : null;
  const laneLimit = (routeTotals: PairTotals, routeFeeBps: number, params: CurveParams, route: StrategyConfig) => {
    const totalIn = balanceFor(routeTotals, route, tokenIn);
    const activeIn = totalIn * params.lambdaBps / 1e4;
    const drift = params.deltaBps / 1e4;
    if (!(activeIn > 0 && params.N > 1 && drift > 0 && drift < 1)) return 0;
    const maxNetIn = params.N * activeIn * (1 / Math.sqrt(1 - drift) - 1);
    return maxNetIn / (1 - routeFeeBps / 1e4);
  };
  const followOn = (() => {
    const totalIn = balanceFor(currentTotals, currentStrategy, tokenIn);
    const totalOut = balanceFor(currentTotals, currentStrategy, tokenOutMeta.address);
    if (!okAmount || !currentParams || !(totalIn > 0 && totalOut > 0) || currentParams.N <= 1) return null;
    const lambda = currentParams.lambdaBps / 1e4;
    const activeIn = totalIn * lambda;
    const activeOut = totalOut * lambda;
    const drift = currentParams.deltaBps / 1e4;
    if (!(activeIn > 0 && activeOut > 0 && drift > 0 && drift < 1)) return null;
    const maxGrossIn = laneLimit(currentTotals, currentFeeBps, currentParams, currentStrategy);
    const maxNetIn = maxGrossIn * (1 - currentFeeBps / 1e4);
    const enteredNetIn = Number(amount) * (1 - currentFeeBps / 1e4);
    const eligible = enteredNetIn <= maxNetIn;
    const modeledNetIn = eligible ? enteredNetIn : maxNetIn * 0.95;
    const xyc = (n: number) => (modeledNetIn * n * activeOut) / (n * activeIn + modeledNetIn);
    const plainActive = xyc(1);
    const deep = xyc(currentParams.N);
    const outputBps = (deep / plainActive - 1) * 1e4;
    const mid = activeOut / activeIn;
    const plainImpact = 1 - plainActive / modeledNetIn / mid;
    const deepImpact = 1 - deep / modeledNetIn / mid;
    return {
      eligible,
      outputBps,
      impactMultiple: deepImpact > 0 ? plainImpact / deepImpact : currentParams.N,
      maxGrossIn,
      N: currentParams.N,
    };
  })();

  const go = async () => {
    if (!address || !pc || !currentQuote || isOwner) return;
    setErr(null);
    setDone(null);
    try {
      const minOut = (currentQuote.out * 995n) / 1000n; // 0.5% slippage
      const allowance = (await pc.readContract({ address: tokenIn, abi: erc20Abi, functionName: "allowance", args: [address, ADDR.tideTaker] })) as bigint;
      if (allowance < wei) {
        setBusy("approve");
        const h = await writeContractAsync({ address: tokenIn, abi: erc20Abi, functionName: "approve", args: [ADDR.tideTaker, wei] });
        await pc.waitForTransactionReceipt({ hash: h });
      }
      setBusy("swap");
      const cfg = { maker: currentStrategy.owner as Address, tokenA: currentStrategy.tokenA as Address, tokenB: currentStrategy.tokenB as Address, salt: BigInt(currentStrategy.salt || "0") };
      const h = await writeContractAsync({ address: ADDR.tideTaker, abi: tideTakerAbi, functionName: "swap", args: [cfg, wei, true, aToB, minOut] });
      setBusy("mining");
      const rc = await pc.waitForTransactionReceipt({ hash: h as Hex });
      if (rc.status !== "success") throw new Error("the fill reverted");
      setDone({ tx: h, out: formatUnits(currentQuote.out, decOut) });
      onFilled?.();
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  };

  const outLabel = tokenOutMeta.symbol;
  return (
    <div className={`flex h-full flex-col ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{mode === "preview" ? "Preview execution" : autoRoute ? "Auto-routed swap" : "Swap on Tide"}</div>
          {mode === "preview" && <div className="mt-0.5 text-[11px] text-fg-3">Quote only</div>}
        </div>
        <button onClick={() => { setSellBase(!sellBase); setAmount(defaultAmount(!sellBase ? market.base : market.quote)); }} className="touch-exempt flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-fg-2 transition-colors hover:border-white/20 hover:text-fg" aria-label="flip trade direction">
          <ArrowsLeftRight size={12} /> {tokenInMeta.symbol} → {tokenOutMeta.symbol}
        </button>
      </div>
      <p className={`${compact ? "mt-1.5 text-[11px]" : "mt-2 text-xs"} leading-relaxed text-fg-3`}>{autoRoute ? "Tide checks every available liquidity source and chooses the one that gives you the most." : "This price is live and reflects when your order is expected to land."}</p>

      <label className={`${compact ? "mt-3" : "mt-5"} block text-xs text-fg-3`}>
        You pay
        <div className={`mt-1 flex items-center gap-2 rounded-xl border bg-white/[0.03] px-4 ${compact ? "py-2.5" : "py-3"} ${amount && !okAmount ? "border-bad/50" : "border-white/10"}`}>
          <input aria-label={`amount of ${tokenInMeta.symbol} to sell`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} className="num w-full bg-transparent text-lg text-fg outline-none" />
          <span className="num shrink-0 text-sm text-fg-3">{tokenInMeta.symbol}</span>
        </div>
      </label>
      <div className={`${compact ? "mt-2 py-2.5" : "mt-3 py-3"} rounded-xl border border-white/[0.06] bg-white/[0.02] px-4`}>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-fg-3">You get</span>
          <span className="num text-lg text-fg">{busy === "quote" ? "…" : outNum !== null ? `${outNum.toLocaleString(undefined, { maximumFractionDigits: decOut <= 6 ? 2 : 6 })} ${outLabel}` : "-"}</span>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-fg-3">
          <dt>price</dt><dd className="num text-right text-fg-2">{price ? `${price.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${market.quote.symbol} / ${market.base.symbol}` : "-"}</dd>
          <dt>compared with a standard pool</dt><dd className={`num text-right ${vsPlain === null ? "text-fg-2" : vsPlain >= 0 ? "text-accent" : "text-fg-2"}`}>{vsPlain === null ? "-" : formatComparison(vsPlain)}</dd>
          <dt>liquidity provider fee</dt><dd className="num text-right text-fg-2">{currentFeeBps / 100}%</dd>
          {autoRoute && <><dt>best route</dt><dd className="num truncate text-right text-fg-2">{currentQuote ? currentStrategy.name : "-"}</dd></>}
          {autoRoute && <><dt>liquidity sources checked</dt><dd className="num text-right text-fg-2">{currentQuote?.checked ?? "-"}</dd></>}
        </dl>
      </div>

      {followOn && (
        <div className={`${compact ? "mt-2" : "mt-3"} rounded-xl border border-accent/15 bg-accent/[0.055] px-3.5 py-3`} role="status">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <TrendUp size={14} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-fg">Tide advantage</div>
                  <div className="mt-0.5 text-[10px] text-fg-3">Available after another trade</div>
                </div>
                <div className="shrink-0 text-right">
                  <strong className="num block whitespace-nowrap text-sm font-medium text-accent">+{formatPercent(followOn.outputBps)}</strong>
                  <span className="block text-[9px] text-fg-3">more output</span>
                </div>
              </div>
              <p className="mt-2 border-t border-accent/10 pt-2 text-[10px] leading-relaxed text-fg-2">
                {followOn.eligible ? (
                  <>This order qualifies if another trade lands earlier in the block. Estimated price impact: <span className="font-medium text-fg">{followOn.impactMultiple.toFixed(2)}× lower</span>.</>
                ) : (
                  <>Available for orders up to <span className="num text-fg">{formatLaneAmount(followOn.maxGrossIn, tokenInMeta.decimals)} {tokenInMeta.symbol}</span> after another trade lands in the block. Estimated price impact: <span className="font-medium text-fg">{followOn.impactMultiple.toFixed(2)}× lower</span>.</>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className={`${compact ? "mt-3" : "mt-4"} flex flex-wrap items-center gap-3`}>
        {mode === "preview" ? (
          isOwner ? (
            <span className="rounded-md border border-white/10 px-3 py-2 text-xs text-fg-2">Owner preview · swaps disabled</span>
          ) : (
            <Link href={`/trade/market?strategy=${encodeURIComponent(strategy.name)}`} className="pill pill-primary pill-sm">
              <span>Trade this strategy</span><span className="ico"><ArrowRight size={13} /></span>
            </Link>
          )
        ) : (
          <button onClick={go} disabled={!isConnected || !currentQuote || !!busy || isOwner} className="pill pill-primary pill-sm disabled:cursor-not-allowed disabled:opacity-40">
            <span>{isOwner ? "Owner wallet · quote only" : !isConnected ? "Connect a wallet to trade" : busy === "approve" ? "Approve in your wallet…" : busy === "swap" ? "Confirm the fill…" : busy === "mining" ? "Waiting for the block…" : "Review and swap"}</span>
            <span className="ico">{busy && busy !== "quote" ? <CircleNotch size={13} className="animate-spin" /> : <ArrowRight size={13} />}</span>
          </button>
        )}
        <span className="text-[11px] text-fg-3">Maximum 0.5% price movement · only this amount is approved</span>
      </div>
      {isOwner && mode === "trade" && <p className="mt-3 text-xs leading-relaxed text-fg-3">This wallet supplies the strategy, so Tide keeps the swap disabled. Switch to a trader wallet to fill it.</p>}
      {done && <p className="mt-3 text-xs text-fg-2">Filled: {done.out} {outLabel} landed in your wallet. <a className="text-accent" href={`https://sepolia.etherscan.io/tx/${done.tx}`}>receipt ↗</a></p>}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </div>
  );
}

function balanceFor(totals: PairTotals, strategy: StrategyConfig, token: string) {
  return token.toLowerCase() === strategy.tokenA.toLowerCase() ? totals.tokenA : totals.tokenB;
}

function defaultAmount(token: { symbol: string }) {
  if (token.symbol === "WETH") return "0.01";
  if (token.symbol === "USDC") return "20";
  return "1";
}

function formatLaneAmount(value: number, decimals: number) {
  const max = decimals <= 6 ? 3 : 6;
  return value.toLocaleString(undefined, {
    maximumFractionDigits: max,
    minimumFractionDigits: value > 0 && value < 10 ** -max ? Math.min(decimals, max + 2) : 0,
  });
}

function formatPercent(bps: number) {
  const percent = Math.abs(bps) / 100;
  return `${percent.toFixed(percent < 0.1 ? 2 : 1)}%`;
}

function formatComparison(bps: number) {
  if (Math.abs(bps) < 0.05) return "about the same";
  return `${formatPercent(bps)} ${bps > 0 ? "more" : "less"}`;
}
