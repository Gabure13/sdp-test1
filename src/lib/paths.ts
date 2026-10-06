import fs from "node:fs";
import path from "node:path";

/** Root of all RAT-managed local state (gitignored). */
export const DATA_DIR = path.join(process.cwd(), ".data");

/** SQLite database file holding the repo registry and (later) metrics. */
export const DB_PATH = path.join(DATA_DIR, "rat.db");

/** Per-repository storage: `<id>/repo.git` for clones, `<id>/src` for uploads. */
export const REPOS_DIR = path.join(DATA_DIR, "repos");

export function ensureDataDirs(): void {
  fs.mkdirSync(REPOS_DIR, { recursive: true });
}
