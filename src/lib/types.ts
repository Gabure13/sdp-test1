// Shared types used by both the API routes and the dashboard UI.

export type RepoSource = "clone" | "upload";

export type RepoStatus =
  | "pending"
  | "cloning"
  | "extracting"
  | "indexing"
  | "ready"
  | "failed";

export interface RepoSummary {
  id: number;
  name: string;
  source: RepoSource;
  source_detail: string;
  status: RepoStatus;
  status_message: string | null;
  default_branch: string | null;
  commit_count: number;
  author_count: number;
  created_at: string;
}
