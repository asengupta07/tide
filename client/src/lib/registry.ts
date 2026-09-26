/**
 * Strategy registry: every Tide strategy created through the app. Persisted in client/data/strategies.json.
 * The demo strategy from the initial setup (data/ens.json) is migrated in on first read.
 */
import fs from "node:fs";
import path from "node:path";
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

const FILE = path.join(process.cwd(), "data", "strategies.json");
const ENS_FILE = path.join(process.cwd(), "data", "ens.json");
const DEP_FILE = path.join(process.cwd(), "..", "contracts", "deployments", "11155111.json");

export const SEPOLIA_WETH = getAddress("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14");
export const SEPOLIA_USDC = getAddress("0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e");
export const PARENT = process.env.ENS_PARENT_NAME ?? "tide.eth";

function migrate(): Strategy[] {
  try {
    const ens = JSON.parse(fs.readFileSync(ENS_FILE, "utf8"));
    const owner = getAddress(process.env.OWNER_ADDRESS!);
    const [tokenA, tokenB] = SEPOLIA_WETH.toLowerCase() < SEPOLIA_USDC.toLowerCase() ? [SEPOLIA_WETH, SEPOLIA_USDC] : [SEPOLIA_USDC, SEPOLIA_WETH];
    return [
      {
        label: ens.strategyName.split(".")[0],
        name: ens.strategyName,
        owner,
        resolver: getAddress(ens.strategyResolver),
        orderHash: ens.strategyHash,
        tokenA,
        tokenB,
        salt: "1",
        createdAt: Date.parse("2026-09-25T12:00:00Z"),
        txs: ens.txs ?? {},
      },
    ];
  } catch {
    return [];
  }
}

export function listStrategies(): Strategy[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Strategy[];
  } catch {
    const s = migrate();
    saveStrategies(s);
    return s;
  }
}

export function saveStrategies(s: Strategy[]) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

export function getStrategy(nameOrLabel: string): Strategy | undefined {
  const key = nameOrLabel.toLowerCase();
  return listStrategies().find((s) => s.name.toLowerCase() === key || s.label.toLowerCase() === key || s.orderHash.toLowerCase() === key);
}

export function addStrategy(s: Strategy) {
  const all = listStrategies().filter((x) => x.name.toLowerCase() !== s.name.toLowerCase());
  all.push(s);
  saveStrategies(all);
}

export function deployment() {
  const d = JSON.parse(fs.readFileSync(DEP_FILE, "utf8"));
  return { aqua: getAddress(d.aqua) as Address, weth: getAddress(d.weth) as Address, tideParams: getAddress(d.tideParams) as Address, tideRouter: getAddress(d.tideRouter) as Address, tideApp: getAddress(d.tideApp) as Address };
}

/** Labels: lowercase letters, digits and hyphens, 3 to 32 chars, no leading or trailing hyphen. */
export function validLabel(label: string) {
  return /^[a-z0-9]([a-z0-9-]{1,30}[a-z0-9])$/.test(label) && !["manager", "www", "admin"].includes(label);
}
