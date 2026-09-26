/**
 * One-off: import the old client/data/*.json files into MongoDB. Safe to re-run (upserts).
 *   pnpm tsx --env-file=../.env scripts/db-import.ts
 */
import fs from "node:fs";
import path from "node:path";
import { col } from "../src/lib/db";
import { saveEnsState, type EnsState } from "../src/lib/registry";

const read = (f: string) => {
  const p = path.join(process.cwd(), "data", f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
};

async function main() {
  const strategies = read("strategies.json") as Record<string, unknown>[] | null;
  if (strategies) {
    const c = await col("strategies");
    for (const s of strategies) await c.replaceOne({ label: s.label }, s, { upsert: true });
    console.log(`strategies: ${strategies.length}`);
  }
  const state = read("state.json") as { bound?: Record<string, Record<string, unknown>>; proposals?: Record<string, unknown>[]; log?: Record<string, unknown>[] } | null;
  if (state) {
    const b = await col("bound");
    for (const [owner, id] of Object.entries(state.bound ?? {})) await b.replaceOne({ owner: owner.toLowerCase() }, { ...id, owner: owner.toLowerCase() }, { upsert: true });
    const p = await col("proposals");
    for (const pr of state.proposals ?? []) await p.replaceOne({ id: pr.id }, pr, { upsert: true });
    const l = await col("log");
    if (state.log?.length && (await l.countDocuments()) === 0) await l.insertMany(state.log);
    console.log(`bound: ${Object.keys(state.bound ?? {}).length}, proposals: ${state.proposals?.length ?? 0}, log: ${state.log?.length ?? 0}`);
  }
  const ens = read("ens.json") as EnsState | null;
  if (ens) {
    await saveEnsState(ens);
    console.log(`ens: ${ens.parent}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
