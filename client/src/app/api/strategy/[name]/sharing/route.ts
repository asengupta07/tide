import { NextResponse } from "next/server";
import { z } from "zod";
import { col } from "@/lib/db";
import { getStrategy } from "@/lib/registry";
import { requireOwner, OwnerAuthError, safeError } from "@/lib/auth";
import {
  PublicationInput,
  publicationAction,
  type Publication,
} from "@/lib/sharing";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ name: string }> };
export async function GET(_: Request, ctx: Context) {
  const { name } = await ctx.params;
  const s = await getStrategy(name);
  if (!s)
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  const rows = await (await col<Publication>("publications"))
    .find({ label: s.label }, { projection: { _id: 0 } })
    .toArray();
  // Unpublished descriptions and snapshots are not exposed; only revision/status are needed to sign updates.
  return NextResponse.json(
    rows.map((p) =>
      p.published
        ? p
        : { kind: p.kind, published: false, revision: p.revision },
    ),
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: Request, ctx: Context) {
  try {
    const { name } = await ctx.params;
    const s = await getStrategy(name);
    if (!s)
      return NextResponse.json(
        { error: "Strategy not found" },
        { status: 404 },
      );
    const body = z
      .object({
        input: PublicationInput,
        revision: z.number().int().min(0),
        ts: z.number(),
        sig: z.string(),
      })
      .parse(await req.json());
    await requireOwner(
      s.owner,
      publicationAction(s.label, body.revision, body.input),
      body.ts,
      body.sig,
    );
    const c = await col<Publication>("publications");
    const id = `${s.label}-${body.input.kind}`;
    const row: Publication = {
      ...body.input,
      id,
      label: s.label,
      name: s.name,
      owner: s.owner,
      tokenA: s.tokenA,
      tokenB: s.tokenB,
      revision: body.revision + 1,
      updatedAt: Date.now(),
    };
    if (body.revision === 0) {
      try {
        await c.insertOne(row);
      } catch (e) {
        if ((e as { code?: number }).code === 11000)
          return NextResponse.json(
            { error: "Publishing settings changed. Reload and try again." },
            { status: 409 },
          );
        throw e;
      }
    } else {
      const result = await c.replaceOne(
        { id, revision: body.revision, owner: s.owner },
        row,
      );
      if (!result.matchedCount)
        return NextResponse.json(
          { error: "Publishing settings changed. Reload and try again." },
          { status: 409 },
        );
    }
    return NextResponse.json(row);
  } catch (e) {
    return NextResponse.json(
      { error: safeError(e) },
      { status: e instanceof OwnerAuthError ? 401 : 400 },
    );
  }
}
