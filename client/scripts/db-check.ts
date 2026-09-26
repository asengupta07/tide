/**
 * Sanity check of the MongoDB state: document counts per collection and the dashboard snapshot of the first
 * strategy, read the same way the API does.   pnpm db:check
 */
import { db } from "../src/lib/db";
import { snapshot } from "../src/lib/agent";

async function main() {
  const d = await db();
  for (const n of ["strategies", "proposals", "authRequests", "bound", "log", "ens"]) console.log(`${n.padEnd(13)} ${await d.collection(n).countDocuments()}`);
  const s = await snapshot();
  console.log("\nsnapshot", s.strategy.name);
  console.log("  records ", s.records);
  console.log("  onchain ", s.onchain);
  console.log("  bounds  ", s.bounds);
  console.log("  bound   ", s.bound);
  console.log(`  proposals ${s.proposals.length}, latest ${s.proposals[0]?.id} ${s.proposals[0]?.status}; log ${s.log.length}`);
}
main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
