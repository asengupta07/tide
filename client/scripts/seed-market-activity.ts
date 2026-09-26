/**
 * Seed real Sepolia fill history across every funded Tide WETH/USDC strategy.
 * Uses the manager wallet as an independent taker, batches tiny alternating fills,
 * and never trades against liquidity owned by that wallet.
 *
 * ACTIVITY_FILLS=18 pnpm tsx --env-file=../.env scripts/seed-market-activity.ts
 */
import { createPublicClient, createWalletClient, getAddress, http, maxUint256, parseAbi, parseEther, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import tideTakerAbi from "../src/abi/tide/TideTaker.json";
import { col, mongo } from "../src/lib/db";
import type { Strategy } from "../src/lib/registry";
import { SEPOLIA_USDC } from "../src/lib/registry";
import { deployment } from "../src/lib/tide";

const tokenAbi = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function deposit() payable",
  "function mint(address to, uint256 amount)",
]);

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const key = env("AGENT_PRIVATE_KEY") as Hex;
const rpc = env("SEPOLIA_RPC_URL");
const account = privateKeyToAccount(key);
const pc = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
const dep = deployment() as ReturnType<typeof deployment> & { tideTaker: Address };
const fills = Math.max(3, Math.min(60, Number(process.env.ACTIVITY_FILLS ?? 18)));

async function sendAndWait(hash: Hex, label: string) {
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash}`);
}

async function ensureTradingFunds() {
  const [weth, usdc] = await Promise.all([
    pc.readContract({ address: dep.weth, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
    pc.readContract({ address: SEPOLIA_USDC, abi: tokenAbi, functionName: "balanceOf", args: [account.address] }),
  ]);
  if (weth < parseEther("0.002")) {
    await sendAndWait(await wallet.writeContract({ address: dep.weth, abi: tokenAbi, functionName: "deposit", value: parseEther("0.002") }), "wrapped 0.002 ETH");
  }
  if (usdc < parseUnits("5", 6)) {
    await sendAndWait(await wallet.writeContract({ address: SEPOLIA_USDC, abi: tokenAbi, functionName: "mint", args: [account.address, parseUnits("5", 6)] }), "minted 5 mock USDC");
  }
  for (const token of [dep.weth, SEPOLIA_USDC] as Address[]) {
    const allowance = await pc.readContract({ address: token, abi: tokenAbi, functionName: "allowance", args: [account.address, dep.tideTaker] });
    if (allowance < parseEther("0.001")) {
      await sendAndWait(await wallet.writeContract({ address: token, abi: tokenAbi, functionName: "approve", args: [dep.tideTaker, maxUint256] }), `approved ${token === dep.weth ? "WETH" : "USDC"}`);
    }
  }
}

async function main() {
  const rows = await (await col<Strategy>("strategies")).find({}, { projection: { _id: 0 } }).toArray();
  const strategies = rows.filter((strategy) => {
    const pair = new Set([strategy.tokenA.toLowerCase(), strategy.tokenB.toLowerCase()]);
    return strategy.salt && strategy.owner.toLowerCase() !== account.address.toLowerCase() && pair.has(dep.weth.toLowerCase()) && pair.has(SEPOLIA_USDC.toLowerCase());
  });
  if (!strategies.length) throw new Error("No independent WETH/USDC Tide strategies found");
  await ensureTradingFunds();

  const waveSize = 9; // public Sepolia RPCs often cap one sender's pending queue near 16
  for (let start = 0; start < fills; start += waveSize) {
    const nonce = await pc.getTransactionCount({ address: account.address, blockTag: "pending" });
    const count = Math.min(waveSize, fills - start);
    const wave: { hash: Hex; label: string }[] = [];
    for (let offset = 0; offset < count; offset++) {
      const i = start + offset;
      const strategy = strategies[Math.floor(i / 2) % strategies.length];
      const sellWeth = i % 2 === 0;
      const tokenA = getAddress(strategy.tokenA);
      const tokenB = getAddress(strategy.tokenB);
      const aToB = sellWeth ? tokenA === getAddress(dep.weth) : tokenA === getAddress(SEPOLIA_USDC);
      const amount = sellWeth ? parseUnits("0.00001", 18) : parseUnits("0.02", 6);
      const hash = await wallet.writeContract({
        address: dep.tideTaker,
        abi: tideTakerAbi,
        functionName: "swap",
        args: [{ maker: getAddress(strategy.owner), tokenA, tokenB, salt: BigInt(strategy.salt) }, amount, true, aToB, 0n],
        nonce: nonce + offset,
        gas: 700_000n,
      });
      wave.push({ hash, label: `${strategy.name} ${sellWeth ? "WETH→USDC" : "USDC→WETH"}` });
      console.log(`queued ${i + 1}/${fills}: ${hash}`);
    }

    const receipts = await Promise.all(wave.map(async ({ hash, label }) => ({ label, receipt: await pc.waitForTransactionReceipt({ hash }) })));
    const failed = receipts.filter(({ receipt }) => receipt.status !== "success");
    for (const { label, receipt } of receipts) console.log(`${receipt.status === "success" ? "filled" : "reverted"} ${label}: ${receipt.transactionHash}`);
    if (failed.length) throw new Error(`${failed.length} fills reverted in activity wave ${Math.floor(start / waveSize) + 1}`);
  }
  console.log(`seeded ${fills} live fills across ${strategies.length} Tide LPs from ${account.address}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await (await mongo()).close();
  });
