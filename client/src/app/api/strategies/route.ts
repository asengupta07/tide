import { NextResponse } from "next/server";
import { col } from "@/lib/db";
import type { Strategy } from "@/lib/registry";
import type { Publication } from "@/lib/sharing";
import { currentRecords, agentEnabled } from "@/lib/agent";
import { publicClient } from "@/lib/ens/client";
import { blockState, readParams } from "@/lib/tide";
import { isTradeReady } from "@/lib/trade-readiness";
import { marketForTokens, tokenMeta } from "@/lib/tokens";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  const owner = query.get("owner");
  const tradableOnly = query.get("tradable") === "1";
  const publicMarkets = query.get("scope") === "public";
  const marketScope = query.get("scope") === "markets";
  if (!owner && !publicMarkets && !marketScope) return NextResponse.json([]);
  if (owner && !/^0x[0-9a-fA-F]{40}$/.test(owner))
    return NextResponse.json(
      { error: "Invalid wallet address" },
      { status: 400 },
    );
  try {
    // Unlisted is a discovery preference, not secrecy of public on-chain ownership.
    const listings = publicMarkets
      ? await (await col<Publication>("publications"))
          .find({ published: true, kind: "strategy" })
          .toArray()
      : [];
    const all = await (
      await col<Strategy>("strategies")
    )
      .find(
        publicMarkets
          ? { label: { $in: listings.map((p) => p.label) } }
          : marketScope
            ? {}
            : { owner: { $regex: `^${owner}$`, $options: "i" } },
        { projection: { _id: 0 } },
      )
      .sort({ createdAt: -1 })
      .toArray();
    const published = publicMarkets
      ? listings
      : marketScope
        ? []
        : await (
            await col<Publication>("publications")
          )
            .find({
              label: { $in: all.map((s) => s.label) },
              published: true,
              kind: "strategy",
            })
            .toArray();
    const labels = new Set(published.map((p) => p.label));
    const pc = tradableOnly ? publicClient() : null;
    const rows = await Promise.all(
      all.map(async (s) => {
        const [records, enabled, onchain, block] = await Promise.all([
          currentRecords(s).catch(() => null),
          agentEnabled(s).catch(() => false),
          pc ? readParams(pc, s.orderHash).catch(() => null) : Promise.resolve(null),
          pc ? blockState(pc, s.orderHash, s.owner, { tokenA: s.tokenA, tokenB: s.tokenB }).catch(() => null) : Promise.resolve(null),
        ]);
        return {
          ...s,
          tokens: { tokenA: tokenMeta(s.tokenA), tokenB: tokenMeta(s.tokenB) },
          pair: marketForTokens(s.tokenA, s.tokenB),
          records,
          agentEnabled: enabled,
          published: labels.has(s.label),
          ...(tradableOnly ? {
            tradeReady: isTradeReady(s.owner, onchain, block),
            market: onchain && block ? {
              lambda: onchain.lambda,
              N: onchain.N,
              delta: onchain.delta,
              fee: onchain.fee,
              total: block.total,
            } : null,
          } : {}),
        };
      }),
    );
    return NextResponse.json(rows.filter(row => !tradableOnly || row.tradeReady), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load strategies. Try again." },
      { status: 503 },
    );
  }
}
