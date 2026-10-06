import Database from "better-sqlite3";
import fs from "node:fs";
import { DATA_DIR, DB_PATH } from "./paths";
import type { RepoSource, RepoStatus } from "./types";

// The repository registry plus the author identity tables. Raw identities
// come from git as-written; author_groups hold the mailmap-resolved ("person")
// identities; manual merges record one group merged into another.
// Metric tables (commits, file changes) will be added in the analysis piece.
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

CREATE TABLE IF NOT EXISTS authors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  commit_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (repo_id, name, email)
);

CREATE TABLE IF NOT EXISTS author_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  UNIQUE (repo_id, name, email)
);

CREATE TABLE IF NOT EXISTS author_group_members (
  author_id INTEGER PRIMARY KEY REFERENCES authors(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES author_groups(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS author_merges (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  from_group_id INTEGER NOT NULL REFERENCES author_groups(id) ON DELETE CASCADE,
  to_group_id INTEGER NOT NULL REFERENCES author_groups(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repo_id, from_group_id)
);

CREATE TABLE IF NOT EXISTS metric_indexes (
  repo_id INTEGER PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL,
  processed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS metric_commits (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  parent_sha TEXT NOT NULL,
  committed_at INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  PRIMARY KEY (repo_id, sha)
);
CREATE INDEX IF NOT EXISTS metric_commit_dates ON metric_commits(repo_id, committed_at);
CREATE TABLE IF NOT EXISTS metric_changes (
  repo_id INTEGER NOT NULL,
  sha TEXT NOT NULL,
  path TEXT NOT NULL,
  old_path TEXT NOT NULL,
  added INTEGER NOT NULL,
  removed INTEGER NOT NULL,
  binary INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (repo_id, sha) REFERENCES metric_commits(repo_id, sha) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS metric_change_commit ON metric_changes(repo_id, sha);
CREATE TABLE IF NOT EXISTS metric_snapshots (
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  sha TEXT NOT NULL,
  objects TEXT NOT NULL,
  PRIMARY KEY (repo_id, sha)
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
  // Required per-connection for ON DELETE CASCADE to fire.
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
