import { NextResponse } from "next/server";
import { AuthorMergeError, mergeAuthorGroups, unmergeAuthorGroup } from "@/lib/authors";
import { getRepo } from "@/lib/ingest";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseGroupId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** POST { fromGroupId, toGroupId } — merge the first author into the second. */
export async function POST(request: Request, { params }: Params) {
  const { id: rawId } = await params;
  const repoId = parseId(rawId);
  const repo = repoId ? getRepo(repoId) : undefined;
  if (!repo) {
    return NextResponse.json({ error: "repository not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as {
    fromGroupId?: unknown;
    toGroupId?: unknown;
  } | null;
  const fromGroupId = parseGroupId(body?.fromGroupId);
  const toGroupId = parseGroupId(body?.toGroupId);
  if (fromGroupId === null || toGroupId === null) {
    return NextResponse.json(
      { error: "expected fromGroupId and toGroupId numbers" },
      { status: 400 },
    );
  }
  try {
    const authors = mergeAuthorGroups(repo.id, fromGroupId, toGroupId);
    return NextResponse.json({ authors });
  } catch (err) {
    if (err instanceof AuthorMergeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

/** DELETE ?fromGroupId=N — undo a manual merge. */
export async function DELETE(request: Request, { params }: Params) {
  const { id: rawId } = await params;
  const repoId = parseId(rawId);
  const repo = repoId ? getRepo(repoId) : undefined;
  if (!repo) {
    return NextResponse.json({ error: "repository not found" }, { status: 404 });
  }
  const fromGroupId = parseGroupId(
    new URL(request.url).searchParams.get("fromGroupId"),
  );
  if (fromGroupId === null) {
    return NextResponse.json({ error: "expected fromGroupId number" }, { status: 400 });
  }
  try {
    const authors = unmergeAuthorGroup(repo.id, fromGroupId);
    return NextResponse.json({ authors });
  } catch (err) {
    if (err instanceof AuthorMergeError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
