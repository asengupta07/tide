"use client";

import { useEffect, useState } from "react";
import { FrontierChart } from "@/components/FrontierChart";

type Snapshot = {
  records: { name: string; lambda: number; N: number; delta: number; strategyHash: string };
  onchain: { lambda: number; N: number; delta: number; owner: string; manager: string } | null;
  block: { blockNumber: number; active: { weth: string; usdc: string }; total: { weth: string; usdc: string } } | null;
  fills: { block: number; tx: string; taker: string; tokenIn: string; tokenOut: string; amountIn: string; amountOut: string }[];
  proposals: { id: string; status: string; from: { lambda: number; N: number; delta: number }; to: { lambda: number; N: number; delta: number }; reason: string; sigma: number; approvalUrl?: string; blockedReason?: string; txs?: { ens?: string; params?: string }; createdAt: number }[];
  log: { at: number; level: string; msg: string }[];
  deployment: { tideParams: string; tideRouter: string; tideApp: string; aqua: string; weth: string };
  agent: string;
  bound: { subject: string; issuer: string; boundAt: number } | null;
  error?: string;
};

const fmt = (wei: string | undefined, dec: number, digits = 4) => (wei ? (Number(BigInt(wei)) / 10 ** dec).toFixed(digits) : "–");
const short = (h?: string) => (h ? `${h.slice(0, 8)}…${h.slice(-6)}` : "");
const WETH = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";

