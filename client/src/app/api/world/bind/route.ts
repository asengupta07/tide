import { NextResponse } from "next/server";
import { requireOwner, OwnerAuthError } from "@/lib/auth";
import { beginAuth } from "@/lib/world";
import { putAuthRequest } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * A strategy owner binds their World ID to their wallet. The wallet must prove itself first (see lib/auth.ts);
 * without it anyone could bind their own World ID to somebody else's strategy and approve its proposals.
 * Returns the World authorization URL; the dashboard navigates there.
 */
export async function GET(req: Request) {
  try {
    const q = new URL(req.url).searchParams;
    const owner = q.get("owner") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return NextResponse.json({ error: "owner wallet required" }, { status: 400 });
    await requireOwner(owner, `bind World ID to ${owner.toLowerCase()}`, q.get("ts"), q.get("sig"));
    const { request, url } = await beginAuth("bind", { owner });
    await putAuthRequest(request);
    // JSON, not a redirect: the dashboard navigates, so an error never lands the user on a raw API page
    return NextResponse.json({ url });
  } catch (e) {
    const status = e instanceof OwnerAuthError ? 401 : 500;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
