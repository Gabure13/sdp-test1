import { spawn } from "node:child_process";
import { getDb, type RepoRow } from "./db";
import { ensureAuthorsForRepo } from "./authors";

export interface CommitRow {
  repo_id: number;
  sha: string;
  parent_sha: string;
  committed_at: number;
  author_name: string;
  author_email: string;
  subject: string;
}
export interface ChangeRow {
  sha: string;
  path: string;
  old_path: string;
  added: number;
  removed: number;
  binary: number;
}
export interface TreeObjects { files: string[]; directories: string[] }

// NUL framing handles spaces, tabs, newlines, braces and arrows in paths.
async function* gitTokens(gitDir: string, args: string[]): AsyncGenerator<string> {
  const child = spawn("git", ["--git-dir", gitDir, ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errorText = "";
  child.stderr.on("data", (chunk: Buffer) => { errorText = (errorText + chunk).slice(-4096); });
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(errorText || "Git history scan failed")));
  });
  // Attach a handler immediately so an early spawn failure isn't unhandled.
  void done.catch(() => {});
  child.stdout.setEncoding("utf8");
  let pending = "";
  try {
    for await (const chunk of child.stdout) {
      pending += chunk;
      let start = 0;
      let end: number;
      while ((end = pending.indexOf("\0", start)) !== -1) {
        yield pending.slice(start, end);
        start = end + 1;
      }
      pending = pending.slice(start);
    }
    if (pending) yield pending;
    await done;
  } finally {
    if (child.exitCode === null) child.kill();
  }
}

export function directoryPaths(file: string): string[] {
  const dirs = [""];
  let pos = file.indexOf("/");
  while (pos !== -1) {
    dirs.push(file.slice(0, pos));
    pos = file.indexOf("/", pos + 1);
  }
  return dirs;
}

function statToken(token: string): { added: number; removed: number; binary: number; path: string } | null {
  const match = token.replace(/^\n/, "").match(/^(\d+|-)\t(\d+|-)\t([\s\S]*)$/);
  if (!match) return null;
  const binary = Number(match[1] === "-" || match[2] === "-");
  return { added: binary ? 0 : Number(match[1]), removed: binary ? 0 : Number(match[2]), binary, path: match[3] };
}

const running = new Map<number, Promise<void>>();

export async function ensureMetricIndex(repo: RepoRow): Promise<void> {
  if (repo.status !== "ready" || !repo.git_dir || !repo.head_sha) throw new Error("Repository is not ready for analysis");
  const existing = getDb().prepare("SELECT head_sha, status FROM metric_indexes WHERE repo_id = ?").get(repo.id) as { head_sha: string; status: string } | undefined;
  if (existing?.status === "ready" && existing.head_sha === repo.head_sha) return;
  let job = running.get(repo.id);
  if (!job) {
    job = buildIndex(repo).finally(() => running.delete(repo.id));
    running.set(repo.id, job);
  }
  await job;
}