export default function Dashboard() {
  const [s, setS] = useState<Snapshot | null>(null);
  const [sigma, setSigma] = useState(0.8);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const r = await fetch("/api/state", { cache: "no-store" });
    setS(await r.json());
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  const propose = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/agent/propose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sigma }) });
      const p = await r.json();
      if (!r.ok) alert(p.error);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!s) return <main className="p-8 font-sans">loading…</main>;
  if (s.error) return <main className="p-8 font-sans text-red-600">{s.error}</main>;

  const lambda = s.records.lambda / 100;
  const activeW = Number(BigInt(s.block?.active.weth ?? "0")) / 1e18;
  const totalW = Number(BigInt(s.block?.total.weth ?? "0")) / 1e18;
  const activeU = Number(BigInt(s.block?.active.usdc ?? "0")) / 1e6;
  const totalU = Number(BigInt(s.block?.total.usdc ?? "0")) / 1e6;
  const mismatch = s.onchain && (s.onchain.lambda !== s.records.lambda || s.onchain.N !== s.records.N || s.onchain.delta !== s.records.delta);

  return (
    <main className="mx-auto max-w-6xl p-6 font-sans text-sm text-zinc-900 dark:text-zinc-100">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Tide</h1>
          <p className="text-zinc-500">partially-active liquidity on 1inch Aqua and Uniswap v4, governed through ENSv2 and World ID</p>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <div>strategy <b className="text-zinc-800 dark:text-zinc-200">{s.records.name}</b></div>
          <div>agent manager.tide.eth · {short(s.agent)}</div>
          <div>{s.bound ? `owner bound (${s.bound.subject})` : <a className="underline" href="/api/world/bind">bind owner with World ID</a>}</div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Parameters (ENSv2 records, Sepolia)">
          <Row k="lambda" v={`${lambda}%  (${s.records.lambda} bps)`} />
          <Row k="N" v={`${s.records.N}× virtual depth`} />
          <Row k="delta" v={`${s.records.delta / 100}% drift bound`} />
          <Row k="strategyHash" v={short(s.records.strategyHash)} />
          <div className={`mt-2 text-xs ${mismatch ? "text-amber-600" : "text-emerald-600"}`}>
            on-chain TideParams: λ {s.onchain?.lambda} N {s.onchain?.N} δ {s.onchain?.delta} {mismatch ? "(pending sync)" : "(in sync)"}
          </div>
        </Card>
        <Card title="Active / passive split (this block)">
          <Bar label="WETH" active={activeW} total={totalW} unit="" />
          <Bar label="USDC" active={activeU} total={totalU} unit="" />
          <div className="mt-2 text-xs text-zinc-500">last re-split block {s.block?.blockNumber || "–"} · passive stays in the maker&apos;s wallet</div>
        </Card>
        <Card title="Tune">
          <label className="block text-xs text-zinc-500">realised volatility (annualised)</label>
          <input type="range" min={0.2} max={1.2} step={0.05} value={sigma} onChange={(e) => setSigma(Number(e.target.value))} className="w-full" />
          <div className="mb-3">σ = {(sigma * 100).toFixed(0)}%</div>
          <button onClick={propose} disabled={busy} className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900">
            {busy ? "proposing…" : "agent: propose λ*"}
          </button>
          <p className="mt-2 text-xs text-zinc-500">The agent writes only after a fresh World ID authentication by the bound owner.</p>
        </Card>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Proposals">
          {s.proposals.length === 0 && <div className="text-zinc-500">none yet</div>}
          {s.proposals.map((p) => (
            <div key={p.id} className="mb-3 rounded border border-zinc-200 p-3 dark:border-zinc-700">
              <div className="flex justify-between">
                <span>
                  λ {p.from.lambda} → <b>{p.to.lambda}</b> bps · σ {(p.sigma * 100).toFixed(0)}%
                </span>
                <Status s={p.status} />
              </div>
              <div className="text-xs text-zinc-500">{p.reason}</div>
              {p.status === "pending" && p.approvalUrl && (
                <a className="mt-2 inline-block rounded bg-emerald-600 px-2 py-1 text-xs text-white" href={p.approvalUrl}>
                  approve with World ID (fresh auth)
                </a>
              )}
              {p.blockedReason && <div className="mt-1 text-xs text-red-600">{p.blockedReason}</div>}
              {p.txs && (
                <div className="mt-1 text-xs">
                  <a className="underline" href={`https://sepolia.etherscan.io/tx/${p.txs.ens}`}>ENS setText</a> ·{" "}
                  <a className="underline" href={`https://sepolia.etherscan.io/tx/${p.txs.params}`}>TideParams.set</a>
                </div>
              )}
            </div>
          ))}
        </Card>
        <Card title="Agent log">
          <ul className="max-h-80 overflow-auto font-mono text-xs">
            {s.log.map((l, i) => (
              <li key={i} className={l.level === "warn" ? "text-amber-600" : l.level === "error" ? "text-red-600" : ""}>
                {new Date(l.at).toLocaleTimeString()} {l.msg}
              </li>
            ))}
          </ul>
        </Card>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Fills (Sepolia, TideRouter Swapped events)">
          {s.fills.length === 0 && <div className="text-zinc-500">no fills yet</div>}
          <table className="w-full text-xs">
            <tbody>
              {s.fills.slice(-12).reverse().map((f) => {
                const inW = f.tokenIn.toLowerCase() === WETH;
                return (
                  <tr key={f.tx} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1">#{f.block}</td>
                    <td>{inW ? `${fmt(f.amountIn, 18)} WETH → ${fmt(f.amountOut, 6, 2)} USDC` : `${fmt(f.amountIn, 6, 2)} USDC → ${fmt(f.amountOut, 18)} WETH`}</td>
                    <td className="text-right"><a className="underline" href={`https://sepolia.etherscan.io/tx/${f.tx}`}>{short(f.tx)}</a></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Activeness frontier (research/frontier.json)">
          <FrontierChart sigma={sigma} />
        </Card>
      </section>

      <footer className="mt-8 text-xs text-zinc-500">
        TideRouter {short(s.deployment.tideRouter)} · TideParams {short(s.deployment.tideParams)} · Aqua {short(s.deployment.aqua)} · all on Sepolia
      </footer>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-800">
      <span className="text-zinc-500">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}
function Bar({ label, active, total, unit }: { label: string; active: number; total: number; unit: string }) {
  const pct = total > 0 ? Math.min(100, (active / total) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono">
          active {active.toFixed(4)}{unit} / {total.toFixed(4)}{unit}
        </span>
      </div>
      <div className="h-2 w-full rounded bg-zinc-200 dark:bg-zinc-700">
        <div className="h-2 rounded bg-sky-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
function Status({ s }: { s: string }) {
  const c: Record<string, string> = { pending: "bg-amber-100 text-amber-800", applied: "bg-emerald-100 text-emerald-800", approved: "bg-emerald-100 text-emerald-800", blocked: "bg-red-100 text-red-800", expired: "bg-red-100 text-red-800", failed: "bg-red-100 text-red-800" };
  return <span className={`rounded px-2 py-0.5 text-xs ${c[s] ?? ""}`}>{s}</span>;
}
