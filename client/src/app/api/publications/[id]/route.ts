import { NextResponse } from "next/server";
import { col, clean } from "@/lib/db";
import type { Publication } from "@/lib/sharing";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const row = clean(
    await (
      await col<Publication>("publications")
    ).findOne({ id, published: true }),
  );
  return row
    ? NextResponse.json(row, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json(
        { error: "This template is no longer published." },
        { status: 404 },
      );
}
