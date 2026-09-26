import { NextResponse } from "next/server";
import { col } from "@/lib/db";
import type { Publication } from "@/lib/sharing";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const rows = await (
      await col<Publication>("publications")
    )
      .find({ published: true }, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .toArray();
    return NextResponse.json(rows, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not load Explore. Try again." },
      { status: 503 },
    );
  }
}
