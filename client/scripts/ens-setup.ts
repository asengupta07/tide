/**
 * One-time ENSv2 setup on Sepolia for a Tide strategy (owner wallet):
 *
 *   1. deploy a UserRegistry proxy for `tide.eth` subnames (VerifiableFactory) and link it as the
 *      subregistry of `tide.eth` in the ETHRegistry
 *   2. deploy one PermissionedResolver proxy per subname (strategy name, agent name)
 *   3. register `eth-usdc.tide.eth` (owner) and `manager.tide.eth` (agent, ENSIP-26 agent name)
 *   4. write the strategy records lambda / N / delta / fee / strategyHash / venue
 *   5. grant the agent ROLE_SET_TEXT scoped to exactly lambda, N and delta via grantSetterRoles
 *   6. verify through the Universal Resolver and record everything in client/data/ens.json
 *
 * Idempotent: re-runs skip steps whose on-chain state already exists.
 *
 *   pnpm ens:setup
 */
import fs from "node:fs";
import path from "node:path";
import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import { namehash } from "viem/ens";

import {
  publicClient,
  walletClient,
  dnsName,
  labelhash,
  readText,
  findResolver,
  canSetText,
  setTextCalldata,
  ethRegistryAbi,
  userRegistryAbi,
  resolverAbi,
  factoryAbi,
} from "../src/lib/ens/client";
import { ENS_SEPOLIA, RegistryRoles, ResolverRoles, withAdmin, GOVERNED_KEYS } from "../src/lib/ens/config";
import tideAppAbi from "../src/abi/tide/TideApp.json";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

const PARENT = env("ENS_PARENT_NAME"); // tide.eth
const PARENT_LABEL = PARENT.replace(/\.eth$/, "");
const STRATEGY_LABEL = process.env.ENS_STRATEGY_LABEL ?? "eth-usdc";
const AGENT_LABEL = process.env.ENS_AGENT_LABEL ?? "manager";
const STRATEGY_NAME = `${STRATEGY_LABEL}.${PARENT}`;
const AGENT_NAME = `${AGENT_LABEL}.${PARENT}`;
const OWNER = walletClient(env("OWNER_PRIVATE_KEY"));
const AGENT_ADDRESS = getAddress(env("AGENT_ADDRESS"));
const pc = publicClient();

const DATA_DIR = path.join(process.cwd(), "data");
const OUT = path.join(DATA_DIR, "ens.json");
const FOREVER = 2n ** 64n - 1n;

type State = {
  parent: string;
  strategyName: string;
  agentName: string;
  userRegistry?: Address;
  strategyResolver?: Address;
  agentResolver?: Address;
  strategyHash?: Hex;
  txs: Record<string, Hex>;
};

function load(): State {
  if (fs.existsSync(OUT)) return JSON.parse(fs.readFileSync(OUT, "utf8"));
  return { parent: PARENT, strategyName: STRATEGY_NAME, agentName: AGENT_NAME, txs: {} };
}
function save(s: State) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(s, null, 2));
}

