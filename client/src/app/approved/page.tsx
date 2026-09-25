import Link from "next/link";
import { load } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Approved({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const s = load();
  const p = q.proposal ? s.proposals.find((x) => x.id === q.proposal) : undefined;
  const ok = !q.error && (q.purpose === "bind" || p?.status === "applied" || p?.status === "approved");
  return (
    <main className="mx-auto max-w-xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">{ok ? "Approved" : "Blocked"}</h1>
      {q.purpose === "bind" && !q.error && <p className="mt-2">Owner bound to the manager agent. Proposals can now be approved with a fresh World ID authentication.</p>}
      {p && (
        <div className="mt-4 rounded border p-4 text-sm">
          <div>proposal <code>{p.id}</code> on <b>{p.strategy}</b></div>
          <div>λ {p.from.lambda} → {p.to.lambda}, N {p.from.N} → {p.to.N}, δ {p.from.delta} → {p.to.delta}</div>
          <div>status: <b>{p.status}</b></div>
          {p.blockedReason && <div className="text-red-600">{p.blockedReason}</div>}
          {p.txs && (
            <div className="mt-2">
              ENS setText: <a className="underline" href={`https://sepolia.etherscan.io/tx/${p.txs.ens}`}>{p.txs.ens?.slice(0, 18)}…</a>
              <br />TideParams.set: <a className="underline" href={`https://sepolia.etherscan.io/tx/${p.txs.params}`}>{p.txs.params?.slice(0, 18)}…</a>
            </div>
          )}
        </div>
      )}
      {q.error && <p className="mt-4 text-red-600">{q.error}. The records were not changed.</p>}
      <Link className="mt-6 inline-block underline" href="/">Back to dashboard</Link>
    </main>
  );
}
