/**
 * Story 10: the owner pulls the plug in one EAC call per record (and drops the on-chain manager).
 *   pnpm tsx --env-file=../.env scripts/ens-revoke.ts            revoke
 *   pnpm tsx --env-file=../.env scripts/ens-revoke.ts --restore  grant again
 */
import fs from "node:fs";
import { getAddress, type Address } from "viem";
import { publicClient, walletClient, canSetText, setTextCalldata, textKeyResource, resolverAbi } from "../src/lib/ens/client";
import { GOVERNED_KEYS, ResolverRoles } from "../src/lib/ens/config";
import { deployment } from "../src/lib/tide";
import tideParamsAbi from "../src/abi/tide/TideParams.json";

const restore = process.argv.includes("--restore");
const ens = JSON.parse(fs.readFileSync("data/ens.json", "utf8")) as { strategyName: string; strategyResolver: Address; strategyHash: `0x${string}` };
const pc = publicClient();
const owner = walletClient(process.env.OWNER_PRIVATE_KEY!);
const agent = getAddress(process.env.AGENT_ADDRESS!);

async function main() {
  for (const key of GOVERNED_KEYS) {
    const has = await canSetText(pc, ens.strategyResolver, key, agent);
    if (restore && !has) {
      const h = await owner.writeContract({ address: ens.strategyResolver, abi: resolverAbi, functionName: "grantSetterRoles", args: [setTextCalldata(ens.strategyName, key, ""), agent], chain: owner.chain, account: owner.account });
      await pc.waitForTransactionReceipt({ hash: h });
      console.log(`granted setText(${key}) -> ${h}`);
    } else if (!restore && has) {
      const h = await owner.writeContract({ address: ens.strategyResolver, abi: resolverAbi, functionName: "revokeRoles", args: [textKeyResource(key), ResolverRoles.SET_TEXT, agent], chain: owner.chain, account: owner.account });
      await pc.waitForTransactionReceipt({ hash: h });
      console.log(`revoked setText(${key}) -> ${h}`);
    } else console.log(`setText(${key}) already ${has ? "granted" : "revoked"}`);
  }
  const dep = deployment();
  const h = await owner.writeContract({ address: dep.tideParams, abi: tideParamsAbi, functionName: "setManager", args: [ens.strategyHash, restore ? agent : "0x0000000000000000000000000000000000000000"], chain: owner.chain, account: owner.account });
  await pc.waitForTransactionReceipt({ hash: h });
  console.log(`TideParams manager ${restore ? "restored" : "revoked"} -> ${h}`);
  for (const key of GOVERNED_KEYS) console.log(`  agent may set ${key}: ${await canSetText(pc, ens.strategyResolver, key, agent)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