async function send(label: string, state: State, req: Parameters<typeof OWNER.writeContract>[0]) {
  const hash = await OWNER.writeContract(req);
  console.log(`  ${label}: ${hash}`);
  const rc = await pc.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${label} reverted`);
  state.txs[label] = hash;
  save(state);
  return rc;
}

/** Deploy a UUPS proxy through the VerifiableFactory and return its address from ProxyDeployed. */
async function deployProxy(label: string, state: State, implementation: Address, salt: bigint, init: Hex): Promise<Address> {
  const rc = await send(label, state, {
    address: ENS_SEPOLIA.verifiableFactory as Address,
    abi: factoryAbi,
    functionName: "deployProxy",
    args: [implementation, salt, init],
  } as never);
  const ev = parseAbi(["event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)"]);
  const { decodeEventLog } = await import("viem");
  for (const log of rc.logs) {
    try {
      const d = decodeEventLog({ abi: ev, data: log.data, topics: log.topics });
      if (d.eventName === "ProxyDeployed") return d.args.proxyAddress as Address;
    } catch {}
  }
  throw new Error("ProxyDeployed event not found");
}

async function strategyHashFromChain(): Promise<Hex> {
  const dep = JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "contracts", "deployments", "11155111.json"), "utf8"));
  const weth = getAddress(dep.weth);
  const usdc = getAddress(ENS_SEPOLIA.mockUsdc);
  const [tokenA, tokenB] = weth.toLowerCase() < usdc.toLowerCase() ? [weth, usdc] : [usdc, weth];
  return (await pc.readContract({
    address: getAddress(dep.tideApp),
    abi: tideAppAbi,
    functionName: "orderHash",
    args: [{ maker: OWNER.account.address, tokenA, tokenB, salt: 1n }],
  })) as Hex;
}

async function main() {
  const state = load();
  console.log(`owner ${OWNER.account.address}, agent ${AGENT_ADDRESS}`);
  console.log(`parent ${PARENT}, strategy ${STRATEGY_NAME}, agent name ${AGENT_NAME}`);

  // ---- 0. sanity: owner controls the parent name in the ETHRegistry ----
  const parentState = (await pc.readContract({
    address: ENS_SEPOLIA.ethRegistry as Address,
    abi: ethRegistryAbi,
    functionName: "getState",
    args: [labelhash(PARENT_LABEL)],
  })) as { status: number; expiry: bigint; latestOwner: Address; tokenId: bigint; resource: bigint };
  if (parentState.latestOwner.toLowerCase() !== OWNER.account.address.toLowerCase()) {
    throw new Error(`${PARENT} is owned by ${parentState.latestOwner}, not the owner wallet`);
  }
  console.log(`✓ ${PARENT} owned by owner, expires ${new Date(Number(parentState.expiry) * 1000).toISOString()}`);

  // ---- 1. user registry for tide.eth subnames ----
  const existingSub = (await pc.readContract({
    address: ENS_SEPOLIA.ethRegistry as Address,
    abi: ethRegistryAbi,
    functionName: "getSubregistry",
    args: [PARENT_LABEL],
  })) as Address;
  if (existingSub !== "0x0000000000000000000000000000000000000000") {
    state.userRegistry = existingSub;
    console.log(`✓ subregistry already linked: ${existingSub}`);
  } else {
    if (!state.userRegistry) {
      const ownerRoles =
        withAdmin(RegistryRoles.REGISTRAR) |
        withAdmin(RegistryRoles.REGISTER_RESERVED) |
        withAdmin(RegistryRoles.SET_PARENT) |
        withAdmin(RegistryRoles.UNREGISTER) |
        withAdmin(RegistryRoles.RENEW) |
        withAdmin(RegistryRoles.SET_SUBREGISTRY) |
        withAdmin(RegistryRoles.SET_RESOLVER) |
        withAdmin(RegistryRoles.SET_URI) |
        withAdmin(RegistryRoles.UPGRADE);
      const init = encodeFunctionData({
        abi: userRegistryAbi,
        functionName: "initialize",
        args: [[{ account: OWNER.account.address, roleBitmap: ownerRoles }]],
      });
      state.userRegistry = await deployProxy("deployUserRegistry", state, ENS_SEPOLIA.userRegistryImpl as Address, BigInt(namehash(PARENT)), init);
      save(state);
      console.log(`✓ user registry deployed: ${state.userRegistry}`);
    }
    await send("setSubregistry", state, {
      address: ENS_SEPOLIA.ethRegistry as Address,
      abi: ethRegistryAbi,
      functionName: "setSubregistry",
      args: [labelhash(PARENT_LABEL), state.userRegistry],
    } as never);
    console.log(`✓ ${PARENT} -> subregistry ${state.userRegistry}`);
  }
  const userRegistry = state.userRegistry!;

  // ---- 2. resolvers: one proxy per subname, owner holds root admin roles ----
  const resolverRootRoles =
    withAdmin(ResolverRoles.SET_ADDRESS) |
    withAdmin(ResolverRoles.SET_TEXT) |
    withAdmin(ResolverRoles.SET_CONTENTHASH) |
    withAdmin(ResolverRoles.SET_DATA) |
    withAdmin(ResolverRoles.SET_NAME) |
    withAdmin(ResolverRoles.LINK) |
    withAdmin(ResolverRoles.UPGRADE);
  const resolverInit = encodeFunctionData({
    abi: resolverAbi,
    functionName: "initialize",
    args: [[{ account: OWNER.account.address, roleBitmap: resolverRootRoles }], []],
  });
  if (!state.strategyResolver) {
    state.strategyResolver = await deployProxy("deployStrategyResolver", state, ENS_SEPOLIA.permissionedResolverImpl as Address, BigInt(namehash(STRATEGY_NAME)), resolverInit);
    save(state);
  }
  if (!state.agentResolver) {
    state.agentResolver = await deployProxy("deployAgentResolver", state, ENS_SEPOLIA.permissionedResolverImpl as Address, BigInt(namehash(AGENT_NAME)), resolverInit);
    save(state);
  }
  console.log(`✓ resolvers: strategy ${state.strategyResolver}, agent ${state.agentResolver}`);

  // ---- 3. register subnames ----
  const subOwnerRoles =
    withAdmin(RegistryRoles.SET_RESOLVER) | withAdmin(RegistryRoles.SET_SUBREGISTRY) | withAdmin(RegistryRoles.RENEW) | RegistryRoles.CAN_TRANSFER_ADMIN;
  for (const [label, owner, resolver, key] of [
    [STRATEGY_LABEL, OWNER.account.address, state.strategyResolver, "registerStrategy"],
    [AGENT_LABEL, AGENT_ADDRESS, state.agentResolver, "registerAgent"],
  ] as const) {
    const st = (await pc.readContract({ address: userRegistry, abi: userRegistryAbi, functionName: "getState", args: [labelhash(label)] })) as { status: number };
    if (st.status === 2) {
      console.log(`✓ ${label}.${PARENT} already registered`);
      const cur = (await pc.readContract({ address: userRegistry, abi: userRegistryAbi, functionName: "getResolver", args: [label] })) as Address;
      if (cur.toLowerCase() !== resolver!.toLowerCase()) {
        await send(`setResolver:${label}`, state, { address: userRegistry, abi: userRegistryAbi, functionName: "setResolver", args: [labelhash(label), resolver] } as never);
      }
      continue;
    }
    await send(key, state, {
      address: userRegistry,
      abi: userRegistryAbi,
      functionName: "register",
      args: [label, owner, "0x0000000000000000000000000000000000000000", resolver, subOwnerRoles, FOREVER],
    } as never);
    console.log(`✓ registered ${label}.${PARENT} -> owner ${owner}, resolver ${resolver}`);
  }

  // ---- 4. strategy records ----
  state.strategyHash = await strategyHashFromChain();
  const records: [string, string][] = [
    ["lambda", process.env.TIDE_LAMBDA_BPS ?? "5000"],
    ["N", process.env.TIDE_N ?? "4"],
    ["delta", process.env.TIDE_DELTA_BPS ?? "20"],
    ["fee", process.env.TIDE_FEE_BPS ?? "30"],
    ["strategyHash", state.strategyHash],
    ["venue", "aqua:sepolia"],
    ["description", "Tide partially-active AMM strategy, ETH/USDC. Parameters governed by manager.tide.eth"],
  ];
  const current = await Promise.all(records.map(([k]) => readText(pc, STRATEGY_NAME, k).catch(() => "")));
  const stale = records.filter(([, v], i) => current[i] !== v);
  if (stale.length) {
    await send("setStrategyRecords", state, {
      address: state.strategyResolver,
      abi: resolverAbi,
      functionName: "multicall",
      args: [stale.map(([k, v]) => setTextCalldata(STRATEGY_NAME, k, v))],
    } as never);
    console.log(`✓ wrote ${stale.map(([k]) => k).join(", ")} on ${STRATEGY_NAME}`);
  } else console.log("✓ strategy records up to date");

  // agent name: ENSIP-26 records
  const appUrl = process.env.PUBLIC_APP_URL ?? "https://localhost:3000";
  const agentRecords: [string, string][] = [
    ["agent-context", `Tide manager agent. Proposes lambda/N/delta for ${STRATEGY_NAME} from the activeness frontier; writes only after a fresh World ID authentication by the owner. Scoped EAC role: setText(lambda|N|delta) on the strategy resolver.`],
    ["agent-endpoint[web]", `${appUrl}/agent`],
    ["agent-endpoint[a2a]", `${appUrl}/api/agent`],
    ["strategy", STRATEGY_NAME],
  ];
  const curAgent = await Promise.all(agentRecords.map(([k]) => readText(pc, AGENT_NAME, k).catch(() => "")));
  const staleAgent = agentRecords.filter(([, v], i) => curAgent[i] !== v);
  if (staleAgent.length) {
    await send("setAgentRecords", state, {
      address: state.agentResolver,
      abi: resolverAbi,
      functionName: "multicall",
      args: [staleAgent.map(([k, v]) => setTextCalldata(AGENT_NAME, k, v))],
    } as never);
    console.log(`✓ wrote ENSIP-26 records on ${AGENT_NAME}`);
  }

  // ---- 5. scoped role for the agent: setText on lambda / N / delta only ----
  for (const key of GOVERNED_KEYS) {
    if (await canSetText(pc, state.strategyResolver, key, AGENT_ADDRESS)) {
      console.log(`✓ agent already has setText(${key})`);
      continue;
    }
    await send(`grantAgent:${key}`, state, {
      address: state.strategyResolver,
      abi: resolverAbi,
      functionName: "grantSetterRoles",
      args: [setTextCalldata(STRATEGY_NAME, key, ""), AGENT_ADDRESS],
    } as never);
    console.log(`✓ granted agent setText(${key})`);
  }

  // ---- 6. verify via the universal resolver ----
  const resolved = await findResolver(pc, STRATEGY_NAME);
  console.log(`universal resolver -> ${STRATEGY_NAME} resolver ${resolved}`);
  for (const [k] of records) console.log(`  ${k} = ${await readText(pc, STRATEGY_NAME, k)}`);
  console.log(`  agent may set strategyHash? ${await canSetText(pc, state.strategyResolver, "strategyHash", AGENT_ADDRESS)} (expected false)`);
  console.log(`  agent may set lambda?       ${await canSetText(pc, state.strategyResolver, "lambda", AGENT_ADDRESS)} (expected true)`);
  save(state);
  console.log(`saved ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
