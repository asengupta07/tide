import { NextResponse } from "next/server";
import { z } from "zod";
import { propose } from "@/lib/agent";

export const dynamic = "force-dynamic";

const Body = z.object({ sigma: z.number().min(0.01).max(5), N: z.number().int().min(1).max(64).optional(), delta: z.number().int().min(0).max(4999).optional() });

/** The agent proposes new parameters. Nothing is written until the owner completes a fresh World ID auth. */
export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());
    const p = await propose(body.sigma, { N: body.N, delta: body.delta });
    return NextResponse.json(p);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
