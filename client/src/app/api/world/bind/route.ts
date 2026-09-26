import { NextResponse } from "next/server";
import { beginAuth } from "@/lib/world";
import { update } from "@/lib/store";

export const dynamic = "force-dynamic";

/** A strategy owner (`?owner=0x…`, the connected wallet) signs in once; the pairwise subject is bound to that wallet. */
export async function GET(req: Request) {
  try {
    const owner = new URL(req.url).searchParams.get("owner") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(owner)) return NextResponse.json({ error: "owner wallet required" }, { status: 400 });
    const { request, url } = await beginAuth("bind", { owner });
    update((s) => {
      s.authRequests[request.state] = request;
    });
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
