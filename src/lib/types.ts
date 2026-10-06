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

// ---------------------------------------------------------------------------
// Author identity views (mailmap + manual merging)
// ---------------------------------------------------------------------------

/** One raw (name, email) identity as recorded in git. */
export interface AuthorIdentityView {
  authorId: number;
  name: string;
  email: string;
  commits: number;
}

/**
 * A person group feeding an effective author. `isSelf` marks the effective
 * group itself; the rest arrived via manual merges and can be unmerged.
 */
export interface ContributingGroupView {
  groupId: number;
  name: string;
  email: string;
  isSelf: boolean;
  identities: AuthorIdentityView[];
}

/** An effective author: the mailmap group plus everything manually merged in. */
export interface AuthorGroupView {
  groupId: number;
  name: string;
  email: string;
  commitCount: number;
  contributing: ContributingGroupView[];
}

export interface AuthorOverview {
  /** Raw identity count (before any merging). */
  identityCount: number;
  groups: AuthorGroupView[];
}
