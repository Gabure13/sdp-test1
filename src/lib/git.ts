import { execFile, spawn } from "node:child_process";

// Keep git non-interactive: fail fast instead of hanging on credential
// prompts when a clone URL points at a private repository.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitError";
  }
}

function execGit(args: string[], gitDir?: string): Promise<string> {
  const fullArgs = gitDir ? ["--git-dir", gitDir, ...args] : args;
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      fullArgs,
      { env: GIT_ENV, maxBuffer: 512 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new GitError(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

/** Verify the git binary is available on PATH. */
export async function gitVersion(): Promise<string> {
  const out = await execGit(["--version"]);
  return out.trim();
}

export interface ScannedAuthorIdentity {
  /** Raw identity exactly as recorded in the commit. */
  name: string;
  email: string;
  /** Identity after applying the repository's committed .mailmap. */
  canonicalName: string;
  canonicalEmail: string;
  /** Number of non-merge commits in the HEAD history authored here. */
  commits: number;
}

export interface AuthorScanResult {
  /** Total non-merge commits reachable from HEAD (the metrics universe H-bar). */
  totalCommits: number;
  identities: ScannedAuthorIdentity[];
}

/**
 * Scan the HEAD history (non-merge commits only) collecting each distinct raw
 * author identity, its commit count, and its mailmap-resolved counterpart.
 * One log pass: %an/%ae are raw, %aN/%aE apply the committed .mailmap.
 */
export async function scanHeadAuthors(gitDir: string): Promise<AuthorScanResult> {
  let out: string;
  try {
    out = await execGit(
      [
        // Always resolve through the .mailmap committed at HEAD. Without this,
        // git looks for a worktree .mailmap relative to the process cwd, which
        // breaks for non-bare (uploaded) repositories. Missing blob = no-op.
        "-c",
        "mailmap.blob=HEAD:.mailmap",
        "log",
        "HEAD",
        "--no-merges",
        "--format=%an%x00%ae%x00%aN%x00%aE",
        "-z",
      ],
      gitDir,
    );
  } catch (err) {
    // An unborn HEAD (no commits yet) is not an error for the caller.
    if (
      err instanceof GitError &&
      /does not have any commits|ambiguous argument/i.test(err.message)
    ) {
      return { totalCommits: 0, identities: [] };
    }
    throw err;
  }
  const byRaw = new Map<string, ScannedAuthorIdentity>();
  let totalCommits = 0;
  const fields = out.split("\0");
  for (let i = 0; i + 3 < fields.length; i += 4) {
    totalCommits++;
    const [name, email, canonicalName, canonicalEmail] = fields.slice(i, i + 4);
    const key = `${name}\u0000${email}`;
    const existing = byRaw.get(key);
    if (existing) {
      existing.commits++;
    } else {
      byRaw.set(key, { name, email, canonicalName, canonicalEmail, commits: 1 });
    }
  }
  return { totalCommits, identities: [...byRaw.values()] };
}

export async function headInfo(
  gitDir: string,
): Promise<{ branch: string | null; sha: string | null }> {
  const result: { branch: string | null; sha: string | null } = {
    branch: null,
    sha: null,
  };
  try {
    result.branch = (await execGit(["rev-parse", "--abbrev-ref", "HEAD"], gitDir)).trim();
  } catch {
    /* empty repository */
  }
  try {
    result.sha = (await execGit(["rev-parse", "HEAD"], gitDir)).trim();
  } catch {
    /* empty repository */
  }
  return result;
}

/**
 * Deep clone (full history, all branches) of a remote URL into `dest` as a
 * bare repository. `onProgress` receives a short human-readable status line
 * (e.g. "Receiving objects: 42%") while the clone runs.
 */
export function cloneRepo(
  url: string,
  dest: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["clone", "--bare", "--progress", url, dest],
      { env: GIT_ENV, stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    let lastLine = "";
    let lastEmit = 0;
    child.stderr.on("data", (chunk: Buffer) => {
      const lines = chunk
        .toString()
        .replace(/\r/g, "\n")
        .split("\n")
        .filter(Boolean);
      if (lines.length > 0) lastLine = lines[lines.length - 1];
      const now = Date.now();
      if (onProgress && now - lastEmit > 400) {
        lastEmit = now;
        onProgress(lastLine.replace(/^remote:\s*/, "").slice(0, 160));
      }
    });
    child.on("error", (err) => reject(new GitError(err.message)));
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = lastLine.replace(/^remote:\s*/, "").trim();
      reject(new GitError(detail || `git clone exited with code ${code}`));
    });
  });
}

/** Accept https/http/git/ssh URLs and scp-style `user@host:path` remotes. */
export function isValidRemoteUrl(value: string): boolean {
  const url = value.trim();
  if (!url || /\s/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "git:" ||
      parsed.protocol === "ssh:"
    );
  } catch {
    return /^[A-Za-z0-9._~-]+@[A-Za-z0-9._-]+:\S+$/.test(url);
  }
}

/** Human-friendly repository name derived from a remote URL. */
export function repoNameFromUrl(value: string): string {
  const url = value.trim();
  const tail = (() => {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split("/").filter(Boolean);
      return segments[segments.length - 1] ?? parsed.hostname;
    } catch {
      const afterColon = url.slice(url.indexOf(":") + 1);
      const segments = afterColon.split("/").filter(Boolean);
      return segments[segments.length - 1] ?? url;
    }
  })();
  return tail.replace(/\.git$/i, "") || "repository";
}
