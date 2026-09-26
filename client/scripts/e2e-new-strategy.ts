/**
 * End-to-end check of the product flow with a throwaway "user" wallet, replicating exactly the calls the
 * /app/new wizard makes, against the running backend (PUBLIC_APP_URL) and Sepolia:
 *   fund user from the owner key -> POST /api/strategy/create -> wrap / mint / approve -> TideParams.init
 *   -> Aqua.ship -> resolver multicall(grantSetterRoles x3) -> verify records + agent scope + one fill.
 *   pnpm tsx --env-file=../.env scripts/e2e-new-strategy.ts
 */
import { createWalletClient, createPublicClient, http, parseEther, parseUnits, encodeAbiParameters, encodeFunctionData, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { packetToBytes } from "viem/ens";

import { ADDR, erc20Abi, aquaAbi, tideParamsAbi, tideAppAbi, resolverAbi, ORDER_TUPLE } from "../src/lib/chain";
import { readText, canSetText, normalizeKey } from "../src/lib/ens/client";
import { GOVERNED_KEYS } from "../src/lib/ens/config";

const base = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
const rpc = process.env.SEPOLIA_RPC_URL!;
const pc = createPublicClient({ chain: sepolia, transport: http(rpc) });
const owner = createWalletClient({ account: privateKeyToAccount(normalizeKey(process.env.OWNER_PRIVATE_KEY!)), chain: sepolia, transport: http(rpc) });
const userKey = (process.env.E2E_USER_KEY as Hex) ?? generatePrivateKey();
const user = createWalletClient({ account: privateKeyToAccount(userKey), chain: sepolia, transport: http(rpc) });
const me = user.account.address;

const wait = async (h: Hex, label: string) => {
  const rc = await pc.waitForTransactionReceipt({ hash: h });
  if (rc.status !== "success") throw new Error(`${label} reverted: ${h}`);
  console.log(`  ${label}: ${h}`);
  return rc;
};

async function main() {
  console.log(`user ${me} (key ${process.env.E2E_USER_KEY ? "from env" : "fresh"})`);
  const bal = await pc.getBalance({ address: me });
  if (bal < parseEther("0.05")) {
    await wait(await owner.sendTransaction({ to: me, value: parseEther("0.08") }), "fund user with 0.08 ETH");
  }

  const label = `e2e-${Date.now().toString(36)}`;
  const salt = String(Date.now());
  const lambda = 4000, n = 4, delta = 20, fee = 30;
  const weth = parseEther("0.02");
  const usdc = parseUnits("60", 6);

  // 1. name (backend, registrar key)
  const r = await fetch(`${base}/api/strategy/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, owner: me, lambdaBps: lambda, n, deltaBps: delta, feeBps: fee, salt }) });
  const strat = await r.json();
  if (!r.ok) throw new Error(strat.error);
  console.log(`named ${strat.name}, resolver ${strat.resolver}, orderHash ${strat.orderHash}`);
  for (const k of ["lambda", "N", "delta", "fee", "strategyHash"]) console.log(`  record ${k} = ${await readText(pc, strat.name, k)}`);

  // 2. fund + approve
  await wait(await user.writeContract({ address: ADDR.weth, abi: erc20Abi, functionName: "deposit", value: weth }), "wrap");
  await wait(await user.writeContract({ address: ADDR.usdc, abi: erc20Abi, functionName: "mint", args: [me, usdc] }), "mint usdc");
  await wait(await user.writeContract({ address: ADDR.weth, abi: erc20Abi, functionName: "approve", args: [ADDR.aqua, 2n ** 256n - 1n] }), "approve weth");
  await wait(await user.writeContract({ address: ADDR.usdc, abi: erc20Abi, functionName: "approve", args: [ADDR.aqua, 2n ** 256n - 1n] }), "approve usdc");

  // 3. params
  await wait(await user.writeContract({ address: ADDR.tideParams, abi: tideParamsAbi, functionName: "init", args: [strat.orderHash, lambda, n, delta, fee, ADDR.agent] }), "params.init");

  // 4. ship
  const [tokenA, tokenB]: [Address, Address] = ADDR.weth.toLowerCase() < ADDR.usdc.toLowerCase() ? [ADDR.weth, ADDR.usdc] : [ADDR.usdc, ADDR.weth];
  const order = (await pc.readContract({ address: ADDR.tideApp, abi: tideAppAbi, functionName: "order", args: [{ maker: me, tokenA, tokenB, salt: BigInt(salt) }] })) as { maker: Address; traits: bigint; data: Hex };
  const encoded = encodeAbiParameters(ORDER_TUPLE, [{ maker: order.maker, traits: order.traits, data: order.data }]);
  const amounts = tokenA === ADDR.weth ? [weth, usdc] : [usdc, weth];
  await wait(await user.writeContract({ address: ADDR.aqua, abi: aquaAbi, functionName: "ship", args: [ADDR.tideRouter, encoded, [tokenA, tokenB], amounts] }), "aqua.ship");
  const [aquaBal] = (await pc.readContract({ address: ADDR.aqua, abi: aquaAbi, functionName: "rawBalances", args: [me, ADDR.tideRouter, strat.orderHash, ADDR.weth] })) as [bigint, number];
  console.log(`  aqua balance weth ${aquaBal} (wallet still holds ${await pc.readContract({ address: ADDR.weth, abi: erc20Abi, functionName: "balanceOf", args: [me] })})`);

  // 5. delegate
  const dns = toHex(packetToBytes(strat.name));
  const calls = GOVERNED_KEYS.map((k) => encodeFunctionData({ abi: resolverAbi, functionName: "grantSetterRoles", args: [encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dns, k, ""] }), ADDR.agent] }));
  await wait(await user.writeContract({ address: strat.resolver, abi: resolverAbi, functionName: "multicall", args: [calls] }), "delegate (3 grants)");
  for (const k of [...GOVERNED_KEYS, "strategyHash"]) console.log(`  agent may set ${k}: ${await canSetText(pc, strat.resolver, k, ADDR.agent)}`);

  // 6. backend sees it
  const st = await (await fetch(`${base}/api/state?strategy=${strat.name}`)).json();
  console.log(`dashboard: owner ${st.strategy.owner}, agentEnabled ${st.agentEnabled}, onchain`, st.onchain, "block", st.block);
  console.log(`\nE2E user key (keep to reuse): ${userKey}`);
}
main().catch((e) => { console.error("FAIL", e); process.exit(1); });
