import { NextResponse } from "next/server";
import { tick } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/**
 * Run the manager's market check now. Operator-only. Two callers:
 *   - an operator: POST with `x-tide-secret: $AGENT_TICK_SECRET`
 *   - Vercel Cron (vercel.json, every 15 min): GET with `Authorization: Bearer $CRON_SECRET`
 * On a long-lived host the in-process scheduler (instrumentation.ts) does the same job and the cron is unused.
 */
function authorised(req: Request) {
  const op = process.env.AGENT_TICK_SECRET;
  if (op && req.headers.get("x-tide-secret") === op) return true;
  const cron = process.env.CRON_SECRET;
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) return true;
  return false;
}

async function run(req: Request, reason: string) {
  if (!authorised(req)) return NextResponse.json({ error: "operator secret required" }, { status: 401 });
  return NextResponse.json({ result: await tick(reason) });
}

export const POST = (req: Request) => run(req, "manual");
export const GET = (req: Request) => run(req, "cron");
