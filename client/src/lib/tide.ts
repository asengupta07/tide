/**
 * On-chain side of a Tide strategy on Sepolia: TideParams (governed values the SwapVM program and the
 * v4 hook read), the router's block state, Aqua balances and fill events.
 */
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, getAddress, http, parseAbi, parseAbiItem, type Address, type Hex, type PublicClient } from "viem";
import { sepolia } from "viem/chains";

import tideParamsAbi from "@/abi/tide/TideParams.json";
import tideRouterAbi from "@/abi/tide/TideRouter.json";
import { walletClient } from "./ens/client";

export type Deployment = { chainId: number; aqua: Address; weth: Address; tideParams: Address; tideRouter: Address; tideApp: Address };

export function deployment(): Deployment {
  const p = path.join(process.cwd(), "..", "contracts", "deployments", "11155111.json");
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  return { ...d, aqua: getAddress(d.aqua), weth: getAddress(d.weth), tideParams: getAddress(d.tideParams), tideRouter: getAddress(d.tideRouter), tideApp: getAddress(d.tideApp) };
}

export const SEPOLIA_USDC = getAddress("0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e"); // ENS beta MockUSDC

const aquaAbi = parseAbi([
  "function safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1) view returns (uint256, uint256)",
]);

export async function readParams(pc: PublicClient, key: Hex) {
  const dep = deployment();
  const p = (await pc.readContract({ address: dep.tideParams, abi: tideParamsAbi, functionName: "params", args: [key] })) as {
    lambdaBps: number; n: number; deltaBps: number; feeBps: number; owner: Address; manager: Address;
  };
  return { lambda: Number(p.lambdaBps), N: Number(p.n), delta: Number(p.deltaBps), fee: Number(p.feeBps), owner: p.owner, manager: p.manager };
}

export type Bounds = { lambdaMin: number; lambdaMax: number; nMax: number; maxStepBps: number; cooldown: number; lastManagerSet: number };

/** The owner's guardrails for the manager, plus the time of the manager's last write. */
export async function readBounds(pc: PublicClient, key: Hex): Promise<Bounds> {
  const dep = deployment();
  const [b, last] = await Promise.all([
    pc.readContract({ address: dep.tideParams, abi: tideParamsAbi, functionName: "bounds", args: [key] }) as Promise<{ lambdaMin: number; lambdaMax: number; nMax: number; maxStepBps: number; cooldown: number }>,
    pc.readContract({ address: dep.tideParams, abi: tideParamsAbi, functionName: "lastManagerSet", args: [key] }) as Promise<bigint>,
  ]);
  return { lambdaMin: Number(b.lambdaMin), lambdaMax: Number(b.lambdaMax), nMax: Number(b.nMax), maxStepBps: Number(b.maxStepBps), cooldown: Number(b.cooldown), lastManagerSet: Number(last) };
}

/** Would a manager write to (lambda, N) pass the guardrails right now? Same check the contract makes. */
export async function withinBounds(pc: PublicClient, key: Hex, lambda: number, N: number): Promise<{ ok: boolean; why: string }> {
  const dep = deployment();
  const [ok, why] = (await pc.readContract({ address: dep.tideParams, abi: tideParamsAbi, functionName: "withinBounds", args: [key, lambda, N] })) as [boolean, string];
  return { ok, why };
}

/** Largest delta the fee backs at depth N: (N - 1) * delta <= 2 * fee (TideMath.checkParams). */
export function maxDeltaBps(N: number, feeBps: number) {
  return N <= 1 ? 4999 : Math.floor((2 * feeBps) / (N - 1));
}

/** Apply approved values on-chain as the manager agent. Reverts if the agent was revoked. */
export async function applyParams(agentKey: string, key: Hex, lambda: number, N: number, delta: number) {
  const dep = deployment();
  const wc = walletClient(agentKey);
  const hash = await wc.writeContract({
    address: dep.tideParams,
    abi: tideParamsAbi,
    functionName: "set",
    args: [key, lambda, N, delta],
    chain: wc.chain,
    account: wc.account,
  });
  return hash;
}

