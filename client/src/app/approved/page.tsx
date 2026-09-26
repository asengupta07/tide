import { load } from "@/lib/store";
import { Nav, Status, Bezel, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Approved({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const s = load();
  const p = q.proposal ? s.proposals.find((x) => x.id === q.proposal) : undefined;
  const ok = !q.error && (q.purpose === "bind" || p?.status === "applied" || p?.status === "approved");
  return (
    <>
      <Nav current="app" />
      <main className="mx-auto w-full max-w-xl flex-1 px-6 pb-16 pt-32">
        <h1 className={`text-3xl font-semibold tracking-tight ${ok ? "text-accent" : "text-bad"}`}>{ok ? "Approved" : "Blocked"}</h1>
        {q.purpose === "bind" && !q.error && (
          <p className="mt-3 text-fg-2">Owner bound to the manager agent. Proposals can now be approved with a fresh World ID authentication.</p>
        )}
        {p && (
          <Bezel small className="mt-6"><div className="space-y-2 p-5 text-sm">
            <div className="flex items-center justify-between">
              <span className="num text-fg-3">proposal {p.id}</span>
              <Status s={p.status} />
            </div>
            <div className="font-medium">{p.strategy}</div>
            <div className="num text-fg-2">
              λ {p.from.lambda} → {p.to.lambda} · N {p.from.N} → {p.to.N} · δ {p.from.delta} → {p.to.delta}
            </div>
            {p.blockedReason && <div className="text-bad">{p.blockedReason}</div>}
            {p.txs && (
              <div className="pt-2 text-xs">
                <a className="text-accent" href={`https://sepolia.etherscan.io/tx/${p.txs.ens}`}>ENS setText {p.txs.ens?.slice(0, 18)}…</a>
                <br />
                <a className="text-accent" href={`https://sepolia.etherscan.io/tx/${p.txs.params}`}>TideParams.set {p.txs.params?.slice(0, 18)}…</a>
              </div>
            )}
          </div></Bezel>
        )}
        {q.error && <p className="mt-4 text-sm text-bad">{q.error}. The records were not changed.</p>}
        <div className="mt-8"><Pill href="/app" variant="ghost">Back to dashboard</Pill></div>
      </main>
    </>
  );
}
