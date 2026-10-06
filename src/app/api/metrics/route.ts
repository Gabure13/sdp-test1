import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { queryMetrics } from "@/lib/metrics";
import type { MetricFilter } from "@/lib/metric-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ indexes: getDb().prepare("SELECT repo_id, status, processed FROM metric_indexes").all() });
}

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Expected metric filters" }, { status: 400 });
  const f = body as Record<string, unknown>;
  const ids = (v: unknown): v is number[] => Array.isArray(v) && v.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
  if (!ids(f.repoIds) || f.repoIds.length > 100 || (f.authorIds !== undefined && !ids(f.authorIds))) return NextResponse.json({ error: "Choose valid repositories and authors" }, { status: 400 });
  for (const field of ["start", "end", "offset"]) {
    if (f[field] !== undefined && (typeof f[field] !== "number" || !Number.isSafeInteger(f[field]))) return NextResponse.json({ error: `Invalid ${field}` }, { status: 400 });
  }
  if ((f.start !== undefined && f.end !== undefined && Number(f.start) > Number(f.end)) || Number(f.offset ?? 0) < 0) return NextResponse.json({ error: "Invalid date range or page" }, { status: 400 });
  if (f.commits !== undefined && (!Array.isArray(f.commits) || !f.commits.every((c) => typeof c === "string" && /^\d+:[a-f0-9]{40,64}$/.test(c)))) return NextResponse.json({ error: "Invalid commit selection" }, { status: 400 });
  if ((f.path !== undefined && typeof f.path !== "string") || (f.search !== undefined && typeof f.search !== "string") || (f.kind !== undefined && f.kind !== "file" && f.kind !== "directory")) return NextResponse.json({ error: "Invalid path filter" }, { status: 400 });
  try {
    const filter = { ...f, repoIds: [...new Set(f.repoIds)] } as unknown as MetricFilter;
    return NextResponse.json(await queryMetrics(filter));
  } catch (error) {
    console.error("Metrics failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not analyze repositories" }, { status: 500 });
  }
}