export async function blockState(pc: PublicClient, orderHash: Hex, maker: Address, tokens?: { tokenA: Address; tokenB: Address }) {
  const dep = deployment();
  const [tokenA, tokenB] = tokens ? [tokens.tokenA, tokens.tokenB] : dep.weth.toLowerCase() < SEPOLIA_USDC.toLowerCase() ? [dep.weth, SEPOLIA_USDC] : [SEPOLIA_USDC, dep.weth];
  const [blockNumber, activeWeth, activeUsdc, balances] = await Promise.all([
    pc.readContract({ address: dep.tideRouter, abi: tideRouterAbi, functionName: "tideBlockNumber", args: [orderHash] }) as Promise<bigint>,
    pc.readContract({ address: dep.tideRouter, abi: tideRouterAbi, functionName: "tideActive", args: [orderHash, dep.weth] }) as Promise<bigint>,
    pc.readContract({ address: dep.tideRouter, abi: tideRouterAbi, functionName: "tideActive", args: [orderHash, SEPOLIA_USDC] }) as Promise<bigint>,
    pc.readContract({ address: dep.aqua, abi: aquaAbi, functionName: "safeBalances", args: [maker, dep.tideRouter, orderHash, tokenA, tokenB] }).catch(() => [0n, 0n] as const),
  ]);
  const [balA, balB] = balances as readonly [bigint, bigint];
  const totalWeth = tokenA === dep.weth ? balA : balB;
  const totalUsdc = tokenA === dep.weth ? balB : balA;
  return {
    blockNumber: Number(blockNumber),
    active: { weth: activeWeth.toString(), usdc: activeUsdc.toString() },
    total: { weth: totalWeth.toString(), usdc: totalUsdc.toString() },
  };
}

const swappedEvent = parseAbiItem(
  "event Swapped(bytes32 orderHash, address maker, address taker, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)",
);

/** Router deployment block on Sepolia (from contracts/broadcast/Deploy.s.sol/11155111/run-latest.json). */
function deployBlock(): bigint {
  try {
    const p = path.join(process.cwd(), "..", "contracts", "broadcast", "Deploy.s.sol", "11155111", "run-latest.json");
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const b = j.receipts?.[0]?.blockNumber;
    return b ? BigInt(b) : 0n;
  } catch {
    return 0n;
  }
}

/** Public nodes cap eth_getLogs ranges (publicnode: 50,000 blocks); scan in chunks. */
export async function getLogsChunked<T extends Parameters<PublicClient["getLogs"]>[0]>(client: PublicClient, params: T, from: bigint, to: bigint, step = 45_000n) {
  const out: Awaited<ReturnType<PublicClient["getLogs"]>> = [];
  for (let a = from; a <= to; a += step) {
    const b = a + step - 1n < to ? a + step - 1n : to;
    out.push(...(await client.getLogs({ ...(params as object), fromBlock: a, toBlock: b } as never)));
  }
  return out;
}

/**
 * Fill history. Alchemy's free tier caps eth_getLogs at 10 blocks, so logs are read through
 * LOGS_RPC_URL (a public Sepolia node by default), in 45,000-block chunks.
 */
export async function fills(pc: PublicClient, orderHash: Hex, fromBlock?: bigint) {
  const dep = deployment();
  const logsClient = createPublicClient({ chain: sepolia, transport: http(process.env.LOGS_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com") });
  const latest = await logsClient.getBlockNumber();
  const start = fromBlock ?? deployBlock();
  const logs = (await getLogsChunked(logsClient, { address: dep.tideRouter, event: swappedEvent }, start, latest)) as Awaited<ReturnType<typeof logsClient.getLogs<typeof swappedEvent>>>;
  void pc;
  return logs
    .filter((l) => l.args.orderHash?.toLowerCase() === orderHash.toLowerCase())
    .map((l) => ({
      block: Number(l.blockNumber),
      tx: l.transactionHash,
      taker: l.args.taker,
      tokenIn: l.args.tokenIn,
      tokenOut: l.args.tokenOut,
      amountIn: l.args.amountIn?.toString(),
      amountOut: l.args.amountOut?.toString(),
    }));
}
