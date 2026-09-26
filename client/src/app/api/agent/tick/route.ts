import { NextResponse } from "next/server";
import { tick } from "@/lib/scheduler";

export const dynamic = "force-dynamic";

/** Run the manager's market check now. */
export async function POST() {
  return NextResponse.json({ result: await tick("manual") });
}
