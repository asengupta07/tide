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
import { insertProposal, getProposal, updateProposal, listProposals, putAuthRequest, takeAuthRequest, getBound, setBound, appendLog, listLog, expireStale, type Proposal } from "./store";
import { applyParams, readParams, readBounds, withinBounds, maxDeltaBps } from "./tide";
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
  const strat = await getStrategy(strategyName);
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
  let reason =
    `realised volatility ${(sigma * 100).toFixed(0)}% -> frontier lambda* = ${(lambda / 100).toFixed(0)}%; ` +
    (direction === "down" ? "expose less inventory per block to cut LVR" : direction === "up" ? "expose more inventory per block; fee income outweighs LVR at this volatility" : "no change needed") +
    (to.delta !== from.delta || to.N !== from.N
      ? `; delta ${from.delta} -> ${to.delta} bps (three one-block moves of ${blockMoveBps(sigma).toFixed(1)} bps, capped at ${maxDeltaBps(N, fee)} bps by the ${fee} bp fee at ${N}x)`
      : "");

  // Inside the owner's guardrails the manager applies on its own. Outside them the owner must say yes,
  // fresh, as a human (World ID), and then apply with the wallet, since the contract refuses the manager.
  const wb = await withinBounds(publicClient(), strat.orderHash, to.lambda, to.N);
  if (wb.ok) {
    const autoId = randomBytes(6).toString("hex");
    const auto: Proposal = { id: autoId, createdAt: Date.now(), strategy: strat.name, owner: strat.owner, from, to, reason: `${reason}; inside the owner's guardrails`, sigma, status: "applied", auto: true };
    await expireStale();
    await insertProposal(auto);
    await appendLog("info", `proposal ${autoId} on ${strat.name}: lambda ${from.lambda} -> ${to.lambda}, delta ${from.delta} -> ${to.delta}; inside guardrails, applying`, autoId, strat.name);
    try {
      const txs = await writeApproved(auto);
      const status: Proposal["status"] = txs.params ? "applied" : "failed";
      await updateProposal(autoId, { txs: { ens: txs.ens, params: txs.params }, decidedAt: Date.now(), status, blockedReason: txs.params ? undefined : txs.outside });
      await appendLog(txs.params ? "info" : "error", txs.params ? `proposal ${autoId} applied by the manager: ENS ${txs.ens}, TideParams ${txs.params}` : `proposal ${autoId}: guardrails moved under us (${txs.outside})`, autoId, strat.name);
      return { ...auto, status, txs };
    } catch (e) {
      await updateProposal(autoId, { status: "failed", blockedReason: (e as Error).message });
      await appendLog("error", `proposal ${autoId} manager write failed: ${(e as Error).message}`, autoId, strat.name);
      throw e;
    }
  }
  reason += `; outside the owner's guardrails (${wb.why}), needs the owner`;

  const id = randomBytes(6).toString("hex");
  const { request, url } = await beginAuth("stepup", { proposalId: id, owner: strat.owner });
  const proposal: Proposal = { id, createdAt: Date.now(), strategy: strat.name, owner: strat.owner, from, to, reason, sigma, status: "pending", approvalUrl: url, authState: request.state, outside: wb.why };
  await expireStale();
  await putAuthRequest(request);
  await insertProposal(proposal);
  await appendLog("info", `proposal ${id} on ${strat.name}: lambda ${from.lambda} -> ${to.lambda} (${reason}); awaiting fresh World ID auth`, id, strat.name);
  return proposal;
}

