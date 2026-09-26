"use client";

/**
 * Fill this strategy from a wallet: quote through TideTaker, compare with what a plain pool of the same
 * inventory would give, approve exactly the input, swap. Output lands in the wallet; the inventory never
 * leaves the maker's.
 */
import { useEffect, useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { parseUnits, formatUnits, type Address, type Hex } from "viem";
import { ArrowRight, ArrowsLeftRight, CircleNotch } from "@phosphor-icons/react";

import { ADDR, erc20Abi, tideTakerAbi } from "@/lib/chain";

type Props = {
  strategy: { name: string; owner: string; tokenA: string; tokenB: string; salt: string };
  totals: { weth: number; usdc: number }; // live inventory, for the plain-pool comparison
  feeBps: number;
  onFilled: () => void;
};

export function TradePanel({ strategy, totals, feeBps, onFilled }: Props) {
  const { address, isConnected } = useAccount();
  const pc = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [sellEth, setSellEth] = useState(true);
  const [amount, setAmount] = useState(sellEth ? "0.01" : "20");
  const [quote, setQuote] = useState<{ out: bigint; at: number } | null>(null);
  const [busy, setBusy] = useState<"quote" | "approve" | "swap" | "mining" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ tx: string; out: string } | null>(null);

  const wethIsA = ADDR.weth.toLowerCase() === strategy.tokenA.toLowerCase();
  const aToB = sellEth ? wethIsA : !wethIsA;
  const tokenIn = sellEth ? ADDR.weth : ADDR.usdc;
  const decIn = sellEth ? 18 : 6;
  const decOut = sellEth ? 6 : 18;
  const okAmount = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 && (amount.split(".")[1]?.length ?? 0) <= decIn;
  const wei = okAmount ? parseUnits(amount, decIn) : 0n;

  useEffect(() => {
    setQuote(null);
    setErr(null);
    if (!okAmount) return;
    setBusy("quote");
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/quote?strategy=${encodeURIComponent(strategy.name)}&amount=${wei.toString()}&exactIn=1&aToB=${aToB ? "1" : "0"}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setQuote({ out: BigInt(j.amountOut), at: Date.now() });
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(null);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, sellEth, strategy.name]);

  // what a plain constant-product pool with the same inventory and fee would give
  const plain = (() => {
    if (!okAmount || !(totals.weth > 0 && totals.usdc > 0)) return null;
    const q = Number(amount) * (1 - feeBps / 1e4);
    const [x, y] = sellEth ? [totals.weth, totals.usdc] : [totals.usdc, totals.weth];
    return (q * y) / (x + q);
  })();
  const outNum = quote ? Number(formatUnits(quote.out, decOut)) : null;
  const price = outNum && okAmount ? (sellEth ? outNum / Number(amount) : Number(amount) / outNum) : null;
  const vsPlain = outNum && plain ? (outNum / plain - 1) * 1e4 : null;

  const go = async () => {
    if (!address || !pc || !quote) return;
    setErr(null);
    setDone(null);
    try {
      const minOut = (quote.out * 995n) / 1000n; // 0.5% slippage
      const allowance = (await pc.readContract({ address: tokenIn, abi: erc20Abi, functionName: "allowance", args: [address, ADDR.tideTaker] })) as bigint;
      if (allowance < wei) {
        setBusy("approve");
        const h = await writeContractAsync({ address: tokenIn, abi: erc20Abi, functionName: "approve", args: [ADDR.tideTaker, wei] });
        await pc.waitForTransactionReceipt({ hash: h });
      }
      setBusy("swap");
      const cfg = { maker: strategy.owner as Address, tokenA: strategy.tokenA as Address, tokenB: strategy.tokenB as Address, salt: BigInt(strategy.salt || "0") };
      const h = await writeContractAsync({ address: ADDR.tideTaker, abi: tideTakerAbi, functionName: "swap", args: [cfg, wei, true, aToB, minOut] });
      setBusy("mining");
      const rc = await pc.waitForTransactionReceipt({ hash: h as Hex });
      if (rc.status !== "success") throw new Error("the fill reverted");
      setDone({ tx: h, out: formatUnits(quote.out, decOut) });
      onFilled();
    } catch (e) {
      setErr((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(null);
    }
  };

  const outLabel = sellEth ? "USDC" : "WETH";
  return (
    <div className="flex h-full flex-col p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Trade against this strategy</div>
        <button onClick={() => { setSellEth(!sellEth); setAmount(!sellEth ? "0.01" : "20"); }} className="touch-exempt flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-fg-2 hover:text-fg" aria-label="flip direction">
          <ArrowsLeftRight size={12} /> {sellEth ? "sell ETH" : "buy ETH"}
        </button>
      </div>
      <p className="mt-1 text-xs text-fg-3">Quoted live by the router. If you are the first trade of the block you meet the λ slice; after that, the deep curve.</p>

      <label className="mt-5 block text-xs text-fg-3">
        You pay
        <div className={`mt-1 flex items-center gap-2 rounded-xl border bg-white/[0.03] px-4 py-3 ${amount && !okAmount ? "border-bad/50" : "border-white/10"}`}>
          <input aria-label={`amount of ${sellEth ? "WETH" : "USDC"} to sell`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} className="num w-full bg-transparent text-lg text-fg outline-none" />
          <span className="num shrink-0 text-sm text-fg-3">{sellEth ? "WETH" : "USDC"}</span>
        </div>
      </label>
      <div className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-fg-3">You get</span>
          <span className="num text-lg text-fg">{busy === "quote" ? "…" : outNum !== null ? `${outNum.toLocaleString(undefined, { maximumFractionDigits: sellEth ? 2 : 6 })} ${outLabel}` : "–"}</span>
        </div>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-fg-3">
          <dt>price</dt><dd className="num text-right text-fg-2">{price ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 2 })} / ETH` : "–"}</dd>
          <dt>vs a plain pool of the same size</dt><dd className={`num text-right ${vsPlain === null ? "text-fg-2" : vsPlain >= 0 ? "text-accent" : "text-warn"}`}>{vsPlain === null ? "–" : `${vsPlain >= 0 ? "+" : ""}${vsPlain.toFixed(1)} bp`}</dd>
          <dt>fee, kept by the maker</dt><dd className="num text-right text-fg-2">{feeBps / 100}%</dd>
        </dl>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={go} disabled={!isConnected || !quote || !!busy} className="pill pill-primary pill-sm disabled:opacity-40">
          <span>{!isConnected ? "Connect a wallet to trade" : busy === "approve" ? "Approve in your wallet…" : busy === "swap" ? "Confirm the fill…" : busy === "mining" ? "Waiting for the block…" : "Fill"}</span>
          <span className="ico">{busy && busy !== "quote" ? <CircleNotch size={13} className="animate-spin" /> : <ArrowRight size={13} />}</span>
        </button>
        <span className="text-[11px] text-fg-3">0.5% slippage limit, exact allowance</span>
      </div>
      {done && <p className="mt-3 text-xs text-fg-2">Filled: {done.out} {outLabel} landed in your wallet. <a className="text-accent" href={`https://sepolia.etherscan.io/tx/${done.tx}`}>receipt ↗</a></p>}
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
    </div>
  );
}
