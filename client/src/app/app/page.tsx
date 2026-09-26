"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "@phosphor-icons/react";

import { Nav, Panel, Status } from "@/components/ui";
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
const tx = (h?: string) => `https://sepolia.etherscan.io/tx/${h}`;

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

  return (
    <>
      <Nav current="app" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        {!s ? (
          <Skeleton />
        ) : s.error ? (
          <div className="panel p-6 text-bad">{s.error}</div>
        ) : (
          <Body s={s} sigma={sigma} setSigma={setSigma} propose={propose} busy={busy} />
        )}
      </main>
    </>
  );
}

function Body({ s, sigma, setSigma, propose, busy }: { s: Snapshot; sigma: number; setSigma: (n: number) => void; propose: () => void; busy: boolean }) {
  const lambda = s.records.lambda / 100;
  const activeW = Number(BigInt(s.block?.active.weth ?? "0")) / 1e18;
  const totalW = Number(BigInt(s.block?.total.weth ?? "0")) / 1e18;
  const activeU = Number(BigInt(s.block?.active.usdc ?? "0")) / 1e6;
  const totalU = Number(BigInt(s.block?.total.usdc ?? "0")) / 1e6;
  const mismatch = s.onchain && (s.onchain.lambda !== s.records.lambda || s.onchain.N !== s.records.N || s.onchain.delta !== s.records.delta);

  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{s.records.name}</h1>
          <p className="mt-1 text-sm text-fg-3">
            manager.tide.eth <span className="num">{short(s.agent)}</span>
          </p>
        </div>
        <div className="text-right text-sm">
          {s.bound ? (
            <span className="text-fg-2">
              owner bound <span className="num text-fg-3">{s.bound.subject}</span>
            </span>
          ) : (
            <a className="btn btn-ghost" href="/api/world/bind">Bind owner with World ID</a>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel title="Parameters, ENSv2 records on Sepolia">
          <Row k="lambda" v={`${lambda} %  (${s.records.lambda} bps)`} />
          <Row k="N" v={`${s.records.N}× virtual depth`} />
          <Row k="delta" v={`${s.records.delta / 100} % drift bound`} />
          <Row k="strategyHash" v={short(s.records.strategyHash)} />
          <div className={`mt-3 text-xs ${mismatch ? "text-warn" : "text-accent"}`}>
            TideParams on-chain: λ {s.onchain?.lambda} · N {s.onchain?.N} · δ {s.onchain?.delta} {mismatch ? "(pending sync)" : "(in sync)"}
          </div>
        </Panel>
        <Panel title="Active / passive split, this block">
          <Bar label="WETH" active={activeW} total={totalW} digits={4} />
          <Bar label="USDC" active={activeU} total={totalU} digits={2} />
          <div className="mt-3 text-xs text-fg-3">Last re-split at block {s.block?.blockNumber || "–"}. Passive stays in the maker&apos;s wallet.</div>
        </Panel>
        <Panel title="Tune">
          <label className="block text-xs text-fg-3">Realised volatility, annualised</label>
          <input type="range" min={0.2} max={1.2} step={0.05} value={sigma} onChange={(e) => setSigma(Number(e.target.value))} className="mt-2 w-full" />
          <div className="num mb-4 mt-1 text-sm">σ = {(sigma * 100).toFixed(0)} %</div>
          <button onClick={propose} disabled={busy} className="btn btn-primary">
            {busy ? "Proposing…" : "Agent: propose λ*"}
          </button>
          <p className="mt-3 text-xs text-fg-3">The agent writes only after a fresh World ID authentication by the bound owner.</p>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Panel title="Proposals">
          {s.proposals.length === 0 && <Empty text="No proposals yet. Move the volatility slider and ask the agent." />}
          <div className="space-y-3">
            {s.proposals.map((p) => (
              <div key={p.id} className="rounded-ctl border border-line bg-bg-2 p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="num text-sm">
                    λ {p.from.lambda} → <b className="text-fg">{p.to.lambda}</b> bps at σ {(p.sigma * 100).toFixed(0)} %
                  </span>
                  <Status s={p.status} />
                </div>
                <div className="mt-1 text-xs text-fg-3">{p.reason}</div>
                {p.status === "pending" && p.approvalUrl && (
                  <a className="btn btn-primary mt-3 h-8 px-3 text-xs" href={p.approvalUrl}>Approve with World ID</a>
                )}
                {p.blockedReason && <div className="mt-2 text-xs text-bad">{p.blockedReason}</div>}
                {p.txs && (
                  <div className="mt-2 flex gap-4 text-xs">
                    <a className="inline-flex items-center gap-1 text-accent" href={tx(p.txs.ens)}>ENS setText <ArrowUpRight size={12} /></a>
                    <a className="inline-flex items-center gap-1 text-accent" href={tx(p.txs.params)}>TideParams.set <ArrowUpRight size={12} /></a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Agent log">
          {s.log.length === 0 && <Empty text="Quiet. The log fills as the agent proposes and the owner decides." />}
          <ul className="num max-h-80 space-y-1 overflow-auto text-xs">
            {s.log.map((l, i) => (
              <li key={i} className={l.level === "warn" ? "text-warn" : l.level === "error" ? "text-bad" : "text-fg-2"}>
                <span className="text-fg-3">{new Date(l.at).toLocaleTimeString()}</span> {l.msg}
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Panel title="Fills, TideRouter Swapped events on Sepolia">
          {s.fills.length === 0 && <Empty text="No fills indexed yet." />}
          <table className="w-full text-xs">
            <tbody>
              {s.fills.slice(-12).reverse().map((f) => {
                const inW = f.tokenIn.toLowerCase() === WETH;
                return (
                  <tr key={f.tx} className="border-t border-line">
                    <td className="num py-2 text-fg-3">#{f.block}</td>
                    <td className="num">{inW ? `${fmt(f.amountIn, 18)} WETH → ${fmt(f.amountOut, 6, 2)} USDC` : `${fmt(f.amountIn, 6, 2)} USDC → ${fmt(f.amountOut, 18)} WETH`}</td>
                    <td className="text-right">
                      <a className="num text-accent" href={tx(f.tx)}>{short(f.tx)}</a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
        <Panel title="Activeness frontier">
          <FrontierChart sigma={sigma} />
        </Panel>
      </div>

      <div className="num mt-8 text-xs text-fg-3">
        TideRouter {short(s.deployment.tideRouter)} · TideParams {short(s.deployment.tideParams)} · Aqua {short(s.deployment.aqua)}
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between border-b border-line py-1.5 text-sm last:border-0">
      <span className="text-fg-3">{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}
function Bar({ label, active, total, digits }: { label: string; active: number; total: number; digits: number }) {
  const pct = total > 0 ? Math.min(100, (active / total) * 100) : 0;
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-fg-2">{label}</span>
        <span className="num text-fg-2">
          active {active.toFixed(digits)} / {total.toFixed(digits)}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2">
        <div className="h-full bg-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="rounded-ctl border border-dashed border-line-2 p-4 text-sm text-fg-3">{text}</div>;
}
function Skeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`panel h-44 animate-pulse ${i > 2 ? "md:col-span-3 h-64" : ""}`} />
      ))}
    </div>
  );
}
