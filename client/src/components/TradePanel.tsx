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

type StrategyConfig = { label?: string; name: string; owner: string; tokenA: string; tokenB: string; salt: string };
type CurveParams = { lambdaBps: number; N: number; deltaBps: number };
type RouteSource = { strategy: StrategyConfig; totals: { weth: number; usdc: number }; feeBps: number; params: CurveParams };

type Props = {
  strategy: StrategyConfig;
  totals: { weth: number; usdc: number }; // live inventory, for the plain-pool comparison
  feeBps: number;
  lambdaBps?: number;
  N?: number;
  deltaBps?: number;
  onFilled?: () => void;
  onRoute?: (strategyName: string) => void;
  sources?: RouteSource[];
  mode?: "trade" | "preview";
  compact?: boolean;
};

export function TradePanel({ strategy, totals, feeBps, lambdaBps, N, deltaBps, onFilled, onRoute, sources, mode = "trade", compact = false }: Props) {
  const { address, isConnected } = useAccount();
  const pc = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [sellEth, setSellEth] = useState(true);
  const [amount, setAmount] = useState(sellEth ? "0.01" : "20");
  const [quote, setQuote] = useState<{ out: bigint; key: string; strategy: StrategyConfig; aToB: boolean; checked: number } | null>(null);
  const [busy, setBusy] = useState<"quote" | "approve" | "swap" | "mining" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ tx: string; out: string } | null>(null);
  const autoRoute = mode === "trade" && !!sources?.length;
  const wethIsA = ADDR.weth.toLowerCase() === strategy.tokenA.toLowerCase();
  const singleAToB = sellEth ? wethIsA : !wethIsA;
  const tokenIn = sellEth ? ADDR.weth : ADDR.usdc;
  const decIn = sellEth ? 18 : 6;
  const decOut = sellEth ? 6 : 18;
  const okAmount = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 && (amount.split(".")[1]?.length ?? 0) <= decIn;
  const wei = okAmount ? parseUnits(amount, decIn) : 0n;
  const quoteKey = okAmount ? `${autoRoute ? "best" : strategy.name}:${wei}:${sellEth ? "1" : "0"}:${address?.toLowerCase() ?? ""}` : "";
  const quoteUrl = autoRoute
    ? `/api/quote/best?amount=${wei}&exactIn=1&sellEth=${sellEth ? "1" : "0"}${address ? `&excludeOwner=${address}` : ""}`
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
    if (!okAmount || !(currentTotals.weth > 0 && currentTotals.usdc > 0)) return null;
    const q = Number(amount) * (1 - currentFeeBps / 1e4);
    const [x, y] = sellEth ? [currentTotals.weth, currentTotals.usdc] : [currentTotals.usdc, currentTotals.weth];
    return (q * y) / (x + q);
  })();
  const outNum = currentQuote ? Number(formatUnits(currentQuote.out, decOut)) : null;
  const price = outNum && okAmount ? (sellEth ? outNum / Number(amount) : Number(amount) / outNum) : null;
  const vsPlain = outNum && plain ? (outNum / plain - 1) * 1e4 : null;
  const laneLimit = (routeTotals: { weth: number; usdc: number }, routeFeeBps: number, params: CurveParams) => {
    const totalIn = sellEth ? routeTotals.weth : routeTotals.usdc;
    const activeIn = totalIn * params.lambdaBps / 1e4;
    const drift = params.deltaBps / 1e4;
    if (!(activeIn > 0 && params.N > 1 && drift > 0 && drift < 1)) return 0;
    const maxNetIn = params.N * activeIn * (1 / Math.sqrt(1 - drift) - 1);
    return maxNetIn / (1 - routeFeeBps / 1e4);
  };
  const demoAmount = (() => {
    const limits = sources?.map((source) => laneLimit(source.totals, source.feeBps, source.params)).filter((value) => value > 0) ?? [];
    const safe = limits.length ? Math.min(...limits) * 0.5 : currentParams ? laneLimit(currentTotals, currentFeeBps, currentParams) * 0.5 : 0;
    return safe > 0 ? safe : null;
  })();
  const followOn = (() => {
    if (!okAmount || !currentParams || !(currentTotals.weth > 0 && currentTotals.usdc > 0) || currentParams.N <= 1) return null;
    const [totalIn, totalOut] = sellEth ? [currentTotals.weth, currentTotals.usdc] : [currentTotals.usdc, currentTotals.weth];
    const lambda = currentParams.lambdaBps / 1e4;
    const activeIn = totalIn * lambda;
    const activeOut = totalOut * lambda;
    const drift = currentParams.deltaBps / 1e4;
    if (!(activeIn > 0 && activeOut > 0 && drift > 0 && drift < 1)) return null;
    const maxGrossIn = laneLimit(currentTotals, currentFeeBps, currentParams);
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
      deltaBps: currentParams.deltaBps,
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

  const outLabel = sellEth ? "USDC" : "WETH";
  return (
    <div className={`flex h-full flex-col ${compact ? "p-4" : "p-5"}`}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">{mode === "preview" ? "Preview execution" : autoRoute ? "Auto-routed swap" : "Swap on Tide"}</div>
          {mode === "preview" && <div className="mt-0.5 text-[11px] text-fg-3">Quote only</div>}
        </div>
        <button onClick={() => { setSellEth(!sellEth); setAmount(!sellEth ? "0.01" : "20"); }} className="touch-exempt flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-fg-2 transition-colors hover:border-white/20 hover:text-fg" aria-label="flip trade direction">
          <ArrowsLeftRight size={12} /> {sellEth ? "WETH → USDC" : "USDC → WETH"}
        </button>
      </div>
      <p className={`${compact ? "mt-1.5 text-[11px]" : "mt-2 text-xs"} leading-relaxed text-fg-3`}>{autoRoute ? "Every available Tide LP is quoted live; the route with the most output wins." : "Quoted live by the router. Follow-on flow gets the deeper virtual curve while the live quote accounts for your actual place in the block."}</p>

      <label className={`${compact ? "mt-3" : "mt-5"} block text-xs text-fg-3`}>
        You pay
        <div className={`mt-1 flex items-center gap-2 rounded-xl border bg-white/[0.03] px-4 ${compact ? "py-2.5" : "py-3"} ${amount && !okAmount ? "border-bad/50" : "border-white/10"}`}>
          <input aria-label={`amount of ${sellEth ? "WETH" : "USDC"} to sell`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} className="num w-full bg-transparent text-lg text-fg outline-none" />
          <span className="num shrink-0 text-sm text-fg-3">{sellEth ? "WETH" : "USDC"}</span>
        </div>
      </label>
      <div className={`${compact ? "mt-2 py-2.5" : "mt-3 py-3"} rounded-xl border border-white/[0.06] bg-white/[0.02] px-4`}>
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-fg-3">You get</span>
          <span className="num text-lg text-fg">{busy === "quote" ? "…" : outNum !== null ? `${outNum.toLocaleString(undefined, { maximumFractionDigits: sellEth ? 2 : 6 })} ${outLabel}` : "-"}</span>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-fg-3">
          <dt>price</dt><dd className="num text-right text-fg-2">{price ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ETH` : "-"}</dd>
          <dt>executable vs full-inventory pool</dt><dd className={`num text-right ${vsPlain === null ? "text-fg-2" : vsPlain >= 0 ? "text-accent" : "text-fg-2"}`}>{vsPlain === null ? "-" : `${vsPlain >= 0 ? "+" : ""}${vsPlain.toFixed(1)} bp`}</dd>
          <dt>fee, kept by the maker</dt><dd className="num text-right text-fg-2">{currentFeeBps / 100}%</dd>
          {autoRoute && <><dt>best route</dt><dd className="num truncate text-right text-fg-2">{currentQuote ? currentStrategy.name : "-"}</dd></>}
          {autoRoute && <><dt>LP quotes compared</dt><dd className="num text-right text-fg-2">{currentQuote?.checked ?? "-"}</dd></>}
        </dl>
      </div>

      {followOn && (
        <div className={`${compact ? "mt-2 py-2.5" : "mt-3 py-3"} rounded-xl bg-accent/[0.08] px-4 text-accent`} role="status">
          <div className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-xs font-medium"><TrendUp size={15} aria-hidden="true" />Tide follow-on lane</span>
            <strong className="num text-sm">+{followOn.outputBps.toFixed(1)} bp output</strong>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-fg-2">
            {followOn.eligible
              ? `This order fits the ${followOn.deltaBps} bp guard after the block's first fill: ${followOn.impactMultiple.toFixed(2)}× less price impact on the ${followOn.N}× curve.`
              : `This order is above the ${followOn.deltaBps} bp guard. Follow-on fills up to ${formatLaneAmount(followOn.maxGrossIn, sellEth)} ${sellEth ? "WETH" : "USDC"} model ${followOn.impactMultiple.toFixed(2)}× less price impact on the ${followOn.N}× curve.`}
          </p>
          {!followOn.eligible && demoAmount && (
            <button type="button" onClick={() => setAmount(inputAmount(demoAmount, sellEth))} className="touch-exempt mt-2 rounded-full border border-accent/25 px-2.5 py-1 text-[10px] font-medium text-accent transition-colors hover:border-accent/50 hover:bg-accent/[0.06]">
              Use a live demo size · {formatLaneAmount(demoAmount, sellEth)} {sellEth ? "WETH" : "USDC"}
            </button>
          )}
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
        <span className="text-[11px] text-fg-3">0.5% slippage limit, exact allowance</span>
      </div>
      {isOwner && mode === "trade" && <p className="mt-3 text-xs leading-relaxed text-fg-3">This wallet supplies the strategy, so Tide keeps the swap disabled. Switch to a trader wallet to fill it.</p>}
      {done && <p className="mt-3 text-xs text-fg-2">Filled: {done.out} {outLabel} landed in your wallet. <a className="text-accent" href={`https://sepolia.etherscan.io/tx/${done.tx}`}>receipt ↗</a></p>}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </div>
  );
}

function formatLaneAmount(value: number, weth: boolean) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: weth ? 6 : 3,
    minimumFractionDigits: value > 0 && value < (weth ? 0.000001 : 0.001) ? (weth ? 8 : 4) : 0,
  });
}

function inputAmount(value: number, weth: boolean) {
  return value.toFixed(weth ? 8 : 4).replace(/0+$/, "").replace(/\.$/, "");
}