/** OIDC callback. Every non-approved outcome blocks the proposal and writes nothing. */
export async function handleCallback(query: URLSearchParams): Promise<{ purpose: AuthRequest["purpose"]; proposal?: Proposal; owner?: string; error?: string }> {
  const state = query.get("state") ?? "";
  await expireStale();
  const req = await takeAuthRequest(state);
  if (!req) return { purpose: "stepup", error: "unknown state" };
  const proposal = req.proposalId ? await getProposal(req.proposalId) : null;

  const fail = async (code: string, msg: string) => {
    if (proposal && proposal.status === "pending") {
      proposal.status = "blocked";
      proposal.decidedAt = Date.now();
      proposal.blockedReason = `${code}: ${msg}`;
      await updateProposal(proposal.id, { status: "blocked", decidedAt: proposal.decidedAt, blockedReason: proposal.blockedReason });
      await appendLog("warn", `proposal ${proposal.id} blocked (${code}): ${msg}. Records unchanged.`, proposal.id, proposal.strategy);
    } else {
      await appendLog("warn", `${req.purpose} failed (${code}): ${msg}`);
    }
    return { purpose: req.purpose, proposal: proposal ?? undefined, owner: req.owner, error: `${code}: ${msg}` };
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
    await setBound(req.owner, identity);
    await appendLog("info", `owner ${req.owner.slice(0, 10)}… bound to World subject ${identity.subject.slice(0, 10)}…`);
    return { purpose: "bind", owner: req.owner };
  }

  if (!proposal) return fail("no_proposal", "step-up without a proposal");
  if (proposal.status !== "pending") return fail("not_pending", `proposal is ${proposal.status}`);
  const bound = await getBound(proposal.owner);
  if (!bound) return fail("not_bound", "the strategy owner has not bound a World ID yet");
  if (bound.subject !== identity.subject || bound.issuer !== identity.issuer) return fail("wrong_subject", "the authenticated human is not the strategy owner");

  proposal.status = "approved";
  proposal.decidedAt = Date.now();
  await updateProposal(proposal.id, { status: "approved", decidedAt: proposal.decidedAt });
  await appendLog("info", `proposal ${proposal.id} approved by the bound owner (auth_time ${identity.authTime}); writing records`, proposal.id, proposal.strategy);

  try {
    const txs = await writeApproved(proposal);
    const patch: Partial<Proposal> = txs.params
      ? { status: "applied", txs: { ens: txs.ens, params: txs.params } }
      : { status: "approved", txs: { ens: txs.ens }, outside: txs.outside };
    await updateProposal(proposal.id, patch);
    await appendLog("info", txs.params ? `proposal ${proposal.id} applied: ENS ${txs.ens}, TideParams ${txs.params}` : `proposal ${proposal.id}: records written (ENS ${txs.ens}); ${txs.outside}, so the owner's wallet applies it on-chain`, proposal.id, proposal.strategy);
    Object.assign(proposal, patch);
  } catch (e) {
    await updateProposal(proposal.id, { status: "failed", blockedReason: (e as Error).message });
    await appendLog("error", `proposal ${proposal.id} write failed: ${(e as Error).message}`, proposal.id, proposal.strategy);
    proposal.status = "failed";
  }
  return { purpose: "stepup", proposal, owner: req.owner };
}

/** The protected action. Only reachable from an approved, fresh, bound step-up. */
async function writeApproved(p: Proposal) {
  const agentKey = process.env.AGENT_PRIVATE_KEY;
  if (!agentKey) throw new Error("AGENT_PRIVATE_KEY missing");
  const strat = await getStrategy(p.strategy);
  if (!strat) throw new Error("strategy vanished");
  const pc = publicClient();
  const wc = walletClient(agentKey);
  const values: Record<(typeof GOVERNED_KEYS)[number], string> = { lambda: String(p.to.lambda), N: String(p.to.N), delta: String(p.to.delta) };
  const calls = GOVERNED_KEYS.map((k) => setTextCalldata(p.strategy, k, values[k]));
  const ens = await wc.writeContract({ address: strat.resolver, abi: resolverAbi, functionName: "multicall", args: [calls], chain: wc.chain, account: wc.account });
  await pc.waitForTransactionReceipt({ hash: ens });
  // The contract refuses a manager write outside the owner's guardrails; check first, no gas wasted.
  const wb = await withinBounds(pc, strat.orderHash, p.to.lambda, p.to.N);
  if (!wb.ok) return { ens, outside: wb.why } as { ens: Hex; params?: Hex; outside?: string };
  const params = await applyParams(agentKey, strat.orderHash, p.to.lambda, p.to.N, p.to.delta);
  await pc.waitForTransactionReceipt({ hash: params });
  return { ens, params } as { ens: Hex; params?: Hex; outside?: string };
}

/** After the owner applied an out-of-bounds change with their own wallet: confirm on-chain, then mark it. */
export async function markApplied(id: string, tx: Hex) {
  const pc = publicClient();
  const p = await getProposal(id);
  if (!p) throw new Error("unknown proposal");
  const strat = await getStrategy(p.strategy);
  if (!strat) throw new Error("strategy vanished");
  await pc.waitForTransactionReceipt({ hash: tx });
  const on = await readParams(pc, strat.orderHash);
  if (on.lambda !== p.to.lambda || on.N !== p.to.N || on.delta !== p.to.delta) throw new Error("on-chain values do not match the proposal");
  await updateProposal(id, { status: "applied", txs: { ...(p.txs ?? {}), params: tx }, decidedAt: Date.now() });
  await appendLog("info", `proposal ${id} applied on-chain by the owner: ${tx}`, id, p.strategy);
}

/** Everything the dashboard needs for one strategy. */
export async function snapshot(strategyName?: string) {
  const all = await listStrategies();
  const strat = strategyName ? await getStrategy(strategyName) : all[0];
  if (!strat) throw new Error("no strategies yet");
  await expireStale();
  const pc = publicClient();
  const [records, onchain, enabled, bounds, bound, proposals, logEntries] = await Promise.all([
    currentRecords(strat),
    readParams(pc, strat.orderHash).catch(() => null),
    agentEnabled(strat),
    readBounds(pc, strat.orderHash).catch(() => null),
    getBound(strat.owner),
    listProposals(strat.name),
    listLog(strat.name),
  ]);
  return {
    strategy: strat,
    records,
    onchain,
    bounds,
    agentEnabled: enabled,
    bound: bound ? { subject: bound.subject.slice(0, 12) + "…", issuer: bound.issuer, boundAt: bound.boundAt } : null,
    proposals,
    log: logEntries,
  };
}

export type Snapshot = Awaited<ReturnType<typeof snapshot>>;
