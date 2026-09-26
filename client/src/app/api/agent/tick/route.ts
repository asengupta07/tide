import { NextResponse } from "next/server";
import { tick } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/**
 * Run the manager's market check now. Operator-only. Two callers:
 *   - an operator: POST with `x-tide-secret: $AGENT_TICK_SECRET`
 *   - an external clock (the GitHub Actions workflow, or any cron service): GET with
 *     `Authorization: Bearer $CRON_SECRET`
 * Traffic also keeps the clock: /api/agent/status and /api/strategies run a check when the last one is stale.
 * On a long-lived host the in-process scheduler (instrumentation.ts) does the same job.
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
