/**
 * Manager agent CLI.
 *   pnpm agent propose --sigma 0.8        create a proposal from the frontier and print the approval URL
 *   pnpm agent status                     list proposals and the tail of the log
 *   pnpm agent records                    read the live ENS records and TideParams
 * Talks to the running backend (PUBLIC_APP_URL, default http://localhost:3000).
 */
const base = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
const [cmd, ...rest] = process.argv.slice(2);
const arg = (k: string, d?: string) => {
  const i = rest.indexOf(`--${k}`);
  return i >= 0 ? rest[i + 1] : d;
};

async function main() {
  if (cmd === "propose") {
    const sigma = Number(arg("sigma", "0.6"));
    const body: Record<string, number | string> = { sigma, strategy: arg("strategy", "eth-usdc.tide.eth")! };
    if (arg("N")) body.N = Number(arg("N"));
    if (arg("delta")) body.delta = Number(arg("delta"));
    const res = await fetch(`${base}/api/agent/propose`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const p = await res.json();
    if (!res.ok) throw new Error(p.error);
    console.log(`proposal ${p.id}: lambda ${p.from.lambda} -> ${p.to.lambda} bps`);
    console.log(`reason: ${p.reason}`);
    console.log(`\nOwner must approve with a fresh World ID authentication:\n${p.approvalUrl}\n`);
    console.log(`Waiting (Ctrl-C to stop)...`);
    for (;;) {
      await new Promise((r) => setTimeout(r, 4000));
      const s = await (await fetch(`${base}/api/state`)).json();
      const q = s.proposals.find((x: { id: string }) => x.id === p.id);
      if (q && q.status !== "pending") {
        console.log(`status: ${q.status}${q.blockedReason ? ` (${q.blockedReason})` : ""}`);
        if (q.txs) console.log(`ENS tx ${q.txs.ens}\nTideParams tx ${q.txs.params}`);
        break;
      }
      process.stdout.write(".");
    }
  } else if (cmd === "status") {
    const s = await (await fetch(`${base}/api/state`)).json();
    for (const p of s.proposals) console.log(`${p.id}  ${p.status.padEnd(8)}  λ ${p.from.lambda}->${p.to.lambda}  ${p.reason}`);
    console.log("--- log ---");
    for (const l of s.log.slice(0, 15)) console.log(`${new Date(l.at).toISOString()}  ${l.level.padEnd(5)}  ${l.msg}`);
  } else if (cmd === "records") {
    const s = await (await fetch(`${base}/api/state`)).json();
    console.log("ENS  ", s.records);
    console.log("chain", s.onchain);
    console.log("block", s.block);
  } else {
    console.log("usage: pnpm agent propose --sigma 0.8 | status | records");
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
