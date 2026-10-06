import { getDb, type RepoRow } from "./db";
import { scanHeadAuthors, type AuthorScanResult } from "./git";
import type {
  AuthorGroupView,
  AuthorIdentityView,
  AuthorOverview,
  ContributingGroupView,
} from "./types";

/**
 * Author identity model:
 * - `authors` are raw (name, email) pairs exactly as git recorded them.
 * - `author_groups` are the mailmap-resolved persons those identities map to.
 * - `author_merges` are manual overrides: group A merged into group B.
 *
 * Resolution walks the manual-merge edges to a final group; an effective
 * author is a final group plus every group (and their identities) that
 * resolves into it. Cycles are rejected when a merge is requested, so the
 * walk is guaranteed to terminate.
 */

export class AuthorMergeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorMergeError";
  }
}

interface AuthorRow {
  id: number;
  name: string;
  email: string;
  commit_count: number;
}

interface GroupRow {
  id: number;
  name: string;
  email: string;
}

interface MemberRow {
  author_id: number;
  group_id: number;
}

interface MergeRow {
  from_group_id: number;
  to_group_id: number;
}

// ---------------------------------------------------------------------------
// Ingestion / backfill
// ---------------------------------------------------------------------------

/** Store the scanned identities and their mailmap groups for a repository. */
export function ensureAuthors(repoId: number, scan: AuthorScanResult): void {
  const db = getDb();
  const insert = db.transaction(() => {
    db.prepare("DELETE FROM author_merges WHERE repo_id = ?").run(repoId);
    // Deleting authors cascades to author_group_members.
    db.prepare("DELETE FROM authors WHERE repo_id = ?").run(repoId);
    db.prepare("DELETE FROM author_groups WHERE repo_id = ?").run(repoId);

    const insertAuthor = db.prepare(
      "INSERT INTO authors (repo_id, name, email, commit_count) VALUES (?, ?, ?, ?)",
    );
    const insertGroup = db.prepare(
      "INSERT INTO author_groups (repo_id, name, email) VALUES (?, ?, ?)",
    );
    const insertMember = db.prepare(
      "INSERT INTO author_group_members (author_id, group_id) VALUES (?, ?)",
    );

    const groupIds = new Map<string, number>();
    for (const identity of scan.identities) {
      const authorId = Number(
        insertAuthor.run(repoId, identity.name, identity.email, identity.commits)
          .lastInsertRowid,
      );
      const key = `${identity.canonicalName}\u0000${identity.canonicalEmail}`;
      let groupId = groupIds.get(key);
      if (groupId === undefined) {
        groupId = Number(
          insertGroup.run(repoId, identity.canonicalName, identity.canonicalEmail)
            .lastInsertRowid,
        );
        groupIds.set(key, groupId);
      }
      insertMember.run(authorId, groupId);
    }
  });
  insert();
}

// Repositories ingested before the author tables existed are backfilled on
// first view. The map keeps concurrent requests from scanning twice.
const backfills = new Map<number, Promise<void>>();

/**
 * Scan and store author identities for a ready repository that has none yet
 * (e.g. ingested before this feature existed). No-op otherwise.
 */
