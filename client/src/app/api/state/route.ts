import { NextResponse } from "next/server";
import { snapshot } from "@/lib/agent";
import { publicClient } from "@/lib/ens/client";
import { blockState, fills, deployment } from "@/lib/tide";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await snapshot();
    const pc = publicClient();
    const owner = s.onchain?.owner;
    const [state, swaps] = await Promise.all([
      owner ? blockState(pc, s.records.strategyHash, owner).catch(() => null) : null,
      fills(pc, s.records.strategyHash).catch(() => []),
    ]);
    return NextResponse.json({ ...s, block: state, fills: swaps, deployment: deployment(), agent: process.env.AGENT_ADDRESS, bound: s.bound ? { subject: s.bound.subject.slice(0, 12) + "…", issuer: s.bound.issuer, boundAt: s.bound.boundAt } : null });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
