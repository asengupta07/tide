/**
 * The Tide manager agent, per strategy. Reads the activeness frontier, proposes lambda* for a realised
 * volatility, and, only after the strategy's owner completes a fresh World ID authentication, writes the
 * approved values to that strategy's ENS records (scoped role) and mirrors them to TideParams on Sepolia.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Address, Hex } from "viem";

import { publicClient, walletClient, readText, setTextCalldata, resolverAbi, canSetText } from "./ens/client";
import { GOVERNED_KEYS } from "./ens/config";
import { beginAuth, completeAuth, WorldAuthError, type AuthRequest } from "./world";
import { load, save, update, log, expireStale, type Proposal, type State } from "./store";
import { applyParams, readParams, maxDeltaBps } from "./tide";
import { getStrategy, listStrategies, type Strategy } from "./registry";

type Frontier = { kappa: number; fee: number; curves: { sigma: number; lambda_star: number; lambda_star_bps: number }[] };

export function frontier(): Frontier {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "..", "research", "frontier.json"), "utf8"));
}

/** lambda* for a realised volatility, linear interpolation between solved curves, rounded to 100 bps. */
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

export async function currentRecords(s: Strategy) {
  const pc = publicClient();
  const [lambda, N, delta, fee, strategyHash] = await Promise.all(["lambda", "N", "delta", "fee", "strategyHash"].map((k) => readText(pc, s.name, k)));
  return { name: s.name, lambda: Number(lambda), N: Number(N), delta: Number(delta), fee: fee ? Number(fee) : undefined, strategyHash: (strategyHash || s.orderHash) as Hex };
}

const BLOCK_SECONDS = 12;

/** One-block price move, sigma * sqrt(dt), in bps. About 3.7 bps at 60% annualised volatility. */
export function blockMoveBps(sigma: number) {
  return sigma * Math.sqrt(BLOCK_SECONDS / (365 * 86400)) * 1e4;
}

/**
 * delta* and the depth it fits. Target: three one-block moves, so an anchor set by a dust first fill sits
 * within noise of the true price and the deep curve gives a follower no edge. Cap: what the fee backs at
 * depth N, (N - 1) * delta <= 2 * fee. If the cap is below the target, lower N until it fits.
 */
export function deltaStar(sigma: number, feeBps: number, N: number): { N: number; delta: number } {
  const target = Math.max(1, Math.ceil(3 * blockMoveBps(sigma)));
  let n = Math.max(1, N);
  while (n > 1 && maxDeltaBps(n, feeBps) < target) n--;
  return { N: n, delta: n <= 1 ? target : Math.min(target, maxDeltaBps(n, feeBps)) };
}

/** The strategy's fee in bps: on-chain first, the ENS record as fallback. */
export async function strategyFee(s: Strategy, rec?: { fee?: number }): Promise<number> {
  const onchain = await readParams(publicClient(), s.orderHash).catch(() => null);
  return onchain?.fee ?? rec?.fee ?? 30;
}

/** Is the agent currently delegated on this strategy (all three keys)? */
export async function agentEnabled(s: Strategy) {
  const pc = publicClient();
  const agent = process.env.AGENT_ADDRESS as Address;
  const ok = await Promise.all(GOVERNED_KEYS.map((k) => canSetText(pc, s.resolver, k, agent).catch(() => false)));
  return ok.every(Boolean);
}

/** Create a proposal and start the step-up for the strategy's owner. Nothing is written yet. */
export async function propose(strategyName: string, sigma: number, overrides?: Partial<{ N: number; delta: number }>): Promise<Proposal> {
  const strat = getStrategy(strategyName);
  if (!strat) throw new Error(`unknown strategy ${strategyName}`);
  if (!(await agentEnabled(strat))) throw new Error("the manager agent is not enabled on this strategy");
  const rec = await currentRecords(strat);
  const fee = await strategyFee(strat, rec);
  const lambda = lambdaStar(sigma);
  const ds = deltaStar(sigma, fee, overrides?.N ?? rec.N);
  const N = overrides?.N ?? ds.N;
  const delta = overrides?.delta ?? Math.min(ds.delta, maxDeltaBps(N, fee));
  const to = { lambda, N, delta };
  const from = { lambda: rec.lambda, N: rec.N, delta: rec.delta };
  const direction = to.lambda < from.lambda ? "down" : to.lambda > from.lambda ? "up" : "unchanged";
  const reason =
    `realised volatility ${(sigma * 100).toFixed(0)}% -> frontier lambda* = ${(lambda / 100).toFixed(0)}%; ` +
    (direction === "down" ? "expose less inventory per block to cut LVR" : direction === "up" ? "expose more inventory per block; fee income outweighs LVR at this volatility" : "no change needed") +
    (to.delta !== from.delta || to.N !== from.N
      ? `; delta ${from.delta} -> ${to.delta} bps (three one-block moves of ${blockMoveBps(sigma).toFixed(1)} bps, capped at ${maxDeltaBps(N, fee)} bps by the ${fee} bp fee at ${N}x)`
      : "");

  const id = randomBytes(6).toString("hex");
  const { request, url } = await beginAuth("stepup", { proposalId: id, owner: strat.owner });
  const proposal: Proposal = { id, createdAt: Date.now(), strategy: strat.name, owner: strat.owner, from, to, reason, sigma, status: "pending", approvalUrl: url, authState: request.state };
  update((s) => {
    expireStale(s);
    s.authRequests[request.state] = request;
    s.proposals.unshift(proposal);
    log(s, "info", `proposal ${id} on ${strat.name}: lambda ${from.lambda} -> ${to.lambda} (${reason}); awaiting fresh World ID auth`, id, strat.name);
  });
  return proposal;
}

