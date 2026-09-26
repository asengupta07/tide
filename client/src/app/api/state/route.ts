import { NextResponse } from "next/server";
import { snapshot } from "@/lib/agent";
import { publicClient } from "@/lib/ens/client";
import { blockState, fills, deployment } from "@/lib/tide";

export const dynamic = "force-dynamic";

/** Full dashboard state for one strategy (`?strategy=<name>`), default the first registered one. */
export async function GET(req: Request) {
  try {
    const name = new URL(req.url).searchParams.get("strategy") ?? undefined;
    const s = await snapshot(name);
    const pc = publicClient();
    const st = s.strategy;
    const [block, swaps] = await Promise.all([
      blockState(pc, st.orderHash, st.owner, { tokenA: st.tokenA, tokenB: st.tokenB }).catch(() => null),
      fills(pc, st.orderHash).catch(() => []),
    ]);
    return NextResponse.json({ ...s, block, fills: swaps, deployment: deployment(), agent: process.env.AGENT_ADDRESS });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
