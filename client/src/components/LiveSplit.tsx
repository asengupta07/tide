"use client";

/**
 * Hero island: the live active / passive split of the flagship strategy, read from /api/state. A real
 * component preview of the product, not a mock.
 */
import { useEffect, useState } from "react";

type S = {
  records?: { lambda: number; N: number; delta: number; name: string };
  block?: { blockNumber: number; active: { weth: string; usdc: string }; total: { weth: string; usdc: string } } | null;
};

const toNum = (wei: string | undefined, dec: number) => (wei ? Number(BigInt(wei)) / 10 ** dec : 0);

export function LiveSplit() {
  const [s, setS] = useState<S | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/state", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => alive && setS(d))
        .catch(() => alive && setErr(true));
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const w = { a: toNum(s?.block?.active.weth, 18), t: toNum(s?.block?.total.weth, 18) };
  const u = { a: toNum(s?.block?.active.usdc, 6), t: toNum(s?.block?.total.usdc, 6) };
  const lambda = s?.records ? s.records.lambda / 100 : null;

  return (
    <div className="bezel"><div className="core p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="num text-sm text-fg">{s?.records?.name ?? "eth-usdc.tide.eth"}</div>
        <div className="num text-xs text-fg-3">block {s?.block?.blockNumber ?? (err ? "offline" : "…")}</div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <div className="num text-4xl font-semibold tracking-tight text-accent">{lambda === null ? "–" : `${lambda}%`}</div>
          <div className="text-xs text-fg-3">exposed per block</div>
        </div>
        <div>
          <div className="num text-4xl font-semibold tracking-tight">{s?.records ? `${s.records.N}×` : "–"}</div>
          <div className="text-xs text-fg-3">virtual depth</div>
        </div>
        <div>
          <div className="num text-4xl font-semibold tracking-tight">{s?.records ? `${s.records.delta / 100}%` : "–"}</div>
          <div className="text-xs text-fg-3">drift bound</div>
        </div>
      </div>
      <div className="mt-5 space-y-3">
        <Bar label="WETH" active={w.a} total={w.t} digits={3} />
        <Bar label="USDC" active={u.a} total={u.t} digits={0} />
      </div>
      <div className="mt-4 text-xs text-fg-3">Bright part is what this block can trade. The rest stays in the maker&apos;s wallet.</div>
    </div></div>
  );
}

function Bar({ label, active, total, digits }: { label: string; active: number; total: number; digits: number }) {
  const pct = total > 0 ? Math.min(100, (active / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex justify-between gap-3 text-xs">
        <span className="text-fg-2">{label}</span>
        <span className="num text-fg-2">
          {active.toFixed(digits)} / {total.toFixed(digits)}
        </span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="absolute inset-y-0 left-0 rounded-full bg-accent shadow-[0_0_12px_rgba(88,201,182,0.35)]" style={{ width: `${pct}%`, transition: "width 900ms var(--ease-out)" }} />
      </div>
    </div>
  );
}