async function buildIndex(repo: RepoRow): Promise<void> {
  await ensureAuthorsForRepo(repo);
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM metric_commits WHERE repo_id = ?").run(repo.id);
    db.prepare("DELETE FROM metric_snapshots WHERE repo_id = ?").run(repo.id);
    db.prepare("INSERT OR REPLACE INTO metric_indexes(repo_id, head_sha, status, processed) VALUES (?, ?, 'indexing', 0)").run(repo.id, repo.head_sha);
  })();
  const insertCommit = db.prepare("INSERT INTO metric_commits VALUES (?, ?, ?, ?, ?, ?, ?)");
  const insertChange = db.prepare("INSERT INTO metric_changes VALUES (?, ?, ?, ?, ?, ?, ?)");
  let batch: { commit: CommitRow; changes: ChangeRow[] }[] = [];
  let count = 0;
  const flush = db.transaction(() => {
    for (const { commit: c, changes } of batch) {
      insertCommit.run(repo.id, c.sha, c.parent_sha, c.committed_at, c.author_name, c.author_email, c.subject);
      for (const f of changes) insertChange.run(repo.id, c.sha, f.path, f.old_path, f.added, f.removed, f.binary);
    }
    count += batch.length;
    db.prepare("UPDATE metric_indexes SET processed = ? WHERE repo_id = ?").run(count, repo.id);
    batch = [];
  });
  let current: { commit: CommitRow; changes: ChangeRow[] } | null = null;
  let header: string[] | null = null;
  let rename: ReturnType<typeof statToken> = null;
  let oldPath: string | null = null;
  const finish = () => {
    if (current) batch.push(current);
    if (batch.length >= 200) flush();
    current = null;
  };
  try {
    for await (const token of gitTokens(repo.git_dir!, [
      "-c", "diff.renameLimit=0", "log", repo.head_sha!, "--no-merges", "--root",
      "--no-ext-diff", "--no-textconv", "--diff-algorithm=myers", "-M50%", "--numstat", "-z",
      "--format=%x00RAT-COMMIT%x00%H%x00%P%x00%ct%x00%an%x00%ae%x00%s%x00", "--",
    ])) {
      if (header) {
        header.push(token);
        if (header.length === 6) {
          current = { commit: { repo_id: repo.id, sha: header[0], parent_sha: header[1], committed_at: Number(header[2]), author_name: header[3], author_email: header[4], subject: header[5] }, changes: [] };
          header = null;
        }
        continue;
      }
      if (rename) {
        if (oldPath === null) oldPath = token;
        else {
          current!.changes.push({ sha: current!.commit.sha, ...rename, path: token, old_path: oldPath });
          rename = null;
          oldPath = null;
        }
        continue;
      }
      if (token === "RAT-COMMIT") { finish(); header = []; continue; }
      const stat = statToken(token);
      if (!stat || !current) continue;
      if (stat.path === "") rename = stat;
      else current.changes.push({ sha: current.commit.sha, ...stat, old_path: stat.path });
    }
    finish();
    if (batch.length) flush();
    db.prepare("UPDATE metric_indexes SET status = 'ready' WHERE repo_id = ?").run(repo.id);
    db.prepare("UPDATE repos SET commit_count = ? WHERE id = ?").run(count, repo.id);
  } catch (error) {
    db.prepare("UPDATE metric_indexes SET status = 'failed' WHERE repo_id = ?").run(repo.id);
    throw error;
  }
}

/** A snapshot diffed against an empty tree also uses Git's binary detection. */
export async function snapshotObjects(repo: RepoRow, sha: string): Promise<TreeObjects> {
  const db = getDb();
  const cached = db.prepare("SELECT objects FROM metric_snapshots WHERE repo_id = ? AND sha = ?").get(repo.id, sha) as { objects: string } | undefined;
  if (cached) return JSON.parse(cached.objects) as TreeObjects;
  // mktree hashes the empty input without creating a working tree; SHA-256 repos work too.
  const empty = await new Promise<string>((resolve, reject) => {
    const child = spawn("git", ["--git-dir", repo.git_dir!, "hash-object", "-t", "tree", "--stdin"], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(out.trim()) : reject(new Error("Could not identify empty tree")));
    child.stdin.end();
  });
  const files = new Set<string>();
  const dirs = new Set<string>([""]);
  for await (const token of gitTokens(repo.git_dir!, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--numstat", "-z", empty, sha, "--"])) {
    const stat = statToken(token);
    if (!stat) continue;
    for (const dir of directoryPaths(stat.path)) dirs.add(dir);
    if (!stat.binary) files.add(stat.path);
  }
  const objects = { files: [...files], directories: [...dirs] };
  db.prepare("INSERT OR REPLACE INTO metric_snapshots VALUES (?, ?, ?)").run(repo.id, sha, JSON.stringify(objects));
  return objects;
}
