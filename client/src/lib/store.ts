/**
 * Tiny JSON file store for the demo backend: bound owner identity, pending auth requests, proposals and
 * the agent log. Lives in client/data/state.json (git-ignored). Single-process, synchronous, good enough
 * for a hackathon backend; swap for a database if this ever leaves the demo.
 */
import fs from "node:fs";
import path from "node:path";
import type { AuthRequest, VerifiedIdentity } from "./world";

export type ProposalStatus = "pending" | "approved" | "applied" | "blocked" | "expired" | "failed";

export type Proposal = {
  id: string;
  createdAt: number;
  strategy: string; // ENS name
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
};

export type LogEntry = { at: number; level: "info" | "warn" | "error"; msg: string; proposalId?: string };

export type State = {
  bound?: VerifiedIdentity & { boundAt: number };
  authRequests: Record<string, AuthRequest>;
  proposals: Proposal[];
  log: LogEntry[];
};

const FILE = path.join(process.cwd(), "data", "state.json");

export function load(): State {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as State;
  } catch {
    return { authRequests: {}, proposals: [], log: [] };
  }
}

export function save(state: State) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
}

export function update<T>(fn: (s: State) => T): T {
  const s = load();
  const r = fn(s);
  save(s);
  return r;
}

export function log(state: State, level: LogEntry["level"], msg: string, proposalId?: string) {
  state.log.unshift({ at: Date.now(), level, msg, proposalId });
  state.log = state.log.slice(0, 200);
}

/** Proposals waiting for approval longer than the timeout are expired: nothing is written. */
export const approvalTimeoutMs = () => Number(process.env.WORLD_APPROVAL_TIMEOUT_SECONDS ?? "180") * 1000;

export function expireStale(state: State) {
  const now = Date.now();
  for (const p of state.proposals) {
    if (p.status === "pending" && now - p.createdAt > approvalTimeoutMs()) {
      p.status = "expired";
      p.decidedAt = now;
      p.blockedReason = "approval window elapsed, no fresh authentication received";
      log(state, "warn", `proposal ${p.id} blocked: timed out waiting for the owner`, p.id);
    }
  }
}
