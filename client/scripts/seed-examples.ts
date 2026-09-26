/**
 * Put example strategies on Sepolia from the owner wallet and publish them on Explore, so a visitor sees
 * live markets and reusable templates instead of an empty page. Idempotent: existing labels are skipped,
 * balances already shipped are not shipped again, publications are updated in place.
 *
 * Per preset: POST /api/strategy/create (name + records) -> wrap / mint / approve -> TideApp.init with the
 * manager -> TideParams.setBounds -> Aqua.ship -> resolver grants for the manager -> publish "strategy" and
 * "template" through /api/strategy/[name]/sharing. Needs the dev server up (PUBLIC_APP_URL).
 *
 *   pnpm seed:examples
 */
import { createWalletClient, createPublicClient, http, parseEther, parseUnits, encodeAbiParameters, encodeFunctionData, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { packetToBytes } from "viem/ens";

import { ADDR, erc20Abi, aquaAbi, tideAppAbi, tideParamsAbi, resolverAbi, ORDER_TUPLE } from "../src/lib/chain";
import { TOKENS, sortedTokens, marketForTokens, type TokenMeta } from "../src/lib/tokens";
import { normalizeKey } from "../src/lib/ens/client";
import { GOVERNED_KEYS } from "../src/lib/ens/config";
import { getStrategy, PARENT, type Strategy } from "../src/lib/registry";
import { ownerMessage } from "../src/lib/auth";
import { publicationAction, type PublicationInput, type TemplateConfig } from "../src/lib/sharing";

const base = process.env.PUBLIC_APP_URL ?? "https://localhost:3000";
if (base.startsWith("https://localhost")) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // mkcert dev cert
const rpc = process.env.SEPOLIA_RPC_URL!;
const pc = createPublicClient({ chain: sepolia, transport: http(rpc) });
const owner = createWalletClient({ account: privateKeyToAccount(normalizeKey(process.env.OWNER_PRIVATE_KEY!)), chain: sepolia, transport: http(rpc) });
const me = owner.account.address;

type Preset = {
  label: string;
  base: TokenMeta;
  quote: TokenMeta;
  lambda: number;
  N: number;
  delta: number;
  fee: number;
  bounds: TemplateConfig["bounds"];
  amounts: { base: string; quote: string };
  title: string;
  description: string;
  templateTitle: string;
  templateDescription: string;
};

// (N - 1) * delta <= 2 * fee on every preset
const PRESETS: Preset[] = [
  {
    label: "calm-eth-usdc",
    base: TOKENS.WETH,
    quote: TOKENS.USDC,
    lambda: 7500,
    N: 2,
    delta: 30,
    fee: 30,
    bounds: { lambdaMin: 5000, lambdaMax: 9000, nMax: 4, maxStepBps: 2500, cooldown: 3600 },
    amounts: { base: "0.1", quote: "300" },
    title: "Calm market, ETH/USDC",
    description: "Shows three quarters of the inventory each block and keeps the deep curve shallow. Built for quiet markets: more fees per block, little to lose to arbitrage. The manager may move visibility between 50% and 90%.",
    templateTitle: "Calm market",
    templateDescription: "For pairs that move under 40% a year. 75% visible per block, a 2x deep curve within 0.3%, 30 bp fee. Guardrails keep the manager between 50% and 90% visibility with at most a 25 point step an hour.",
  },
  {
    label: "storm-eth-usdc",
    base: TOKENS.WETH,
    quote: TOKENS.USDC,
    lambda: 2500,
    N: 8,
    delta: 8,
    fee: 30,
    bounds: { lambdaMin: 1000, lambdaMax: 5000, nMax: 8, maxStepBps: 2500, cooldown: 3600 },
    amounts: { base: "0.1", quote: "300" },
    title: "Volatile market, ETH/USDC",
    description: "Shows a quarter of the inventory each block, so the first trader of a block reaches little, and serves everyone after them on a curve eight times deeper inside a tight 8 bp band. Built for fast markets.",
    templateTitle: "Volatile market",
    templateDescription: "For pairs that move over 80% a year. 25% visible per block, an 8x deep curve within 0.08%, 30 bp fee. Guardrails keep the manager between 10% and 50% visibility.",
  },
  {
    label: "retail-link-usdc",
    base: TOKENS.LINK,
    quote: TOKENS.USDC,
    lambda: 5000,
    N: 4,
    delta: 20,
    fee: 30,
    bounds: { lambdaMin: 1000, lambdaMax: 9000, nMax: 8, maxStepBps: 2500, cooldown: 3600 },
    amounts: { base: "5", quote: "90" },
    title: "Balanced, LINK/USDC",
    description: "The reference settings on a second pair: half visible per block, a 4x deep curve within 0.2%, 30 bp fee. Follow-on trades inside the band pay about a quarter of the impact a plain pool would charge.",
    templateTitle: "Balanced",
    templateDescription: "The default that ships with Tide. 50% visible per block, a 4x deep curve within 0.2%, 30 bp fee. The manager may roam the whole 10% to 90% range, one 25 point step an hour.",
  },
];

// existing owner strategies get listings and templates too
const EXISTING: Record<string, Pick<Preset, "title" | "description" | "templateTitle" | "templateDescription" | "bounds">> = {
  "eth-usdc": {
    title: "Reference strategy, ETH/USDC",
    description: "The strategy the whitepaper and the demo use. The manager has been moving its visibility with realised volatility since launch; every change is an ENS record and an on-chain parameter write.",
    templateTitle: "Reference",
    templateDescription: "Whatever the reference strategy runs right now, as a starting point. Half visible per block, a 4x deep curve, 30 bp fee, default guardrails.",
    bounds: { lambdaMin: 1000, lambdaMax: 9000, nMax: 8, maxStepBps: 2500, cooldown: 3600 },
  },
  "link-usdc-tide": {
    title: "LINK/USDC, manager off",
    description: "Same maths on LINK with the manager disconnected: the owner sets visibility by hand. Useful to compare against the managed LINK strategy.",
    templateTitle: "Hands-on",
    templateDescription: "No manager. 75% visible per block, a 4x deep curve within 0.2%, 30 bp fee. You change the settings yourself from the dashboard.",
    bounds: { lambdaMin: 1000, lambdaMax: 9000, nMax: 8, maxStepBps: 2500, cooldown: 3600 },
  },
};

const wait = async (h: Hex, label: string) => {
  const rc = await pc.waitForTransactionReceipt({ hash: h });
  if (rc.status !== "success") throw new Error(`${label} reverted: ${h}`);
  console.log(`  ${label}: ${h}`);
  return rc;
};

const api = async (path: string, body?: unknown) => {
  const r = await fetch(`${base}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j.error ?? r.status}`);
  return j;
};

const sign = async (action: string) => {
  const ts = Date.now();
  return { ts, sig: await owner.signMessage({ account: owner.account, message: ownerMessage(action, ts) }) };
};

async function balance(t: TokenMeta) {
  return (await pc.readContract({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: [me] })) as bigint;
}

async function ensureTokens(t: TokenMeta, need: bigint) {
  const have = await balance(t);
  if (have >= need) return;
  const short = need - have;
  if (t.symbol === "WETH") await wait(await owner.writeContract({ address: t.address, abi: erc20Abi, functionName: "deposit", value: short }), `wrap ${short} wei`);
  else if (t.symbol === "USDC") await wait(await owner.writeContract({ address: t.address, abi: erc20Abi, functionName: "mint", args: [me, short] }), `mint ${short} USDC units`);
  else throw new Error(`${t.symbol}: have ${have}, need ${need}; top up from a faucet`);
}

async function ensureAllowance(t: TokenMeta) {
  const a = (await pc.readContract({ address: t.address, abi: erc20Abi, functionName: "allowance", args: [me, ADDR.aqua] })) as bigint;
  if (a >= 2n ** 128n) return;
  await wait(await owner.writeContract({ address: t.address, abi: erc20Abi, functionName: "approve", args: [ADDR.aqua, 2n ** 256n - 1n] }), `approve ${t.symbol} for Aqua`);
}

async function createStrategy(p: Preset): Promise<Strategy> {
  const name = `${p.label}.${PARENT}`;
  const existing = await getStrategy(name);
  if (existing) {
    console.log(`${name}: exists`);
    return existing;
  }
  const market = marketForTokens(p.base.address, p.quote.address)!;
  const [tokenA, tokenB] = sortedTokens(market);
  const salt = String(Date.now());
  const { ts, sig } = await sign(`name ${p.label} for ${me.toLowerCase()}`);
  await api("/api/strategy/create", { label: p.label, owner: me, tokenA, tokenB, lambdaBps: p.lambda, n: p.N, deltaBps: p.delta, feeBps: p.fee, salt, description: p.title, ts, sig });
  const s = await getStrategy(name);
  if (!s) throw new Error(`${name} not in the registry after create`);
  console.log(`${name}: named, order ${s.orderHash}`);
  return s;
}

async function fundAndShip(p: Preset, s: Strategy) {
  const tokenA = s.tokenA as Address;
  const tokenB = s.tokenB as Address;
  const params = (await pc.readContract({ address: ADDR.tideParams, abi: tideParamsAbi, functionName: "params", args: [s.orderHash as Hex] })) as { owner: Address };
  if (params.owner === "0x0000000000000000000000000000000000000000") {
    await wait(
      await owner.writeContract({ address: ADDR.tideApp, abi: tideAppAbi, functionName: "init", args: [{ maker: me, tokenA, tokenB, salt: BigInt(s.salt) }, p.lambda, p.N, p.delta, p.fee, ADDR.agent] }),
      "TideApp.init",
    );
    await wait(await owner.writeContract({ address: ADDR.tideParams, abi: tideParamsAbi, functionName: "setBounds", args: [s.orderHash as Hex, p.bounds] }), "setBounds");
  }
  const [shipped] = (await pc.readContract({ address: ADDR.aqua, abi: aquaAbi, functionName: "rawBalances", args: [me, ADDR.tideRouter, s.orderHash as Hex, tokenA] })) as [bigint, number];
  if (shipped > 0n) {
    console.log(`  already shipped`);
    return;
  }
  const baseAmt = parseUnits(p.amounts.base, p.base.decimals);
  const quoteAmt = parseUnits(p.amounts.quote, p.quote.decimals);
  await ensureTokens(p.base, baseAmt);
  await ensureTokens(p.quote, quoteAmt);
  await ensureAllowance(p.base);
  await ensureAllowance(p.quote);
  const order = (await pc.readContract({ address: ADDR.tideApp, abi: tideAppAbi, functionName: "order", args: [{ maker: me, tokenA, tokenB, salt: BigInt(s.salt) }] })) as { maker: Address; traits: bigint; data: Hex };
  const encoded = encodeAbiParameters(ORDER_TUPLE, [{ maker: order.maker, traits: order.traits, data: order.data }]);
  const amounts = tokenA.toLowerCase() === p.base.address.toLowerCase() ? [baseAmt, quoteAmt] : [quoteAmt, baseAmt];
  await wait(await owner.writeContract({ address: ADDR.aqua, abi: aquaAbi, functionName: "ship", args: [ADDR.tideRouter, encoded, [tokenA, tokenB], amounts] }), `Aqua.ship ${p.amounts.base} ${p.base.symbol} + ${p.amounts.quote} ${p.quote.symbol}`);
  const dns = toHex(packetToBytes(s.name));
  const calls = GOVERNED_KEYS.map((k) =>
    encodeFunctionData({ abi: resolverAbi, functionName: "grantSetterRoles", args: [encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dns, k, ""] }), ADDR.agent] }),
  );
  await wait(await owner.writeContract({ address: s.resolver as Address, abi: resolverAbi, functionName: "multicall", args: [calls] }), "delegate lambda, N, delta to the manager");
}

