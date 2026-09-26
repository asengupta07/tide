import { NextResponse } from "next/server";
import { tick } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/** Run the manager's market check now. Operator-only: `x-tide-secret` must match AGENT_TICK_SECRET. */
export async function POST(req: Request) {
  const secret = process.env.AGENT_TICK_SECRET;
  if (!secret || req.headers.get("x-tide-secret") !== secret) return NextResponse.json({ error: "operator secret required" }, { status: 401 });
  return NextResponse.json({ result: await tick("manual") });
}
