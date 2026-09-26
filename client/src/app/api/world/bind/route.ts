import { NextResponse } from "next/server";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { beginAuth } from "@/lib/world";
import { putAuthRequest } from "@/lib/store";

export const dynamic = "force-dynamic";

const MAX_AGE_MS = 10 * 60_000;

/** The exact text a strategy owner signs to prove the wallet before binding a World ID to it. */
export const bindMessage = (owner: string, ts: number) => `Tide: bind World ID to ${getAddress(owner)} at ${ts}`;

/**
 * A strategy owner binds their World ID to their wallet. The wallet must prove itself first: `sig` is an
 * EIP-191 signature of `bindMessage(owner, ts)` by `owner`, `ts` at most ten minutes old. Without it,
 * anyone could bind their own World ID to somebody else's strategy and approve its proposals.
 */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const owner = q.get("owner") ?? "";
    const sig = q.get("sig") ?? "";
    const ts = Number(q.get("ts") ?? "");
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return NextResponse.json({ error: "owner wallet required" }, { status: 400 });
    if (!/^0x[0-9a-fA-F]{130}$/.test(sig) || !Number.isFinite(ts)) return NextResponse.json({ error: "wallet signature required" }, { status: 401 });
    if (Math.abs(Date.now() - ts) > MAX_AGE_MS) return NextResponse.json({ error: "signature expired" }, { status: 401 });
    const ok = await verifyMessage({ address: owner as Address, message: bindMessage(owner, ts), signature: sig as Hex });
    if (!ok) return NextResponse.json({ error: "signature does not match owner" }, { status: 401 });

    const { request, url } = await beginAuth("bind", { owner });
    await putAuthRequest(request);
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
