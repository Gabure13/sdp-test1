import { NextResponse } from "next/server";
import { createRepo, ingestUpload, MAX_UPLOAD_BYTES, toSummary } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    // `instanceof File` throws on Node 18 (no global File); duck-type instead.
    if (value && typeof value === "object" && "arrayBuffer" in value) {
      file = value as File;
    }
  } catch (err) {
    console.error("formData() failed:", err);
    return NextResponse.json({ error: "expected a multipart form upload" }, { status: 400 });
  }

  if (!file) {
    return NextResponse.json(
      { error: "attach a zip file in the 'file' form field" },
      { status: 400 },
    );
  }
  if (!/\.zip$/i.test(file.name)) {
    return NextResponse.json({ error: "only .zip archives are supported" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "the uploaded file is empty" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `archive too large (max ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)} MB)` },
      { status: 400 },
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const repo = createRepo({
      name: file.name.replace(/\.zip$/i, "").slice(0, 100),
      source: "upload",
      sourceDetail: file.name,
    });
    // Runs in the background; the client polls /api/repos for status.
    void ingestUpload(repo.id, buffer);
    return NextResponse.json({ repo: toSummary(repo) }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to register repository";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
