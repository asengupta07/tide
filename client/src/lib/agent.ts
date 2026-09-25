/**
 * The Tide manager agent: reads the activeness frontier (research/frontier.json, produced by
 * research/frontier.py), proposes lambda* for the current realised volatility, and, only after the owner
 * completes a fresh World ID authentication, writes the approved values to the strategy's ENSv2 records
 * (its scoped EAC role allows exactly lambda, N and delta) and mirrors them to TideParams on Sepolia.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";

import { publicClient, walletClient, readText, setTextCalldata, resolverAbi, findResolver } from "./ens/client";
import { GOVERNED_KEYS } from "./ens/config";
import { beginAuth, completeAuth, WorldAuthError, type AuthRequest } from "./world";
import { load, save, update, log, expireStale, type Proposal, type State } from "./store";
import { applyParams, readParams } from "./tide";

type Frontier = { kappa: number; fee: number; curves: { sigma: number; lambda_star: number; lambda_star_bps: number }[] };

export function frontier(): Frontier {
  const p = path.join(process.cwd(), "..", "research", "frontier.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** lambda* for a realised volatility, linear interpolation between the solved curves. */
export function lambdaStar(sigma: number): number {
  const curves = [...frontier().curves].sort((a, b) => a.sigma - b.sigma);
  if (sigma <= curves[0].sigma) return curves[0].lambda_star_bps;
  if (sigma >= curves[curves.length - 1].sigma) return curves[curves.length - 1].lambda_star_bps;
  for (let i = 0; i < curves.length - 1; i++) {
    const a = curves[i], b = curves[i + 1];
    if (sigma >= a.sigma && sigma <= b.sigma) {
      const t = (sigma - a.sigma) / (b.sigma - a.sigma);
      return Math.round((a.lambda_star_bps + t * (b.lambda_star_bps - a.lambda_star_bps)) / 100) * 100;
    }
  }
  return curves[curves.length - 1].lambda_star_bps;
}

export function strategyName() {
  return `${process.env.ENS_STRATEGY_LABEL ?? "eth-usdc"}.${process.env.ENS_PARENT_NAME ?? "tide.eth"}`;
}

export async function currentRecords() {
  const pc = publicClient();
  const name = strategyName();
  const [lambda, N, delta, strategyHash] = await Promise.all(
    ["lambda", "N", "delta", "strategyHash"].map((k) => readText(pc, name, k)),
  );
  return { name, lambda: Number(lambda), N: Number(N), delta: Number(delta), strategyHash: strategyHash as Hex };
}

/**
 * Create a proposal from the frontier and start the World ID step-up. Returns the proposal with the URL
 * the owner must open. Nothing is written yet.
 */
export async function propose(sigma: number, overrides?: Partial<{ N: number; delta: number }>): Promise<Proposal> {
  const rec = await currentRecords();
  const lambda = lambdaStar(sigma);
  const to = { lambda, N: overrides?.N ?? rec.N, delta: overrides?.delta ?? rec.delta };
  const from = { lambda: rec.lambda, N: rec.N, delta: rec.delta };
  const direction = to.lambda < from.lambda ? "down" : to.lambda > from.lambda ? "up" : "unchanged";
  const reason =
    `realised volatility ${(sigma * 100).toFixed(0)}% -> frontier lambda* = ${(lambda / 100).toFixed(0)}%; ` +
    (direction === "down"
      ? "expose less inventory per block to cut LVR"
      : direction === "up"
        ? "expose more inventory per block; fee income outweighs LVR at this volatility"
        : "no change needed");

  const id = randomBytes(6).toString("hex");
  const { request, url } = await beginAuth("stepup", id);
  const proposal: Proposal = {
    id,
    createdAt: Date.now(),
    strategy: rec.name,
    from,
    to,
    reason,
    sigma,
    status: "pending",
    approvalUrl: url,
    authState: request.state,
  };
  update((s) => {
    expireStale(s);
    s.authRequests[request.state] = request;
    s.proposals.unshift(proposal);
    log(s, "info", `proposal ${id}: lambda ${from.lambda} -> ${to.lambda} (${reason}); awaiting fresh World ID auth`, id);
  });
  return proposal;
}

/**
 * OIDC callback. Denied / cancelled / expired / invalid -> the proposal is blocked and no write happens.
 * Approved and fresh and bound -> the agent writes ENS records then mirrors to TideParams.
 */
