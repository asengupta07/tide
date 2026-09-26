import { NextResponse } from "next/server";
import { z } from "zod";
import { getAddress } from "viem";
import { createName, labelAvailable } from "@/lib/onboard";
import { addStrategy, validLabel, SEPOLIA_WETH, SEPOLIA_USDC } from "@/lib/registry";
import { update, log } from "@/lib/store";

export const dynamic = "force-dynamic";

const Body = z.object({
  label: z.string().min(3).max(32),
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  lambdaBps: z.number().int().min(1).max(10_000),
  n: z.number().int().min(1).max(64),
  deltaBps: z.number().int().min(0).max(4999),
  salt: z.string().regex(/^\d+$/),
  description: z.string().max(280).optional(),
});

/** Name a strategy: resolver + subname registered to the caller's wallet. Signed by the tide.eth registrar key. */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    const label = b.label.toLowerCase();
    if (!validLabel(label)) return NextResponse.json({ error: "invalid label" }, { status: 400 });
    if (!(await labelAvailable(label))) return NextResponse.json({ error: "label taken" }, { status: 409 });
    const [tokenA, tokenB] = SEPOLIA_WETH.toLowerCase() < SEPOLIA_USDC.toLowerCase() ? [SEPOLIA_WETH, SEPOLIA_USDC] : [SEPOLIA_USDC, SEPOLIA_WETH];
    const strat = await createName({ label, owner: getAddress(b.owner), tokenA, tokenB, salt: BigInt(b.salt), lambdaBps: b.lambdaBps, n: b.n, deltaBps: b.deltaBps, description: b.description });
    addStrategy(strat);
    update((s) => log(s, "info", `named ${strat.name} for ${strat.owner.slice(0, 10)}…, resolver ${strat.resolver}`, undefined, strat.name));
    return NextResponse.json(strat);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
