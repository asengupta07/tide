"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { ArrowUpRight } from "@phosphor-icons/react";

import { Nav, Bezel, Pill } from "@/components/ui";
import { short } from "@/lib/chain";

type Row = {
  label: string; name: string; owner: string; orderHash: string; createdAt: number; agentEnabled: boolean;
  records: { lambda: number; N: number; delta: number } | null;
};

export default function Strategies() {
  const { address } = useAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    fetch("/api/strategies", { cache: "no-store" }).then((r) => r.json()).then(setRows);
  }, []);
  const mine = rows?.filter((r) => address && r.owner.toLowerCase() === address.toLowerCase()) ?? [];
  const others = rows?.filter((r) => !address || r.owner.toLowerCase() !== address.toLowerCase()) ?? [];

  return (
    <>
      <Nav current="app" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-20 pt-28 sm:px-7 sm:pt-32 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight">Strategies</h1>
            <p className="mt-2 max-w-[52ch] text-fg-2">Every Tide strategy is an ENS name under tide.eth, owned by the wallet that shipped it. Inventory stays in that wallet.</p>
          </div>
          <Pill href="/app/new">New strategy</Pill>
        </div>

        {rows === null && <div className="mt-12 grid gap-4 lg:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-white/[0.03]" />)}</div>}

        {rows && address && (
          <section className="mt-14">
            <h2 className="mb-4 text-sm font-medium text-fg-2">Yours</h2>
            {mine.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-white/10 p-8 text-sm text-fg-3">
                Nothing under {short(address)} yet. <Link className="text-accent" href="/app/new">Ship one</Link>: pick a name, set the four knobs, ship on Aqua. A few signatures, nothing leaves your wallet.
              </div>
            ) : (
              <Grid rows={mine} />
            )}
          </section>
        )}

        {rows && (
          <section className="mt-14">
            <h2 className="mb-4 text-sm font-medium text-fg-2">{address ? "Everyone else" : "All strategies"}</h2>
            {others.length === 0 ? <div className="text-sm text-fg-3">none</div> : <Grid rows={others} />}
          </section>
        )}
      </main>
    </>
  );
}

function Grid({ rows }: { rows: Row[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((r) => (
        <Link key={r.name} href={`/app/${r.label}`} className="group block">
          <Bezel small>
            <div className="p-5 transition-colors duration-300 group-hover:bg-white/[0.02]">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="num break-words text-base text-fg sm:text-lg">{r.name}</div>
                  <div className="mt-1 text-xs text-fg-3">owner {short(r.owner)} · {r.agentEnabled ? "manager enabled" : "manual"}</div>
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-px">
                  <ArrowUpRight size={14} />
                </span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-3">
                <K k="λ" v={r.records ? `${r.records.lambda / 100}%` : "–"} />
                <K k="N" v={r.records ? `${r.records.N}×` : "–"} />
                <K k="δ" v={r.records ? `${r.records.delta / 100}%` : "–"} />
              </div>
            </div>
          </Bezel>
        </Link>
      ))}
    </div>
  );
}
function K({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="num text-2xl font-semibold tracking-tight">{v}</div>
      <div className="text-xs text-fg-3">{k}</div>
    </div>
  );
}
