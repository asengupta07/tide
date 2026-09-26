import { NextResponse } from "next/server";
import { tickInfo, tickMinutes, minMoveBps } from "@/lib/scheduler";
import { realisedVolatility } from "@/lib/volatility";
import { lambdaStar } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const vol = await realisedVolatility().catch(() => null);
  return NextResponse.json({
    ...tickInfo(),
    sigma: vol?.sigma ?? tickInfo().sigma ?? null,
    measuredAt: vol?.measuredAt ?? tickInfo().measuredAt ?? null,
    ethPrice: vol?.last ?? null,
    lambdaStar: vol ? lambdaStar(vol.sigma) : null,
    tickMinutes: tickMinutes(),
    minMoveBps: minMoveBps(),
    approvalSeconds: Number(process.env.WORLD_APPROVAL_TIMEOUT_SECONDS ?? "180"),
  });
}
