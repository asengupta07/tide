import { NextResponse } from "next/server";
import { labelAvailable } from "@/lib/onboard";
import { validLabel } from "@/lib/registry";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const label = (new URL(req.url).searchParams.get("label") ?? "").toLowerCase();
  if (!validLabel(label)) return NextResponse.json({ label, available: false, reason: "3 to 32 chars, a-z 0-9 and hyphens" });
  const available = await labelAvailable(label).catch(() => false);
  return NextResponse.json({ label, available });
}
