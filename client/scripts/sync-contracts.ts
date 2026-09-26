/**
 * After a contracts redeploy: copy ABIs from contracts/out and rewrite the ADDR block in src/lib/chain.ts
 * from contracts/deployments/11155111*.json. Idempotent. Run: pnpm sync:contracts
 */
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "..");
const dep = JSON.parse(fs.readFileSync(path.join(root, "contracts", "deployments", "11155111.json"), "utf8"));
const hookDep = JSON.parse(fs.readFileSync(path.join(root, "contracts", "deployments", "11155111-hook.json"), "utf8"));

for (const name of ["TideParams", "TideApp", "TideHook", "TideRouter"]) {
  const art = JSON.parse(fs.readFileSync(path.join(root, "contracts", "out", `${name}.sol`, `${name}.json`), "utf8"));
  fs.writeFileSync(path.join(process.cwd(), "src", "abi", "tide", `${name}.json`), JSON.stringify(art.abi));
  console.log(`abi ${name}: ${art.abi.length} entries`);
}

const chainPath = path.join(process.cwd(), "src", "lib", "chain.ts");
let src = fs.readFileSync(chainPath, "utf8");
const values: Record<string, string> = {
  aqua: dep.aqua,
  weth: dep.weth,
  tideParams: dep.tideParams,
  tideRouter: dep.tideRouter,
  tideApp: dep.tideApp,
  tideHook: hookDep.tideHook,
  ...(process.env.AGENT_ADDRESS ? { agent: process.env.AGENT_ADDRESS } : {}),
};
for (const [k, v] of Object.entries(values)) {
  const re = new RegExp(`(\\b${k}: ")0x[0-9a-fA-F]{40}(")`);
  if (!re.test(src)) throw new Error(`ADDR.${k} not found in chain.ts`);
  src = src.replace(re, `$1${v}$2`);
}
fs.writeFileSync(chainPath, src);
console.log("chain.ts ADDR:", values);
console.log("\nstill by hand: client/data/strategies.json orderHash, pnpm ens:setup, README / whitepaper / CHANGELOG addresses (docs/DEPLOYMENT.md §3.2)");
