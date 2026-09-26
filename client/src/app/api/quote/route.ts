import { NextResponse } from "next/server";
import { z } from "zod";
import { publicClient } from "@/lib/ens/client";
import { getStrategy } from "@/lib/registry";
import { deployment } from "@/lib/tide";
import { safeError } from "@/lib/auth";
import tideTakerAbi from "@/abi/tide/TideTaker.json";

export const dynamic = "force-dynamic";

const Q = z.object({ strategy: z.string(), amount: z.string().regex(/^\d+$/), exactIn: z.enum(["1", "0"]), aToB: z.enum(["1", "0"]) });

/** Quote a fill of a strategy through TideTaker: what the wallet would pay and get right now. */
export async function GET(req: Request) {
  try {
    const q = Q.parse(Object.fromEntries(new URL(req.url).searchParams));
    const s = await getStrategy(q.strategy);
    if (!s) return NextResponse.json({ error: "unknown strategy" }, { status: 404 });
    const dep = deployment() as ReturnType<typeof deployment> & { tideTaker?: `0x${string}` };
    if (!dep.tideTaker) return NextResponse.json({ error: "taker not deployed" }, { status: 503 });
    const cfg = { maker: s.owner, tokenA: s.tokenA, tokenB: s.tokenB, salt: BigInt(s.salt || "0") };
    const [amountIn, amountOut] = (await publicClient().readContract({ address: dep.tideTaker, abi: tideTakerAbi, functionName: "quote", args: [cfg, BigInt(q.amount), q.exactIn === "1", q.aToB === "1"] })) as [bigint, bigint];
    return NextResponse.json({ amountIn: amountIn.toString(), amountOut: amountOut.toString() });
  } catch (e) {
    const error = safeError(e);
    const message = error.includes("function \"quote\" reverted") || error.includes("contract function")
      ? "This strategy is not currently tradable. Its liquidity may be empty or its deployment may be incomplete."
      : error;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
