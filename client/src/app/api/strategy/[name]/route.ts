import { NextResponse } from "next/server";
import { getStrategy } from "@/lib/registry";

export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const s = await getStrategy(name);
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(s);
}
