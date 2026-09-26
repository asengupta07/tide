/**
 * Strategy registry: every Tide strategy created through the app. Persisted in client/data/strategies.json.
 * The demo strategy from the initial setup (data/ens.json) is migrated in on first read.
 */
import fs from "node:fs";
import path from "node:path";
import { col, clean } from "./db";
import { getAddress, type Address, type Hex } from "viem";

export type Strategy = {
  label: string; // "eth-usdc"
  name: string; // "eth-usdc.tide.eth"
  owner: Address;
  resolver: Address;
  orderHash: Hex;
  tokenA: Address;
  tokenB: Address;
  salt: string; // uint64 as string
  createdAt: number;
  txs: Record<string, Hex>;
};

const DEP_FILE = path.join(process.cwd(), "..", "contracts", "deployments", "11155111.json");

export const SEPOLIA_WETH = getAddress("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14");
export const SEPOLIA_USDC = getAddress("0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e");
export const PARENT = process.env.ENS_PARENT_NAME ?? "tide.eth";

const strategies = () => col<Strategy>("strategies");

/** Oldest first. This is an index of names created through this app; `pnpm reindex` rebuilds it from chain. */
export async function listStrategies(): Promise<Strategy[]> {
  return (await strategies()).find({}, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray();
}

export async function saveStrategies(list: Strategy[]) {
  const c = await strategies();
  await c.deleteMany({});
  if (list.length) await c.insertMany(list.map((s) => ({ ...s })));
}

export async function getStrategy(nameOrLabel: string): Promise<Strategy | null> {
  const key = nameOrLabel.toLowerCase();
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return clean(await (await strategies()).findOne({ $or: [{ label: key }, { name: key }, { orderHash: { $regex: `^${esc}$`, $options: "i" } }] }));
}

export async function addStrategy(s: Strategy) {
  await (await strategies()).replaceOne({ label: s.label }, { ...s }, { upsert: true });
}

/** State of the tide.eth setup (registry, resolvers, tx hashes), written by scripts/ens-setup.ts. */
export type EnsState = {
  parent: string;
  strategyName: string;
  agentName: string;
  userRegistry?: Address;
  strategyResolver?: Address;
  agentResolver?: Address;
  strategyHash?: Hex;
  txs: Record<string, Hex>;
};

export async function getEnsState(parent = PARENT): Promise<EnsState | null> {
  return clean(await (await col<EnsState>("ens")).findOne({ parent }));
}

export async function saveEnsState(state: EnsState) {
  await (await col<EnsState>("ens")).replaceOne({ parent: state.parent }, { ...state }, { upsert: true });
}

export function deployment() {
  const d = JSON.parse(fs.readFileSync(DEP_FILE, "utf8"));
  return { aqua: getAddress(d.aqua) as Address, weth: getAddress(d.weth) as Address, tideParams: getAddress(d.tideParams) as Address, tideRouter: getAddress(d.tideRouter) as Address, tideApp: getAddress(d.tideApp) as Address };
}

/** Labels: lowercase letters, digits and hyphens, 3 to 32 chars, no leading or trailing hyphen. */
export function validLabel(label: string) {
  return /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$/.test(label) && !["manager", "www", "admin"].includes(label);
}
