import { NextResponse } from "next/server";
import { z } from "zod";
import type { Hex } from "viem";
import { markApplied } from "@/lib/agent";

export const dynamic = "force-dynamic";

const Body = z.object({ id: z.string().min(4), tx: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

/** The owner applied an approved, out-of-bounds proposal with their own wallet. Verified on-chain before marking. */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    await markApplied(b.id, b.tx as Hex);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