async function publish(s: Strategy, input: PublicationInput) {
  const rows = (await api(`/api/strategy/${encodeURIComponent(s.name)}/sharing`)) as { kind: string; revision: number }[];
  const revision = rows.find((r) => r.kind === input.kind)?.revision ?? 0;
  const { ts, sig } = await sign(publicationAction(s.label, revision, input));
  await api(`/api/strategy/${encodeURIComponent(s.name)}/sharing`, { input, revision, ts, sig });
  console.log(`  published ${input.kind} "${input.title}" (revision ${revision + 1})`);
}

async function publishBoth(s: Strategy, meta: (typeof EXISTING)[string], config: TemplateConfig) {
  await publish(s, { kind: "strategy", published: true, title: meta.title, description: meta.description });
  await publish(s, { kind: "template", published: true, title: meta.templateTitle, description: meta.templateDescription, config });
}

async function main() {
  console.log(`owner ${me}, app ${base}`);
  for (const p of PRESETS) {
    const s = await createStrategy(p);
    await fundAndShip(p, s);
    await publishBoth(s, p, { lambda: p.lambda, N: p.N, delta: p.delta, fee: p.fee, bounds: p.bounds });
  }
  for (const [label, meta] of Object.entries(EXISTING)) {
    const s = await getStrategy(`${label}.${PARENT}`);
    if (!s || s.owner.toLowerCase() !== me.toLowerCase()) {
      console.log(`${label}: not one of the owner's strategies, skipped`);
      continue;
    }
    const rec = (await api(`/api/state?strategy=${encodeURIComponent(s.name)}`)) as { records: { lambda: number; N: number; delta: number; fee?: number }; onchain?: { fee?: number } };
    const fee = rec.onchain?.fee ?? rec.records.fee ?? 30;
    console.log(`${s.name}: records lambda ${rec.records.lambda} N ${rec.records.N} delta ${rec.records.delta} fee ${fee}`);
    await publishBoth(s, meta, { lambda: rec.records.lambda, N: rec.records.N, delta: rec.records.delta, fee, bounds: meta.bounds });
  }
  console.log("\ndone: open /app/explore");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FAIL", e);
    process.exit(1);
  });
