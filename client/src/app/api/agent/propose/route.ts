import { NextResponse } from "next/server";
import { z } from "zod";
import { propose } from "@/lib/agent";
import { getStrategy } from "@/lib/registry";
import { requireOwner, OwnerAuthError, safeError } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  strategy: z.string(),
  sigma: z.number().min(0.01).max(5),
  N: z.number().int().min(1).max(64).optional(),
  delta: z.number().int().min(0).max(4999).optional(),
  ts: z.number(),
  sig: z.string(),
});

/**
 * The owner asks the manager for a change at a given volatility. Owner-signed: inside the guardrails the
 * manager applies at once with its own key, so this must not be callable by strangers.
 */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const strat = await getStrategy(body.strategy);
    if (!strat) return NextResponse.json({ error: "unknown strategy" }, { status: 404 });
    await requireOwner(strat.owner, `ask the manager on ${strat.name}`, body.ts, body.sig);
    const p = await propose(strat.name, body.sigma, { N: body.N, delta: body.delta });
    return NextResponse.json(p);
  } catch (e) {
    const status = e instanceof OwnerAuthError ? 401 : 400;
    return NextResponse.json({ error: safeError(e) }, { status });
  }
}
