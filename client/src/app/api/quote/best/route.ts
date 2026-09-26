import { NextResponse } from "next/server";
import { getAddress, type Abi, type Address } from "viem";
import { z } from "zod";

import tideTakerAbi from "@/abi/tide/TideTaker.json";
import { publicClient } from "@/lib/ens/client";
import { col } from "@/lib/db";
import type { Strategy } from "@/lib/registry";
import { SEPOLIA_USDC } from "@/lib/registry";
import { deployment } from "@/lib/tide";

export const dynamic = "force-dynamic";

const Q = z.object({
  amount: z.string().regex(/^\d+$/),
  exactIn: z.enum(["1", "0"]),
  sellEth: z.enum(["1", "0"]),
  excludeOwner: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
});

/** Best single-strategy Tide route for one WETH/USDC order. */
export async function GET(req: Request) {
  try {
    const q = Q.parse(Object.fromEntries(new URL(req.url).searchParams));
    const dep = deployment() as ReturnType<typeof deployment> & { tideTaker?: Address };
    if (!dep.tideTaker) return NextResponse.json({ error: "Tide taker is not deployed" }, { status: 503 });

    const exclude = q.excludeOwner?.toLowerCase();
    const tokenIn = q.sellEth === "1" ? dep.weth : SEPOLIA_USDC;
    const tokenOut = q.sellEth === "1" ? SEPOLIA_USDC : dep.weth;
    const strategies = await (await col<Strategy>("strategies"))
      .find({}, { projection: { _id: 0 } })
      .toArray();
    const candidates = strategies.filter((strategy) => {
      if (exclude && strategy.owner.toLowerCase() === exclude) return false;
      const tokens = new Set([strategy.tokenA.toLowerCase(), strategy.tokenB.toLowerCase()]);
      return !!strategy.salt && tokens.has(tokenIn.toLowerCase()) && tokens.has(tokenOut.toLowerCase());
    });
    if (!candidates.length) return NextResponse.json({ error: "No independent Tide LP is available for this pair" }, { status: 404 });

    const results = await publicClient().multicall({
      allowFailure: true,
      contracts: candidates.map((strategy) => ({
        address: dep.tideTaker!,
        abi: tideTakerAbi as Abi,
        functionName: "quote",
        args: [
          { maker: getAddress(strategy.owner), tokenA: getAddress(strategy.tokenA), tokenB: getAddress(strategy.tokenB), salt: BigInt(strategy.salt) },
          BigInt(q.amount),
          q.exactIn === "1",
          tokenIn.toLowerCase() === strategy.tokenA.toLowerCase(),
        ],
      })),
    });

    const quotes = results.flatMap((result, index) => {
      if (result.status !== "success") return [];
      const [amountIn, amountOut] = result.result as readonly [bigint, bigint];
      const strategy = candidates[index];
      return [{
        strategy,
        aToB: tokenIn.toLowerCase() === strategy.tokenA.toLowerCase(),
        amountIn: amountIn.toString(),
        amountOut: amountOut.toString(),
      }];
    });
    quotes.sort((a, b) => q.exactIn === "1"
      ? (BigInt(a.amountOut) > BigInt(b.amountOut) ? -1 : BigInt(a.amountOut) < BigInt(b.amountOut) ? 1 : 0)
      : (BigInt(a.amountIn) < BigInt(b.amountIn) ? -1 : BigInt(a.amountIn) > BigInt(b.amountIn) ? 1 : 0));
    if (!quotes.length) return NextResponse.json({ error: "No Tide LP could quote this order size" }, { status: 422 });

    return NextResponse.json({ route: quotes[0], quotes, sourcesChecked: quotes.length });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not route this order" }, { status: 400 });
  }
}