export async function handleCallback(query: URLSearchParams): Promise<{ purpose: AuthRequest["purpose"]; proposal?: Proposal; error?: string }> {
  const state = query.get("state") ?? "";
  const s = load();
  expireStale(s);
  const req = s.authRequests[state];
  if (!req) {
    save(s);
    return { purpose: "stepup", error: "unknown state" };
  }
  delete s.authRequests[state];
  const proposal = req.proposalId ? s.proposals.find((p) => p.id === req.proposalId) : undefined;

  const fail = (code: string, msg: string) => {
    if (proposal && proposal.status === "pending") {
      proposal.status = "blocked";
      proposal.decidedAt = Date.now();
      proposal.blockedReason = `${code}: ${msg}`;
      log(s, "warn", `proposal ${proposal.id} blocked (${code}): ${msg}. Records unchanged.`, proposal.id);
    } else {
      log(s, "warn", `${req.purpose} failed (${code}): ${msg}`);
    }
    save(s);
    return { purpose: req.purpose, proposal, error: `${code}: ${msg}` };
  };

  const oidcError = query.get("error");
  if (oidcError) return fail(oidcError, query.get("error_description") ?? "the owner did not complete authentication");
  const code = query.get("code");
  if (!code) return fail("no_code", "authorization response had no code");

  let identity;
  try {
    identity = await completeAuth(req, code);
  } catch (e) {
    const err = e as WorldAuthError;
    return fail(err.code ?? "auth", err.message);
  }

  if (req.purpose === "bind") {
    s.bound = { ...identity, boundAt: Date.now() };
    log(s, "info", `owner bound: pairwise subject ${identity.subject.slice(0, 10)}… from ${identity.issuer}`);
    save(s);
    return { purpose: "bind" };
  }

  if (!proposal) return fail("no_proposal", "step-up without a proposal");
  if (proposal.status !== "pending") return fail("not_pending", `proposal is ${proposal.status}`);
  if (!s.bound) return fail("not_bound", "no owner is bound to the agent yet");
  if (s.bound.subject !== identity.subject || s.bound.issuer !== identity.issuer) {
    return fail("wrong_subject", "the authenticated human is not the bound owner");
  }

  proposal.status = "approved";
  proposal.decidedAt = Date.now();
  log(s, "info", `proposal ${proposal.id} approved by the bound owner (auth_time ${identity.authTime}); writing records`, proposal.id);
  save(s);

  try {
    const txs = await writeApproved(proposal);
    update((st) => {
      const p = st.proposals.find((x) => x.id === proposal.id)!;
      p.status = "applied";
      p.txs = txs;
      log(st, "info", `proposal ${p.id} applied: ENS ${txs.ens}, TideParams ${txs.params}`, p.id);
    });
    proposal.status = "applied";
    proposal.txs = txs;
  } catch (e) {
    update((st) => {
      const p = st.proposals.find((x) => x.id === proposal.id)!;
      p.status = "failed";
      p.blockedReason = (e as Error).message;
      log(st, "error", `proposal ${p.id} write failed: ${(e as Error).message}`, p.id);
    });
    proposal.status = "failed";
  }
  return { purpose: "stepup", proposal };
}

/** The protected action. Only reachable from an approved, fresh, bound step-up. */
async function writeApproved(p: Proposal) {
  const agentKey = process.env.AGENT_PRIVATE_KEY;
  if (!agentKey) throw new Error("AGENT_PRIVATE_KEY missing");
  const pc = publicClient();
  const wc = walletClient(agentKey);
  const resolver = await findResolver(pc, p.strategy);
  const values: Record<(typeof GOVERNED_KEYS)[number], string> = { lambda: String(p.to.lambda), N: String(p.to.N), delta: String(p.to.delta) };
  const calls = GOVERNED_KEYS.map((k) => setTextCalldata(p.strategy, k, values[k]));
  const ens = await wc.writeContract({ address: resolver as Address, abi: resolverAbi, functionName: "multicall", args: [calls], chain: wc.chain, account: wc.account });
  await pc.waitForTransactionReceipt({ hash: ens });

  const strategyHash = (await readText(pc, p.strategy, "strategyHash")) as Hex;
  const params = await applyParams(agentKey, strategyHash, p.to.lambda, p.to.N, p.to.delta);
  await pc.waitForTransactionReceipt({ hash: params });
  return { ens, params };
}

export async function snapshot(): Promise<State & { records: Awaited<ReturnType<typeof currentRecords>>; onchain: Awaited<ReturnType<typeof readParams>> | null }> {
  const s = update((st) => {
    expireStale(st);
    return st;
  });
  const records = await currentRecords();
  const onchain = await readParams(publicClient(), records.strategyHash).catch(() => null);
  const { authRequests: _hidden, ...pub } = s;
  return { ...pub, authRequests: {}, records, onchain };
}
