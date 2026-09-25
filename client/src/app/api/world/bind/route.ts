import { NextResponse } from "next/server";
import { beginAuth } from "@/lib/world";
import { update } from "@/lib/store";

export const dynamic = "force-dynamic";

/** Owner signs in once so the agent knows which pairwise subject may approve its proposals. */
export async function GET() {
  try {
    const { request, url } = await beginAuth("bind");
    update((s) => {
      s.authRequests[request.state] = request;
    });
    return NextResponse.redirect(url);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
