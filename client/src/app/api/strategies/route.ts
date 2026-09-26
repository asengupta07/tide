import { NextResponse } from "next/server";
import { listStrategies } from "@/lib/registry";
import { currentRecords, agentEnabled } from "@/lib/agent";

export const dynamic = "force-dynamic";

export async function GET() {
  const all = listStrategies();
  const rows = await Promise.all(
    all.map(async (s) => {
      const [records, enabled] = await Promise.all([currentRecords(s).catch(() => null), agentEnabled(s).catch(() => false)]);
      return { ...s, records, agentEnabled: enabled };
    }),
  );
  return NextResponse.json(rows.sort((a, b) => b.createdAt - a.createdAt));
}