export async function ensureAuthorsForRepo(repo: RepoRow): Promise<void> {
  const db = getDb();
  const existing = db
    .prepare("SELECT 1 FROM authors WHERE repo_id = ? LIMIT 1")
    .get(repo.id);
  if (existing || !repo.git_dir) return;

  let pending = backfills.get(repo.id);
  if (!pending) {
    pending = scanHeadAuthors(repo.git_dir)
      .then((scan) => {
        if (scan.totalCommits > 0) ensureAuthors(repo.id, scan);
      })
      .finally(() => backfills.delete(repo.id));
    backfills.set(repo.id, pending);
  }
  await pending;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export function getAuthorOverview(repoId: number): AuthorOverview {
  const db = getDb();
  const authors = db
    .prepare("SELECT * FROM authors WHERE repo_id = ? ORDER BY commit_count DESC, id")
    .all(repoId) as AuthorRow[];
  const groups = db
    .prepare("SELECT * FROM author_groups WHERE repo_id = ? ORDER BY id")
    .all(repoId) as GroupRow[];
  const members = db
    .prepare(
      `SELECT m.author_id, m.group_id
       FROM author_group_members m
       JOIN authors a ON a.id = m.author_id
       WHERE a.repo_id = ?`,
    )
    .all(repoId) as MemberRow[];
  const merges = db
    .prepare("SELECT from_group_id, to_group_id FROM author_merges WHERE repo_id = ?")
    .all(repoId) as MergeRow[];

  const mergeTarget = new Map<number, number>();
  for (const merge of merges) mergeTarget.set(merge.from_group_id, merge.to_group_id);
  const groupById = new Map(groups.map((group) => [group.id, group]));

  // Follow manual merges to the final group. Cycles are prevented at merge
  // time; the step cap is a defensive backstop.
  const resolveFinal = (groupId: number): number => {
    let current = groupId;
    for (let steps = 0; steps <= groups.length; steps++) {
      const next = mergeTarget.get(current);
      if (next === undefined) return current;
      current = next;
    }
    throw new Error("author merge cycle detected");
  };

  const authorGroup = new Map(members.map((m) => [m.author_id, m.group_id]));
  const groupAuthors = new Map<number, AuthorIdentityView[]>();
  for (const author of authors) {
    const groupId = authorGroup.get(author.id);
    if (groupId === undefined) continue;
    const list = groupAuthors.get(groupId) ?? [];
    list.push({
      authorId: author.id,
      name: author.name,
      email: author.email,
      commits: author.commit_count,
    });
    groupAuthors.set(groupId, list);
  }

  // final group id -> the groups that resolve into it
  const finalToGroups = new Map<number, number[]>();
  for (const group of groups) {
    const final = resolveFinal(group.id);
    const list = finalToGroups.get(final) ?? [];
    list.push(group.id);
    finalToGroups.set(final, list);
  }

  const views: AuthorGroupView[] = [];
  for (const group of groups) {
    if (resolveFinal(group.id) !== group.id) continue; // merged away, not effective
    const contributingIds = finalToGroups.get(group.id) ?? [group.id];
    let commitCount = 0;
    const contributing: ContributingGroupView[] = [];
    // The group itself leads, manually merged groups follow.
    const ordered = [group.id, ...contributingIds.filter((id) => id !== group.id)];
    for (const id of ordered) {
      const source = groupById.get(id);
      if (!source) continue;
      const identities = groupAuthors.get(id) ?? [];
      commitCount += identities.reduce((sum, identity) => sum + identity.commits, 0);
      contributing.push({
        groupId: id,
        name: source.name,
        email: source.email,
        isSelf: id === group.id,
        identities,
      });
    }
    views.push({ groupId: group.id, name: group.name, email: group.email, commitCount, contributing });
  }
  views.sort((a, b) => b.commitCount - a.commitCount || a.name.localeCompare(b.name));
  return { identityCount: authors.length, groups: views };
}

// ---------------------------------------------------------------------------
// Manual merging
// ---------------------------------------------------------------------------

export function mergeAuthorGroups(
  repoId: number,
  fromGroupId: number,
  toGroupId: number,
): AuthorOverview {
  const db = getDb();
  const groups = db
    .prepare("SELECT id FROM author_groups WHERE repo_id = ?")
    .all(repoId) as { id: number }[];
  const groupIds = new Set(groups.map((group) => group.id));
  if (!groupIds.has(fromGroupId) || !groupIds.has(toGroupId)) {
    throw new AuthorMergeError("unknown author group for this repository");
  }
  if (fromGroupId === toGroupId) {
    throw new AuthorMergeError("cannot merge an author into itself");
  }

  // Reject merges that would create a cycle: walk from the target through
  // existing merges; reaching the source group means a loop.
  const merges = db
    .prepare("SELECT from_group_id, to_group_id FROM author_merges WHERE repo_id = ?")
    .all(repoId) as MergeRow[];
  const mergeTarget = new Map<number, number>();
  for (const merge of merges) mergeTarget.set(merge.from_group_id, merge.to_group_id);
  let current = toGroupId;
  for (let steps = 0; steps <= merges.length; steps++) {
    if (current === fromGroupId) {
      throw new AuthorMergeError("that merge would create a cycle");
    }
    const next = mergeTarget.get(current);
    if (next === undefined) break;
    current = next;
  }

  db.prepare(
    `INSERT INTO author_merges (repo_id, from_group_id, to_group_id)
     VALUES (?, ?, ?)
     ON CONFLICT (repo_id, from_group_id) DO UPDATE SET to_group_id = excluded.to_group_id`,
  ).run(repoId, fromGroupId, toGroupId);
  return getAuthorOverview(repoId);
}

export function unmergeAuthorGroup(
  repoId: number,
  fromGroupId: number,
): AuthorOverview {
  const db = getDb();
  const result = db
    .prepare("DELETE FROM author_merges WHERE repo_id = ? AND from_group_id = ?")
    .run(repoId, fromGroupId);
  if (result.changes === 0) {
    throw new AuthorMergeError("that author group is not merged");
  }
  return getAuthorOverview(repoId);
}
