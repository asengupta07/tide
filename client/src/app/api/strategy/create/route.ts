import { NextResponse } from "next/server";
import { z } from "zod";
import { getAddress } from "viem";
import { createName, labelAvailable } from "@/lib/onboard";
import { addStrategy, validLabel } from "@/lib/registry";
import { marketForTokens, sortedTokens, TOKENS } from "@/lib/tokens";
import { appendLog } from "@/lib/store";
import { requireOwner, OwnerAuthError, safeError } from "@/lib/auth";

export const dynamic = "force-dynamic";

const Body = z.object({
  label: z.string().min(3).max(32),
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  tokenA: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  tokenB: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  lambdaBps: z.number().int().min(1).max(10_000),
  n: z.number().int().min(1).max(64),
  deltaBps: z.number().int().min(0).max(4999),
  feeBps: z.number().int().min(0).max(9999),
  salt: z.string().regex(/^\d+$/),
  description: z.string().max(280).optional(),
  ts: z.number(),
  sig: z.string(),
});

/** Name a strategy: resolver + subname registered to the caller's wallet. Signed by the tide.eth registrar key. */
export async function POST(req: Request) {
  try {
    const b = Body.parse(await req.json());
    const label = b.label.toLowerCase();
    if (!validLabel(label)) return NextResponse.json({ error: "invalid label" }, { status: 400 });
    // the registrar key pays for the resolver and the registration, so the wallet that gets the name must ask
    await requireOwner(b.owner, `name ${label} for ${b.owner.toLowerCase()}`, b.ts, b.sig);
    if (!(await labelAvailable(label))) return NextResponse.json({ error: "label taken" }, { status: 409 });
    const market = marketForTokens(b.tokenA ?? TOKENS.WETH.address, b.tokenB ?? TOKENS.USDC.address);
    if (!market) return NextResponse.json({ error: "unsupported token pair" }, { status: 400 });
    const [tokenA, tokenB] = sortedTokens(market);
    if ((b.n - 1) * b.deltaBps > 2 * b.feeBps) return NextResponse.json({ error: "delta exceeds what the fee backs: (N - 1) * delta must be <= 2 * fee" }, { status: 400 });
    const strat = await createName({ label, owner: getAddress(b.owner), tokenA, tokenB, salt: BigInt(b.salt), lambdaBps: b.lambdaBps, n: b.n, deltaBps: b.deltaBps, feeBps: b.feeBps, description: b.description });
    await addStrategy(strat);
    await appendLog("info", `named ${strat.name} for ${strat.owner.slice(0, 10)}…, resolver ${strat.resolver}`, undefined, strat.name);
    return NextResponse.json(strat);
  } catch (e) {
    return NextResponse.json({ error: safeError(e) }, { status: e instanceof OwnerAuthError ? 401 : 400 });
  }
}
