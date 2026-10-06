import { NextResponse } from "next/server";
import { isValidRemoteUrl, repoNameFromUrl } from "@/lib/git";
import { createRepo, ingestClone, toSummary } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let url: unknown;
  try {
    ({ url } = await request.json());
  } catch {
    return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
  }

  if (typeof url !== "string" || !isValidRemoteUrl(url)) {
    return NextResponse.json(
      { error: "provide a valid remote repository URL (https://, git://, or user@host:path)" },
      { status: 400 },
    );
  }

  const trimmed = url.trim();
  try {
    const repo = createRepo({
      name: repoNameFromUrl(trimmed).slice(0, 100),
      source: "clone",
      sourceDetail: trimmed,
    });
    // Runs in the background; the client polls /api/repos for status.
    void ingestClone(repo.id, trimmed);
    return NextResponse.json({ repo: toSummary(repo) }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to register repository";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
