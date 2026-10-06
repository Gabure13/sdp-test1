import Database from "better-sqlite3";
import fs from "node:fs";
import { DATA_DIR, DB_PATH } from "./paths";
import type { RepoSource, RepoStatus } from "./types";

// The repository registry. Metric tables (commits, authors, file changes)
// will be added alongside this in the analysis piece.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('clone', 'upload')),
  source_detail TEXT NOT NULL,
  storage_dir TEXT UNIQUE,
  git_dir TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cloning', 'extracting', 'indexing', 'ready', 'failed')),
  status_message TEXT,
  default_branch TEXT,
  head_sha TEXT,
  commit_count INTEGER NOT NULL DEFAULT 0,
  author_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export interface RepoRow {
  id: number;
  name: string;
  source: RepoSource;
  source_detail: string;
  storage_dir: string | null;
  git_dir: string | null;
  status: RepoStatus;
  status_message: string | null;
  default_branch: string | null;
  head_sha: string | null;
  commit_count: number;
  author_count: number;
  created_at: string;
  updated_at: string;
}

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}
