import AdmZip from "adm-zip";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getDb, type RepoRow } from "./db";
import { REPOS_DIR, ensureDataDirs } from "./paths";
import { cloneRepo, countCommits, headInfo, listAuthors } from "./git";
import type { RepoSource, RepoSummary } from "./types";

export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Registry CRUD
// ---------------------------------------------------------------------------

export function createRepo(input: {
  name: string;
  source: RepoSource;
  sourceDetail: string;
}): RepoRow {
  const db = getDb();
  ensureDataDirs();
  const info = db
    .prepare(
      `INSERT INTO repos (name, source, source_detail, status)
       VALUES (?, ?, ?, 'pending')`,
    )
    .run(input.name, input.source, input.sourceDetail);
  const id = Number(info.lastInsertRowid);
  const storageDir = path.join(REPOS_DIR, String(id));
  fs.mkdirSync(storageDir, { recursive: true });
  db.prepare(`UPDATE repos SET storage_dir = ? WHERE id = ?`).run(storageDir, id);
  return getRepo(id)!;
}

export function getRepo(id: number): RepoRow | undefined {
  return getDb().prepare("SELECT * FROM repos WHERE id = ?").get(id) as
    | RepoRow
    | undefined;
}

/** Strip server-side filesystem paths before sending a repo to the client. */
export function toSummary(row: RepoRow): RepoSummary {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    source_detail: row.source_detail,
    status: row.status,
    status_message: row.status_message,
    default_branch: row.default_branch,
    commit_count: row.commit_count,
    author_count: row.author_count,
    created_at: row.created_at,
  };
}

export function listRepos(): RepoRow[] {
  return getDb().prepare("SELECT * FROM repos ORDER BY id DESC").all() as RepoRow[];
}

export async function removeRepo(id: number): Promise<boolean> {
  const repo = getRepo(id);
  if (!repo) return false;
  if (repo.storage_dir?.startsWith(REPOS_DIR + path.sep)) {
    await fsp.rm(repo.storage_dir, { recursive: true, force: true });
  }
  getDb().prepare("DELETE FROM repos WHERE id = ?").run(id);
  return true;
}

function setStatus(id: number, status: string, message: string | null): void {
  getDb()
    .prepare(
      `UPDATE repos
       SET status = ?, status_message = ?, updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(status, message, id);
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

/** Deep-clone a remote URL, then index the result. Fire-and-forget safe. */
export async function ingestClone(id: number, url: string): Promise<void> {
  const repo = getRepo(id);
  if (!repo?.storage_dir) return;
  const dest = path.join(repo.storage_dir, "repo.git");
  try {
    setStatus(id, "cloning", "Starting clone");
    await cloneRepo(url, dest, (message) => setStatus(id, "cloning", message));
    await indexRepo(id, dest);
  } catch (err) {
    await failRepo(id, err);
  }
}

/** Extract an uploaded zip (in memory), locate .git, then index. */
export async function ingestUpload(id: number, zipBuffer: Buffer): Promise<void> {
  const repo = getRepo(id);
  if (!repo?.storage_dir) return;
  const extractDir = path.join(repo.storage_dir, "src");
  try {
    setStatus(id, "extracting", "Extracting archive");
    fs.mkdirSync(extractDir, { recursive: true });
    extractZipSafely(zipBuffer, extractDir);
    const gitDir = findGitDir(extractDir);
    await indexRepo(id, gitDir);
  } catch (err) {
    await failRepo(id, err);
  }
}

async function indexRepo(id: number, gitDir: string): Promise<void> {
  setStatus(id, "indexing", "Reading repository");
  const commitCount = await countCommits(gitDir);
  if (commitCount === 0) {
    throw new Error("repository contains no commits");
  }
  const authors = await listAuthors(gitDir);
  const { branch, sha } = await headInfo(gitDir);
  getDb()
    .prepare(
      `UPDATE repos
       SET git_dir = ?, status = 'ready', status_message = NULL,
           default_branch = ?, head_sha = ?, commit_count = ?, author_count = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
    )
    .run(gitDir, branch, sha, commitCount, authors.length, id);
}

async function failRepo(id: number, err: unknown): Promise<void> {
  const repo = getRepo(id);
  if (repo?.storage_dir) {
    // Drop partial clone/extract output; the row stays for the error message.
    await fsp
      .rm(path.join(repo.storage_dir, "repo.git"), { recursive: true, force: true })
      .catch(() => {});
    await fsp
      .rm(path.join(repo.storage_dir, "src"), { recursive: true, force: true })
      .catch(() => {});
  }
  const message = err instanceof Error ? err.message : String(err);
  setStatus(id, "failed", message.slice(0, 500));
}

// ---------------------------------------------------------------------------
// Zip handling
// ---------------------------------------------------------------------------

function extractZipSafely(buffer: Buffer, dest: string): void {
  let zip: AdmZip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error("could not read the archive (corrupt or not a zip file)");
  }
  const entries = zip.getEntries();
  if (entries.length === 0) {
    throw new Error("zip archive is empty");
  }
  // Zip-slip guard: every entry must land inside the destination directory.
  for (const entry of entries) {
    const target = path.resolve(dest, entry.entryName);
    if (target !== dest && !target.startsWith(dest + path.sep)) {
      throw new Error(`refusing unsafe archive entry: ${entry.entryName}`);
    }
  }
  zip.extractAllTo(dest, true);
}

/**
 * Locate the git directory inside an extracted archive. Supports:
 * - `.git/` directory at the archive root
 * - a single top-level directory wrapping the repo (GitHub-style exports)
 * - a bare repository layout (HEAD + objects/ + refs/) at either level
 * - a `.git` file (worktree pointer) whose target also lives in the archive
 */
function findGitDir(extractDir: string): string {
  const stat = (p: string): fs.Stats | null => {
    try {
      return fs.statSync(p);
    } catch {
      return null;
    }
  };

  const tryResolve = (dir: string): string | null => {
    const dotGit = path.join(dir, ".git");
    const s = stat(dotGit);
    if (s?.isDirectory()) return dotGit;
    if (s?.isFile()) {
      const content = fs.readFileSync(dotGit, "utf8").trim();
      const match = content.match(/^gitdir:\s*(.+)$/);
      if (!match) return null;
      const target = path.resolve(dir, match[1].trim());
      if (!target.startsWith(dir + path.sep)) return null; // points outside the archive
      return stat(target)?.isDirectory() ? target : null;
    }
    const isBareLayout =
      stat(path.join(dir, "HEAD"))?.isFile() === true &&
      stat(path.join(dir, "objects"))?.isDirectory() === true &&
      stat(path.join(dir, "refs"))?.isDirectory() === true;
    return isBareLayout ? dir : null;
  };

  const direct = tryResolve(extractDir);
  if (direct) return direct;

  const entries = fs
    .readdirSync(extractDir)
    .filter((e) => !e.startsWith(".") && !e.startsWith("__MACOSX"));
  if (entries.length === 1) {
    const wrapped = path.join(extractDir, entries[0]);
    if (stat(wrapped)?.isDirectory()) {
      const found = tryResolve(wrapped);
      if (found) return found;
    }
  }

  throw new Error(
    "no git repository found in the archive — zip the repository folder including its .git directory",
  );
}
