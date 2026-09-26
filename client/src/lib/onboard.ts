/**
 * Server side of "name a strategy": the tide.eth registry owner (this backend's key) deploys a
 * PermissionedResolver proxy whose admin is the user, seeds the strategy records, and registers
 * `<label>.tide.eth` to the user's wallet. Everything else (params, shipping, delegating to the agent) is
 * signed by the user in their own wallet; this backend never holds their funds or their roles.
 */
import { decodeEventLog, encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { namehash } from "viem/ens";

import { publicClient, walletClient, labelhash, setTextCalldata, userRegistryAbi, resolverAbi, factoryAbi } from "./ens/client";
import { ENS_SEPOLIA, RegistryRoles, ResolverRoles, withAdmin } from "./ens/config";
import { PARENT, deployment, getEnsState, type Strategy } from "./registry";
import tideAppAbi from "@/abi/tide/TideApp.json";

const pc = publicClient();
const registrar = () => walletClient(process.env.OWNER_PRIVATE_KEY!);

async function userRegistry(): Promise<Address> {
  const ens = await getEnsState();
  if (!ens?.userRegistry) throw new Error("tide.eth is not set up yet: run pnpm ens:setup");
  return getAddress(ens.userRegistry);
}

export async function labelAvailable(label: string): Promise<boolean> {
  const st = (await pc.readContract({ address: await userRegistry(), abi: userRegistryAbi, functionName: "getState", args: [labelhash(label)] })) as { status: number };
  return st.status === 0;
}

export async function orderHashFor(owner: Address, tokenA: Address, tokenB: Address, salt: bigint): Promise<Hex> {
  const dep = deployment();
  return (await pc.readContract({ address: dep.tideApp, abi: tideAppAbi, functionName: "orderHash", args: [{ maker: owner, tokenA, tokenB, salt }] })) as Hex;
}

export type CreateInput = {
  label: string;
  owner: Address;
  tokenA: Address;
  tokenB: Address;
  salt: bigint;
  lambdaBps: number;
  n: number;
  deltaBps: number;
  feeBps: number;
  description?: string;
};

/**
 * Deploy resolver (user = admin, records seeded), register subname to the user. Returns the strategy
 * record. Idempotent per label: if the resolver step succeeded earlier the same salt yields the same proxy.
 */
export async function createName(input: CreateInput): Promise<Strategy> {
  const name = `${input.label}.${PARENT}`;
  const wc = registrar();
  const txs: Record<string, Hex> = {};
  const orderHash = await orderHashFor(input.owner, input.tokenA, input.tokenB, input.salt);

  // 1. resolver proxy: user gets every admin role at root; records seeded through initialize's setter calls
  const rootRoles =
    withAdmin(ResolverRoles.SET_ADDRESS) | withAdmin(ResolverRoles.SET_TEXT) | withAdmin(ResolverRoles.SET_CONTENTHASH) |
    withAdmin(ResolverRoles.SET_DATA) | withAdmin(ResolverRoles.SET_NAME) | withAdmin(ResolverRoles.LINK) | withAdmin(ResolverRoles.UPGRADE);
  const records: [string, string][] = [
    ["lambda", String(input.lambdaBps)],
    ["N", String(input.n)],
    ["delta", String(input.deltaBps)],
    ["fee", String(input.feeBps)],
    ["strategyHash", orderHash],
    ["venue", "aqua"],
    ["description", input.description ?? `Tide strategy ${name}. Parameters moved by ${process.env.ENS_AGENT_LABEL ?? "manager"}.${PARENT} inside the owner's guardrails, by the owner beyond them.`],
  ];
  const init = encodeFunctionData({
    abi: resolverAbi,
    functionName: "initialize",
    args: [[{ account: input.owner, roleBitmap: rootRoles }], records.map(([k, v]) => setTextCalldata(name, k, v))],
  });
  const h1 = await wc.writeContract({ address: ENS_SEPOLIA.verifiableFactory as Address, abi: factoryAbi, functionName: "deployProxy", args: [ENS_SEPOLIA.permissionedResolverImpl, BigInt(namehash(name)), init], chain: wc.chain, account: wc.account });
  const rc = await pc.waitForTransactionReceipt({ hash: h1 });
  if (rc.status !== "success") throw new Error("resolver deployment reverted");
  txs.deployResolver = h1;
  const ev = parseAbi(["event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)"]);
  let resolver: Address | undefined;
  for (const log of rc.logs) {
    try {
      const d = decodeEventLog({ abi: ev, data: log.data, topics: log.topics });
      if (d.eventName === "ProxyDeployed") resolver = d.args.proxyAddress as Address;
    } catch {}
  }
  if (!resolver) throw new Error("ProxyDeployed event missing");

  // 2. register the subname to the user with the user-facing roles
  const subRoles = withAdmin(RegistryRoles.SET_RESOLVER) | withAdmin(RegistryRoles.SET_SUBREGISTRY) | withAdmin(RegistryRoles.RENEW) | RegistryRoles.CAN_TRANSFER_ADMIN;
  const h2 = await wc.writeContract({ address: await userRegistry(), abi: userRegistryAbi, functionName: "register", args: [input.label, input.owner, "0x0000000000000000000000000000000000000000", resolver, subRoles, 2n ** 64n - 1n], chain: wc.chain, account: wc.account });
  const rc2 = await pc.waitForTransactionReceipt({ hash: h2 });
  if (rc2.status !== "success") throw new Error("register reverted");
  txs.register = h2;

  return { label: input.label, name, owner: input.owner, resolver, orderHash, tokenA: input.tokenA, tokenB: input.tokenB, salt: input.salt.toString(), createdAt: Date.now(), txs };
}
