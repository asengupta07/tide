import { NextResponse } from "next/server";
import { getProposal } from "@/lib/store";
import { requireOwner, OwnerAuthError } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * The World authorization URL of a pending proposal, for its owner only. The URL carries the OIDC state; with
 * the public callback, anyone holding it could block the proposal, so it is never in /api/state.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const p = await getProposal(q.get("id") ?? "");
    if (!p) return NextResponse.json({ error: "unknown proposal" }, { status: 404 });
    await requireOwner(p.owner, `approve proposal ${p.id}`, q.get("ts"), q.get("sig"));
    if (p.status !== "pending" || !p.approvalUrl) return NextResponse.json({ error: `proposal is ${p.status}` }, { status: 409 });
    return NextResponse.json({ url: p.approvalUrl });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof OwnerAuthError ? 401 : 500 });
  }
}