/** OIDC callback. Every non-approved outcome blocks the proposal and writes nothing. */
export async function handleCallback(query: URLSearchParams): Promise<{ purpose: AuthRequest["purpose"]; proposal?: Proposal; owner?: string; error?: string }> {
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
      log(s, "warn", `proposal ${proposal.id} blocked (${code}): ${msg}. Records unchanged.`, proposal.id, proposal.strategy);
    } else {
      log(s, "warn", `${req.purpose} failed (${code}): ${msg}`);
    }
    save(s);
    return { purpose: req.purpose, proposal, owner: req.owner, error: `${code}: ${msg}` };
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
    if (!req.owner) return fail("no_owner", "bind request without a wallet");
    s.bound[req.owner] = { ...identity, boundAt: Date.now() };
    log(s, "info", `owner ${req.owner.slice(0, 10)}… bound to World subject ${identity.subject.slice(0, 10)}…`);
    save(s);
    return { purpose: "bind", owner: req.owner };
  }

  if (!proposal) return fail("no_proposal", "step-up without a proposal");
  if (proposal.status !== "pending") return fail("not_pending", `proposal is ${proposal.status}`);
  const bound = s.bound[proposal.owner.toLowerCase()];
  if (!bound) return fail("not_bound", "the strategy owner has not bound a World ID yet");
  if (bound.subject !== identity.subject || bound.issuer !== identity.issuer) return fail("wrong_subject", "the authenticated human is not the strategy owner");

  proposal.status = "approved";
  proposal.decidedAt = Date.now();
  log(s, "info", `proposal ${proposal.id} approved by the bound owner (auth_time ${identity.authTime}); writing records`, proposal.id, proposal.strategy);
  save(s);

  try {
    const txs = await writeApproved(proposal);
    update((st) => {
      const p = st.proposals.find((x) => x.id === proposal.id)!;
      p.status = "applied";
      p.txs = txs;
      log(st, "info", `proposal ${p.id} applied: ENS ${txs.ens}, TideParams ${txs.params}`, p.id, p.strategy);
    });
    proposal.status = "applied";
    proposal.txs = txs;
  } catch (e) {
    update((st) => {
      const p = st.proposals.find((x) => x.id === proposal.id)!;
      p.status = "failed";
      p.blockedReason = (e as Error).message;
      log(st, "error", `proposal ${p.id} write failed: ${(e as Error).message}`, p.id, p.strategy);
    });
    proposal.status = "failed";
  }
  return { purpose: "stepup", proposal, owner: req.owner };
}

/** The protected action. Only reachable from an approved, fresh, bound step-up. */
async function writeApproved(p: Proposal) {
  const agentKey = process.env.AGENT_PRIVATE_KEY;
  if (!agentKey) throw new Error("AGENT_PRIVATE_KEY missing");
  const strat = getStrategy(p.strategy);
  if (!strat) throw new Error("strategy vanished");
  const pc = publicClient();
  const wc = walletClient(agentKey);
  const values: Record<(typeof GOVERNED_KEYS)[number], string> = { lambda: String(p.to.lambda), N: String(p.to.N), delta: String(p.to.delta) };
  const calls = GOVERNED_KEYS.map((k) => setTextCalldata(p.strategy, k, values[k]));
  const ens = await wc.writeContract({ address: strat.resolver, abi: resolverAbi, functionName: "multicall", args: [calls], chain: wc.chain, account: wc.account });
  await pc.waitForTransactionReceipt({ hash: ens });
  const params = await applyParams(agentKey, strat.orderHash, p.to.lambda, p.to.N, p.to.delta);
  await pc.waitForTransactionReceipt({ hash: params });
  return { ens, params };
}

/** Everything the dashboard needs for one strategy. */
export async function snapshot(strategyName?: string) {
  const all = listStrategies();
  const strat = strategyName ? getStrategy(strategyName) : all[0];
  if (!strat) throw new Error("no strategies yet");
  const s = update((st) => {
    expireStale(st);
    return st;
  });
  const pc = publicClient();
  const [records, onchain, enabled] = await Promise.all([
    currentRecords(strat),
    readParams(pc, strat.orderHash).catch(() => null),
    agentEnabled(strat),
  ]);
  const bound = s.bound[strat.owner.toLowerCase()];
  return {
    strategy: strat,
    records,
    onchain,
    agentEnabled: enabled,
    bound: bound ? { subject: bound.subject.slice(0, 12) + "…", issuer: bound.issuer, boundAt: bound.boundAt } : null,
    proposals: s.proposals.filter((p) => p.strategy === strat.name),
    log: s.log.filter((l) => !l.strategy || l.strategy === strat.name),
  };
}

export type Snapshot = Awaited<ReturnType<typeof snapshot>>;
export type { State };
