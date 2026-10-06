import { NextResponse } from "next/server";
import { getRepo, removeRepo, toSummary } from "@/lib/ingest";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_request: Request, { params }: Params) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  const repo = id ? getRepo(id) : undefined;
  if (!repo) {
    return NextResponse.json({ error: "repository not found" }, { status: 404 });
  }
  return NextResponse.json({ repo: toSummary(repo) });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id: rawId } = await params;
  const id = parseId(rawId);
  if (!id || !(await removeRepo(id))) {
    return NextResponse.json({ error: "repository not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
