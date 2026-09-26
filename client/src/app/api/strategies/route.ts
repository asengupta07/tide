import { NextResponse } from "next/server";
import { col } from "@/lib/db";
import type { Strategy } from "@/lib/registry";
import type { Publication } from "@/lib/sharing";
import { currentRecords, agentEnabled } from "@/lib/agent";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const query = new URL(req.url).searchParams;
  const owner = query.get("owner");
  const publicMarkets = query.get("scope") === "public";
  if (!owner && !publicMarkets) return NextResponse.json([]);
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
          : { owner: { $regex: `^${owner}$`, $options: "i" } },
        { projection: { _id: 0 } },
      )
      .sort({ createdAt: -1 })
      .toArray();
    const published = publicMarkets
      ? listings
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
    const rows = await Promise.all(
      all.map(async (s) => {
        const [records, enabled] = await Promise.all([
          currentRecords(s).catch(() => null),
          agentEnabled(s).catch(() => false),
        ]);
        return {
          ...s,
          records,
          agentEnabled: enabled,
          published: labels.has(s.label),
        };
      }),
    );
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load strategies. Try again." },
      { status: 503 },
    );
  }
}
