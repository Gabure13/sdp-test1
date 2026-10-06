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

export async function countCommits(gitDir: string): Promise<number> {
  const out = await execGit(["rev-list", "--all", "--count"], gitDir);
  return parseInt(out.trim(), 10) || 0;
}

export interface AuthorIdentity {
  name: string;
  email: string;
}

/**
 * Distinct (name, email) author identities across all refs. This is the raw
 * identity set; mailmap/manual merging happens later in the metrics layer.
 */
export async function listAuthors(gitDir: string): Promise<AuthorIdentity[]> {
  const out = await execGit(["log", "--all", "--format=%an%x09%ae"], gitDir);
  const seen = new Set<string>();
  const authors: AuthorIdentity[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const sep = line.indexOf("\t");
    if (sep === -1) continue;
    const name = line.slice(0, sep);
    const email = line.slice(sep + 1);
    const key = `${name}\u0000${email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    authors.push({ name, email });
  }
  return authors;
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
