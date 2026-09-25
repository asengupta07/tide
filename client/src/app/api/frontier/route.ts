import { NextResponse } from "next/server";
import { frontier } from "@/lib/agent";

export async function GET() {
  return NextResponse.json(frontier());
}
