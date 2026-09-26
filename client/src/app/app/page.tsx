"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { WalletButton } from "@/components/WalletButton";
import { LibraryNav } from "@/components/LibraryNav";
import { ArrowUpRight } from "@phosphor-icons/react";

import { Nav, Bezel, Pill } from "@/components/ui";
import { short } from "@/lib/chain";

type Row = {
  label: string;
  name: string;
  owner: string;
  orderHash: string;
  createdAt: number;
  agentEnabled: boolean;
  published: boolean;
  records: { lambda: number; N: number; delta: number } | null;
};

export default function Strategies() {
  const { address } = useAccount();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    if (address) {
      fetch(`/api/strategies?owner=${address}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          return j;
        })
        .then((j) => {
          setRows(j);
          setLoadedFor(address);
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError(e.message);
            setLoadedFor(address);
          }
        });
    }
    return () => controller.abort();
  }, [address, attempt]);
  const mine =
    loadedFor === address
      ? (rows?.filter(
          (r) => r.owner.toLowerCase() === address?.toLowerCase(),
        ) ?? [])
      : [];
  const loading = !!address && loadedFor !== address;

  return (
    <>
      <Nav current="app" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-20 pt-28 sm:px-7 sm:pt-32 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="mb-3 text-xs uppercase tracking-[0.2em] text-accent">
              Your liquidity, your rules
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">
              My strategies
            </h1>
            <p className="mt-2 max-w-[52ch] text-fg-2">
              A quiet home for your liquidity. Strategies stay unlisted until
              you choose to share them.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Pill href="/trade" variant="ghost">
              Open trading
            </Pill>
            <Pill href="/app/new">New strategy</Pill>
          </div>
        </div>

        <LibraryNav active="mine" />
        {!address ? (
          <Bezel className="mt-10">
            <div className="space-y-5 p-8 sm:p-12">
              <div className="text-xs uppercase tracking-[0.2em] text-fg-3">
                Your workspace
              </div>
              <h2 className="text-2xl font-semibold">
                Connect to see your strategies.
              </h2>
              <p className="max-w-lg text-fg-2">
                Your wallet identifies what belongs here. Browse community
                strategies and templates in Explore anytime.
              </p>
              <WalletButton size="md" />
            </div>
          </Bezel>
        ) : loading ? (
          <div
            aria-label="Loading strategies"
            className="mt-10 grid gap-4 lg:grid-cols-2"
          >
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-2xl bg-white/[0.03]"
              />
            ))}
          </div>
        ) : error ? (
          <div
            role="alert"
            className="mt-10 rounded-2xl border border-bad/30 p-6"
          >
            <p>{error}</p>
            <button
              className="mt-3 text-accent"
              onClick={() => {
                setLoadedFor(undefined);
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : (
          <section className="mt-10">
            <div className="mb-5 flex items-center justify-between text-sm text-fg-3">
              <span>
                {mine.length} {mine.length === 1 ? "strategy" : "strategies"}
              </span>
              <span className="num">{short(address)}</span>
            </div>
            {mine.length ? (
              <Grid rows={mine} />
            ) : (
              <Bezel>
                <div className="space-y-5 p-8 sm:p-12">
                  <h2 className="text-2xl font-semibold">
                    Make your first move.
                  </h2>
                  <p className="max-w-lg text-fg-2">
                    Create a strategy from scratch, or start with a community
                    template and make it your own.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <Pill href="/app/new">Create strategy</Pill>
                    <Pill href="/app/explore?tab=templates" variant="ghost">
                      Browse templates
                    </Pill>
                  </div>
                </div>
              </Bezel>
            )}
          </section>
        )}
        <p className="mt-8 max-w-2xl text-xs leading-relaxed text-fg-3">
          Unlisted means absent from Explore. ENS records and on-chain activity
          remain public, and anyone with a strategy link can view it.
        </p>
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
                  <div className="mb-3 text-[11px] uppercase tracking-widest text-accent">
                    {r.published ? "Shared in Explore" : "Unlisted"}
                  </div>
                  <div className="num break-words text-base text-fg sm:text-lg">
                    {r.name}
                  </div>
                  <div className="mt-1 text-xs text-fg-3">
                    owner {short(r.owner)} ·{" "}
                    {r.agentEnabled ? "manager enabled" : "manual"}
                  </div>
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
