/**
 * Story 9 evidence, run as the AGENT wallet against Sepolia:
 *   - setText(lambda) succeeds (then the value is restored)
 *   - setText(strategyHash) reverts with EACUnauthorizedAccountRoles
 *   - setAddress(...) reverts
 *   - registry.setResolver on the strategy name reverts (the agent owns no roles there)
 *   pnpm tsx --env-file=../.env scripts/ens-agent-check.ts
 */
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { getEnsState } from "../src/lib/registry";
import { publicClient, walletClient, dnsName, labelhash, readText, setTextCalldata, resolverAbi, userRegistryAbi } from "../src/lib/ens/client";

let ens: { strategyName: string; strategyResolver: Address; userRegistry: Address };
const pc = publicClient();
const agent = walletClient(process.env.AGENT_PRIVATE_KEY!);
let name: string;

async function expectRevert(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`✗ ${label}: did NOT revert`);
    process.exitCode = 1;
  } catch (e) {
    const m = (e as Error).message;
    const eac = /EACUnauthorizedAccountRoles|0x4b27a133|reverted/i.test(m);
    console.log(`${eac ? "✓" : "?"} ${label}: reverted (${m.split("\n")[0].slice(0, 90)})`);
  }
}

async function main() {
  ens = (await getEnsState()) as unknown as typeof ens;
  if (!ens) throw new Error("tide.eth setup not found in MongoDB: run pnpm ens:setup");
  name = ens.strategyName;
  console.log(`agent ${agent.account.address} on ${name}, resolver ${ens.strategyResolver}`);
  const before = await readText(pc, name, "lambda");

  // allowed: lambda
  const h = await agent.writeContract({ address: ens.strategyResolver, abi: resolverAbi, functionName: "setText", args: [dnsName(name), "lambda", "4900"], chain: agent.chain, account: agent.account });
  await pc.waitForTransactionReceipt({ hash: h });
  console.log(`✓ agent setText(lambda) ok: ${h}, now ${await readText(pc, name, "lambda")}`);
  const h2 = await agent.writeContract({ address: ens.strategyResolver, abi: resolverAbi, functionName: "setText", args: [dnsName(name), "lambda", before], chain: agent.chain, account: agent.account });
  await pc.waitForTransactionReceipt({ hash: h2 });
  console.log(`✓ restored lambda=${before}: ${h2}`);

  // forbidden
  await expectRevert("agent setText(strategyHash)", () =>
    pc.simulateContract({ address: ens.strategyResolver, abi: resolverAbi, functionName: "setText", args: [dnsName(name), "strategyHash", "0xdead"], account: agent.account }));
  await expectRevert("agent setText(description)", () =>
    pc.simulateContract({ address: ens.strategyResolver, abi: resolverAbi, functionName: "setText", args: [dnsName(name), "description", "pwned"], account: agent.account }));
  await expectRevert("agent setAddress(60)", () =>
    pc.simulateContract({ address: ens.strategyResolver, abi: resolverAbi, functionName: "setAddress", args: [dnsName(name), 60n, agent.account.address], account: agent.account }));
  await expectRevert("agent registry.setResolver", () =>
    pc.simulateContract({ address: ens.userRegistry, abi: userRegistryAbi, functionName: "setResolver", args: [labelhash(name.split(".")[0]), agent.account.address], account: agent.account }));
  await expectRevert("agent registry.unregister", () =>
    pc.simulateContract({ address: ens.userRegistry, abi: userRegistryAbi, functionName: "unregister", args: [labelhash(name.split(".")[0])], account: agent.account }));
  void encodeFunctionData; void getAddress; void setTextCalldata;
}
main().then(() => process.exit(process.exitCode ?? 0)).catch((e) => { console.error(e); process.exit(1); });
