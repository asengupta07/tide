import { NextResponse, after } from "next/server";
import { tickStatus, tickIfStale, tickMinutes, minMoveBps } from "@/lib/scheduler";
import { realisedVolatility } from "@/lib/volatility";
import { lambdaStar } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const [vol, info] = await Promise.all([realisedVolatility().catch(() => null), tickStatus()]);
  after(() => tickIfStale().catch(() => null)); // the manager's clock on hosts without a long-lived process
  return NextResponse.json({
    ...info,
    sigma: vol?.sigma ?? info.sigma ?? null,
    measuredAt: vol?.measuredAt ?? info.measuredAt ?? null,
    ethPrice: vol?.last ?? null,
    lambdaStar: vol ? lambdaStar(vol.sigma) : null,
    tickMinutes: tickMinutes(),
    minMoveBps: minMoveBps(),
    approvalSeconds: Number(process.env.WORLD_APPROVAL_TIMEOUT_SECONDS ?? "180"),
  });
}
