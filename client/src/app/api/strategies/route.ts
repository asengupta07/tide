import { NextResponse } from "next/server";
import { listStrategies } from "@/lib/registry";
import { currentRecords, agentEnabled } from "@/lib/agent";
import { publicClient } from "@/lib/ens/client";
import { blockState, readParams } from "@/lib/tide";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const all = await listStrategies();
  const tradableOnly = new URL(req.url).searchParams.get("tradable") === "1";
  const pc = tradableOnly ? publicClient() : null;
  const rows = await Promise.all(
    all.map(async (s) => {
      const [records, enabled, onchain, block] = await Promise.all([
        currentRecords(s).catch(() => null),
        agentEnabled(s).catch(() => false),
        pc ? readParams(pc, s.orderHash).catch(() => null) : Promise.resolve(null),
        pc ? blockState(pc, s.orderHash, s.owner, { tokenA: s.tokenA, tokenB: s.tokenB }).catch(() => null) : Promise.resolve(null),
      ]);
      const initialized = !!onchain && onchain.owner.toLowerCase() === s.owner.toLowerCase() && onchain.N > 0 && onchain.lambda > 0;
      const funded = !!block && BigInt(block.total.weth) > 0n && BigInt(block.total.usdc) > 0n;
      return { ...s, records, agentEnabled: enabled, tradeReady: initialized && funded };
    }),
  );
  return NextResponse.json(rows.filter((row) => !tradableOnly || row.tradeReady).sort((a, b) => b.createdAt - a.createdAt));
}
