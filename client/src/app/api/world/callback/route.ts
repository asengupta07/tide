import { NextResponse } from "next/server";
import { handleCallback } from "@/lib/agent";

export const dynamic = "force-dynamic";

/**
 * OIDC redirect target. Validates the ID token server-side; the protected ENS/TideParams write happens
 * inside handleCallback only on the approved branch. Every other outcome leaves the records unchanged.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const result = await handleCallback(url.searchParams);
  const dest = new URL("/approved", url.origin);
  dest.searchParams.set("purpose", result.purpose);
  if (result.proposal) dest.searchParams.set("proposal", result.proposal.id);
  if (result.proposal) dest.searchParams.set("strategy", result.proposal.strategy);
  if (result.owner) dest.searchParams.set("owner", result.owner);
  if (result.error) dest.searchParams.set("error", result.error);
  return NextResponse.redirect(dest);
}
