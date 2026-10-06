import { NextResponse } from "next/server";
import { ensureAuthorsForRepo, getAuthorOverview } from "@/lib/authors";
import { getRepo, toSummary } from "@/lib/ingest";

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
  if (repo.status === "ready" && repo.git_dir) {
    // Repositories ingested before author tracking existed are scanned here.
    try {
      await ensureAuthorsForRepo(repo);
    } catch (err) {
      console.error("author backfill failed:", err);
      return NextResponse.json(
        { error: "failed to read the repository's author history" },
        { status: 500 },
      );
    }
  }
  return NextResponse.json({
    repo: toSummary(repo),
    authors: getAuthorOverview(repo.id),
  });
}
