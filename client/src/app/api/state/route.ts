import { NextResponse } from "next/server";
import { snapshot } from "@/lib/agent";
import { publicClient } from "@/lib/ens/client";
import { blockState, fills, deployment } from "@/lib/tide";

export const dynamic = "force-dynamic";

/** Last good payload per strategy, served with `stale: true` when an RPC read fails. */
const cache = new Map<string, unknown>();

/** Full dashboard state for one strategy (`?strategy=<name>`), default the first registered one. */
export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("strategy") ?? "";
  try {
    const s = await snapshot(name || undefined);
    const pc = publicClient();
    const st = s.strategy;
    const [block, swaps] = await Promise.all([
      blockState(pc, st.orderHash, st.owner, { tokenA: st.tokenA, tokenB: st.tokenB }).catch(() => null),
      fills(pc, st.orderHash).catch(() => []),
    ]);
    // approvalUrl carries the OIDC state; only the owner may fetch it (signed, /api/agent/approval)
    const proposals = s.proposals.map(({ approvalUrl: _u, authState: _a, ...p }) => ({ ...p, needsApproval: !!_u && p.status === "pending" }));
    const payload = { ...s, proposals, block, fills: swaps, deployment: deployment(), agent: process.env.AGENT_ADDRESS, stale: false };
    cache.set(name, payload);
    return NextResponse.json(payload);
  } catch (e) {
    const last = cache.get(name);
    if (last) return NextResponse.json({ ...(last as object), stale: true });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
