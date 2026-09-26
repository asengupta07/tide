/**
 * Rebuild client/data/strategies.json from chain. The file is only an index: a strategy is a label registered
 * under tide.eth whose name carries a `strategyHash` text record; parameters live in TideParams and on ENS,
 * fills are router events. Run: pnpm reindex   (REINDEX_FROM_BLOCK to narrow the log scan)
 */
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";

import { publicClient, readText, findResolver, userRegistryAbi, ethRegistryAbi } from "../src/lib/ens/client";
import { ENS_SEPOLIA } from "../src/lib/ens/config";
import { PARENT, SEPOLIA_WETH, SEPOLIA_USDC, listStrategies, saveStrategies, type Strategy } from "../src/lib/registry";
import { getLogsChunked } from "../src/lib/tide";

const pc = publicClient();
const logsClient = createPublicClient({ chain: sepolia, transport: http(process.env.LOGS_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });

async function main() {
  const parentLabel = PARENT.split(".")[0];
  const registry = getAddress((await pc.readContract({ address: ENS_SEPOLIA.ethRegistry as Address, abi: ethRegistryAbi, functionName: "getSubregistry", args: [parentLabel] })) as Address);
  console.log(`${PARENT} -> user registry ${registry}`);

  const event = userRegistryAbi.find((x) => x.type === "event" && x.name === "LabelRegistered")!;
  const fromBlock = BigInt(process.env.REINDEX_FROM_BLOCK ?? "11700000");
  const latest = await logsClient.getBlockNumber();
  const logs = await getLogsChunked(logsClient, { address: registry, event: event as never }, fromBlock, latest);
  console.log(`${logs.length} LabelRegistered events since block ${fromBlock}`);

  const existing = listStrategies();
  const byLabel = new Map<string, Strategy>();
  const agentLabel = process.env.ENS_AGENT_LABEL ?? "manager";
  const [tokenA, tokenB] = SEPOLIA_WETH.toLowerCase() < SEPOLIA_USDC.toLowerCase() ? [SEPOLIA_WETH, SEPOLIA_USDC] : [SEPOLIA_USDC, SEPOLIA_WETH];

  for (const l of logs) {
    const args = l.args as { label: string; tokenId: bigint };
    const label = args.label;
    if (label === agentLabel) continue;
    const name = `${label}.${PARENT}`;
    const [strategyHash, venue, resolver, owner] = await Promise.all([
      readText(pc, name, "strategyHash").catch(() => ""),
      readText(pc, name, "venue").catch(() => ""),
      findResolver(pc, name),
      pc.readContract({ address: registry, abi: userRegistryAbi, functionName: "findOwner", args: [label] }) as Promise<Address>,
    ]);
    if (!/^0x[0-9a-fA-F]{64}$/.test(strategyHash)) {
      console.log(`  ${name}: no strategyHash record, not a strategy`);
      continue;
    }
    const block = await logsClient.getBlock({ blockNumber: l.blockNumber! });
    const prev = existing.find((s) => s.label === label);
    byLabel.set(label, {
      label,
      name,
      owner: getAddress(owner),
      resolver: getAddress(resolver),
      orderHash: strategyHash as Hex,
      tokenA,
      tokenB,
      salt: prev?.salt ?? "",
      createdAt: Number(block.timestamp) * 1000,
      txs: { ...(prev?.txs ?? {}), register: l.transactionHash! },
    });
    console.log(`  ${name}: owner ${owner.slice(0, 10)}…  resolver ${resolver.slice(0, 10)}…  hash ${strategyHash.slice(0, 10)}…  venue ${venue || "?"}`);
  }
  const out = [...byLabel.values()].sort((a, b) => a.createdAt - b.createdAt);
  saveStrategies(out);
  console.log(`wrote ${out.length} strategies to data/strategies.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
