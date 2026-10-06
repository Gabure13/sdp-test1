import { NextResponse } from "next/server";
import { listRepos, toSummary } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export async function GET() {
  const repos = listRepos().map(toSummary);
  return NextResponse.json({ repos });
}
