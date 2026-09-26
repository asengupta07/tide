/**
 * Create two real LINK/USDC Tide strategies on Sepolia, owned by the existing owner and agent wallets,
 * then alternate small fills from the opposite wallet so the market opens with verifiable activity.
 *
 * pnpm tsx --env-file=../.env scripts/seed-link-market.ts
 */
import { createPublicClient, createWalletClient, encodeAbiParameters, getAddress, http, maxUint256, parseAbi, parseUnits, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import tideTakerAbi from "../src/abi/tide/TideTaker.json";
import { ADDR, aquaAbi, ORDER_TUPLE, tideAppAbi } from "../src/lib/chain";
import { normalizeKey, publicClient as ensPublicClient } from "../src/lib/ens/client";
import { createName } from "../src/lib/onboard";
import { addStrategy, getStrategy, type Strategy } from "../src/lib/registry";
import { mongo } from "../src/lib/db";
import { sortedTokens, TOKENS } from "../src/lib/tokens";

const erc20 = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const rpc = required("SEPOLIA_RPC_URL");
const owner = privateKeyToAccount(normalizeKey(required("OWNER_PRIVATE_KEY")));
const agent = privateKeyToAccount(normalizeKey(required("AGENT_PRIVATE_KEY")));
const pc = createPublicClient({ chain: sepolia, transport: http(rpc) });
const wallets = new Map([
  [owner.address.toLowerCase(), createWalletClient({ account: owner, chain: sepolia, transport: http(rpc) })],
  [agent.address.toLowerCase(), createWalletClient({ account: agent, chain: sepolia, transport: http(rpc) })],
]);
const [tokenA, tokenB] = sortedTokens({ key: "link-usdc", base: TOKENS.LINK, quote: TOKENS.USDC });

async function wait(hash: Hex, label: string) {
  const receipt = await pc.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`${label}: ${hash}`);
  return hash;
}

async function ensureBalanceAndApprovals(account: typeof owner, linkAmount: bigint, usdcAmount: bigint) {
  const wallet = wallets.get(account.address.toLowerCase())!;
  const usdc = await pc.readContract({ address: TOKENS.USDC.address, abi: erc20, functionName: "balanceOf", args: [account.address] });
  if (usdc < usdcAmount) await wait(await wallet.writeContract({ address: TOKENS.USDC.address, abi: erc20, functionName: "mint", args: [account.address, usdcAmount - usdc] }), `minted USDC for ${account.address}`);
  const link = await pc.readContract({ address: TOKENS.LINK.address, abi: erc20, functionName: "balanceOf", args: [account.address] });
  if (link < linkAmount) throw new Error(`${account.address} needs ${Number(linkAmount - link) / 1e18} more LINK`);
  for (const spender of [ADDR.aqua, ADDR.tideTaker]) {
    for (const token of [TOKENS.LINK.address, TOKENS.USDC.address]) {
      const allowance = await pc.readContract({ address: token, abi: erc20, functionName: "allowance", args: [account.address, spender] });
      if (allowance < linkAmount) await wait(await wallet.writeContract({ address: token, abi: erc20, functionName: "approve", args: [spender, maxUint256] }), `approved ${token} for ${account.address}`);
    }
  }
}

async function createStrategy(label: string, account: typeof owner, salt: bigint, link: bigint, usdc: bigint) {
  const existing = await getStrategy(label);
  if (existing) return existing;
  const strategy = await createName({ label, owner: account.address, tokenA, tokenB, salt, lambdaBps: 7500, n: 4, deltaBps: 20, feeBps: 30, description: "Live LINK/USDC liquidity on Tide." });
  await addStrategy(strategy);
  const wallet = wallets.get(account.address.toLowerCase())!;
  await wait(await wallet.writeContract({ address: ADDR.tideApp, abi: tideAppAbi, functionName: "init", args: [{ maker: account.address, tokenA, tokenB, salt }, 7500, 4, 20, 30, ADDR.agent] }), `${label} parameters`);
  const order = await pc.readContract({ address: ADDR.tideApp, abi: tideAppAbi, functionName: "order", args: [{ maker: account.address, tokenA, tokenB, salt }] }) as { maker: Address; traits: bigint; data: Hex };
  const encoded = encodeAbiParameters(ORDER_TUPLE, [{ maker: order.maker, traits: order.traits, data: order.data }]);
  const amounts = tokenA.toLowerCase() === TOKENS.LINK.address.toLowerCase() ? [link, usdc] : [usdc, link];
  await wait(await wallet.writeContract({ address: ADDR.aqua, abi: aquaAbi, functionName: "ship", args: [ADDR.tideRouter, encoded, [tokenA, tokenB], amounts] }), `${label} liquidity`);
  return strategy;
}

async function fill(strategy: Strategy, taker: typeof owner, sellLink: boolean, index: number) {
  const wallet = wallets.get(taker.address.toLowerCase())!;
  const input = sellLink ? TOKENS.LINK.address : TOKENS.USDC.address;
  const amount = sellLink ? parseUnits(index % 3 === 0 ? "0.025" : "0.015", 18) : parseUnits(index % 3 === 0 ? "0.35" : "0.2", 6);
  const aToB = input.toLowerCase() === strategy.tokenA.toLowerCase();
  await wait(await wallet.writeContract({ address: ADDR.tideTaker, abi: tideTakerAbi, functionName: "swap", args: [{ maker: getAddress(strategy.owner), tokenA: getAddress(strategy.tokenA), tokenB: getAddress(strategy.tokenB), salt: BigInt(strategy.salt) }, amount, true, aToB, 0n], gas: 700_000n }), `${strategy.label} ${sellLink ? "LINK→USDC" : "USDC→LINK"}`);
}

async function main() {
  void ensPublicClient();
  const linkForAgent = parseUnits("9", 18);
  const agentLink = await pc.readContract({ address: TOKENS.LINK.address, abi: erc20, functionName: "balanceOf", args: [agent.address] });
  if (agentLink < linkForAgent) {
    const ownerWallet = wallets.get(owner.address.toLowerCase())!;
    await wait(await ownerWallet.writeContract({ address: TOKENS.LINK.address, abi: erc20, functionName: "transfer", args: [agent.address, linkForAgent - agentLink] }), "funded second LINK maker");
  }
  const inventoryLink = parseUnits("7", 18);
  const inventoryUsdc = parseUnits("105", 6);
  await ensureBalanceAndApprovals(owner, inventoryLink, inventoryUsdc);
  await ensureBalanceAndApprovals(agent, inventoryLink, inventoryUsdc);
  const first = await createStrategy("link-usdc-tide", owner, 26092701n, inventoryLink, inventoryUsdc);
  const second = await createStrategy("link-usdc-swell", agent, 26092702n, inventoryLink, inventoryUsdc);
  for (let i = 0; i < 12; i++) {
    const strategy = i % 2 === 0 ? first : second;
    const taker = i % 2 === 0 ? agent : owner;
    await fill(strategy, taker, i % 4 < 2, i);
  }
  console.log(`LINK/USDC ready: ${first.name}, ${second.name}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await (await mongo()).close(); });
