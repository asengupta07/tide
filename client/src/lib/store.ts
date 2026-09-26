/**
 * Off-chain state of the manager agent, in MongoDB: proposals, pending OIDC requests, World ID bindings and
 * the log. Everything a strategy *is* lives on-chain (ENS records, TideParams, Aqua balances, router events);
 * this is the agent's working memory and the audit trail of its requests.
 */
import type { AuthRequest, VerifiedIdentity } from "./world";
import { col, clean } from "./db";

export type ProposalStatus = "pending" | "approved" | "applied" | "blocked" | "expired" | "failed";

export type Proposal = {
  id: string;
  createdAt: number;
  strategy: string; // ENS name
  owner: string; // wallet that must approve
  from: { lambda: number; N: number; delta: number };
  to: { lambda: number; N: number; delta: number };
  reason: string;
  sigma: number;
  status: ProposalStatus;
  approvalUrl?: string;
  authState?: string;
  decidedAt?: number;
  blockedReason?: string;
  txs?: { ens?: string; params?: string };
  auto?: boolean; // applied by the manager on its own, inside the owner's guardrails
  outside?: string; // why the manager could not apply it (guardrail that failed)
};

export type LogEntry = { at: number; level: "info" | "warn" | "error"; msg: string; proposalId?: string; strategy?: string };
export type Bound = VerifiedIdentity & { owner: string; boundAt: number };

const proposals = () => col<Proposal>("proposals");
const authRequests = () => col<AuthRequest & { expiresAt: Date }>("authRequests");
const bound = () => col<Bound>("bound");
const logs = () => col<LogEntry>("log");

// ---- proposals -------------------------------------------------------------------------------------
export async function insertProposal(p: Proposal) {
  await (await proposals()).insertOne({ ...p });
}

export async function getProposal(id: string): Promise<Proposal | null> {
  return clean(await (await proposals()).findOne({ id }));
}

/** $set the defined fields of `patch`; undefined values are left untouched. */
export async function updateProposal(id: string, patch: Partial<Proposal>) {
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  await (await proposals()).updateOne({ id }, { $set: set });
}

export async function listProposals(strategy?: string, limit = 100): Promise<Proposal[]> {
  return (await proposals()).find(strategy ? { strategy } : {}, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function hasPending(strategy: string) {
  return !!(await (await proposals()).findOne({ strategy, status: "pending" }, { projection: { _id: 1 } }));
}

// ---- OIDC requests (one shot; the TTL index sweeps abandoned ones after an hour) ----------------------
export async function putAuthRequest(req: AuthRequest) {
  await (await authRequests()).insertOne({ ...req, expiresAt: new Date(Date.now() + 60 * 60_000) });
}

/** Return and delete the request for `state`, so a callback can only be used once. */
export async function takeAuthRequest(state: string): Promise<AuthRequest | null> {
  const doc = await (await authRequests()).findOneAndDelete({ state });
  if (!doc) return null;
  const { _id: _a, expiresAt: _b, ...req } = doc;
  void _a;
  void _b;
  return req as AuthRequest;
}

// ---- World ID bindings ------------------------------------------------------------------------------
export async function getBound(owner: string): Promise<Bound | null> {
  return clean(await (await bound()).findOne({ owner: owner.toLowerCase() }));
}

export async function setBound(owner: string, identity: VerifiedIdentity) {
  const o = owner.toLowerCase();
  await (await bound()).updateOne({ owner: o }, { $set: { ...identity, owner: o, boundAt: Date.now() } }, { upsert: true });
}

// ---- log --------------------------------------------------------------------------------------------
export async function appendLog(level: LogEntry["level"], msg: string, proposalId?: string, strategy?: string) {
  const entry: LogEntry = { at: Date.now(), level, msg };
  if (proposalId) entry.proposalId = proposalId;
  if (strategy) entry.strategy = strategy;
  await (await logs()).insertOne(entry);
}

/** Newest first. With a strategy: that strategy's entries plus the global ones. */
export async function listLog(strategy?: string, limit = 300): Promise<LogEntry[]> {
  const q = strategy ? { $or: [{ strategy }, { strategy: { $exists: false } }] } : {};
  return (await logs()).find(q, { projection: { _id: 0 } }).sort({ at: -1 }).limit(limit).toArray();
}

/** When the manager last ran its check, from the log, so a fresh process knows without keeping state. */
export async function lastCheckAt(): Promise<number | null> {
  const row = await (await logs()).findOne({ msg: { $regex: "^manager check" } }, { projection: { at: 1 }, sort: { at: -1 } });
  return row?.at ?? null;
}

// ---- housekeeping -----------------------------------------------------------------------------------
export const approvalTimeoutMs = () => Number(process.env.WORLD_APPROVAL_TIMEOUT_SECONDS ?? "180") * 1000;

/** Pending proposals whose approval window elapsed become `expired`; nothing was written for them. */
export async function expireStale() {
  const cutoff = Date.now() - approvalTimeoutMs();
  const stale = await (await proposals()).find({ status: "pending", createdAt: { $lt: cutoff } }, { projection: { _id: 0 } }).toArray();
  for (const p of stale) {
    await updateProposal(p.id, { status: "expired", decidedAt: Date.now(), blockedReason: "approval window elapsed, no fresh authentication received" });
    await appendLog("warn", `proposal ${p.id} blocked: timed out waiting for the owner`, p.id, p.strategy);
  }
}
