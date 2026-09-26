/**
 * JSON file store for the backend: bound owner identities (per wallet), pending auth requests, proposals
 * and the agent log. client/data/state.json, git-ignored. Single process; fine for the demo.
 */
import fs from "node:fs";
import path from "node:path";
import type { AuthRequest, VerifiedIdentity } from "./world";

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

export type State = {
  /** lowercased owner wallet -> bound World identity */
  bound: Record<string, VerifiedIdentity & { boundAt: number }>;
  authRequests: Record<string, AuthRequest>;
  proposals: Proposal[];
  log: LogEntry[];
};

const FILE = path.join(process.cwd(), "data", "state.json");

export function load(): State {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<State> & { bound?: unknown };
    // migrate the single-owner shape
    const bound = s.bound && typeof s.bound === "object" && "subject" in (s.bound as object)
      ? { [(process.env.OWNER_ADDRESS ?? "").toLowerCase()]: s.bound as unknown as State["bound"][string] }
      : ((s.bound as State["bound"]) ?? {});
    return { bound, authRequests: s.authRequests ?? {}, proposals: s.proposals ?? [], log: s.log ?? [] };
  } catch {
    return { bound: {}, authRequests: {}, proposals: [], log: [] };
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

export function log(state: State, level: LogEntry["level"], msg: string, proposalId?: string, strategy?: string) {
  state.log.unshift({ at: Date.now(), level, msg, proposalId, strategy });
  state.log = state.log.slice(0, 300);
}

export const approvalTimeoutMs = () => Number(process.env.WORLD_APPROVAL_TIMEOUT_SECONDS ?? "180") * 1000;

export function expireStale(state: State) {
  const now = Date.now();
  for (const p of state.proposals) {
    if (p.status === "pending" && now - p.createdAt > approvalTimeoutMs()) {
      p.status = "expired";
      p.decidedAt = now;
      p.blockedReason = "approval window elapsed, no fresh authentication received";
      log(state, "warn", `proposal ${p.id} blocked: timed out waiting for the owner`, p.id, p.strategy);
    }
  }
}
