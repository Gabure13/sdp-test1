import { getDb, type RepoRow } from "./db";
import { getAuthorOverview } from "./authors";
import { directoryPaths, ensureMetricIndex, snapshotObjects, type ChangeRow, type CommitRow } from "./metric-index";
import type { AuthorMetrics, MetricFilter, MetricResult, Metrics, ObjectMetrics } from "./metric-types";

const zero = (): Metrics => ({ added: 0, removed: 0, growth: 0, churn: 0, modifications: 0, frequency: 0, churnRate: 0 });
function finish(m: Metrics, count: number): void {
  m.growth = m.added - m.removed;
  m.churn = m.added + m.removed;
  m.frequency = count ? m.modifications / count : 0;
  m.churnRate = count ? m.churn / count : 0;
}
function add(to: Metrics, from: Pick<Metrics, "added" | "removed" | "modifications">): void {
  to.added += from.added;
  to.removed += from.removed;
  to.modifications += from.modifications;
}
const identityKey = (name: string, email: string) => JSON.stringify([name, email]);

export async function queryMetrics(filter: MetricFilter): Promise<MetricResult> {
  const db = getDb();
  const repos = filter.repoIds.map((id) => db.prepare("SELECT * FROM repos WHERE id = ?").get(id) as RepoRow | undefined);
  if (repos.some((r) => !r || r.status !== "ready")) throw new Error("Choose repositories that have finished importing");
  const result: MetricResult = { total: zero(), commitCount: 0, repositories: [], objects: [], authors: [], authorOptions: [], timeline: [], commits: [], availableCommitCount: 0 };
  const timeline = new Map<string, { date: string; added: number; removed: number; churn: number }>();
  const selectedAuthors = filter.authorIds?.length ? new Set(filter.authorIds) : null;
  const selectedCommits = filter.commits === undefined ? null : new Set(filter.commits);
  const focus = filter.path ?? "";
  const kind = focus ? (filter.kind ?? "directory") : "directory";
  const matches = (p: string, k: string) => !focus || (kind === "file" ? k === "file" && p === focus : p === focus || p.startsWith(focus + "/"));

  for (const repo of repos as RepoRow[]) {
    await ensureMetricIndex(repo);
    const overview = getAuthorOverview(repo.id);
    const rawToGroup = new Map<string, number>();
    const authorStats = new Map<number, AuthorMetrics>();
    for (const group of overview.groups) {
      result.authorOptions.push({ groupId: group.groupId, label: `${repo.name} · ${group.name} <${group.email}>` });
      authorStats.set(group.groupId, { ...zero(), groupId: group.groupId, repoId: repo.id, repoName: repo.name, name: group.name, email: group.email, ownership: 0 });
      for (const source of group.contributing) for (const raw of source.identities) rawToGroup.set(identityKey(raw.name, raw.email), group.groupId);
    }
    const all = db.prepare("SELECT * FROM metric_commits WHERE repo_id = ? AND committed_at >= ? AND committed_at < ? ORDER BY committed_at DESC, sha").all(repo.id, filter.start ?? -8640000000000, filter.end ?? 8640000000000) as CommitRow[];
    const search = (filter.search ?? "").toLowerCase();
    for (const c of all) {
      if (search && !`${c.sha} ${c.subject} ${c.author_name} ${c.author_email}`.toLowerCase().includes(search)) continue;
      result.commits.push({ key: `${repo.id}:${c.sha}`, repoId: repo.id, repoName: repo.name, sha: c.sha, timestamp: c.committed_at, author: authorStats.get(rawToGroup.get(identityKey(c.author_name, c.author_email)) ?? -1)?.name ?? c.author_name, subject: c.subject });
    }
    const commits = selectedCommits ? all.filter((c) => selectedCommits.has(`${repo.id}:${c.sha}`)) : all;
    const commitBySha = new Map(commits.map((c) => [c.sha, c]));
    const count = commits.length;
    result.commitCount += count;
    const objects = new Map<string, ObjectMetrics>();
    const object = (path: string, type: "file" | "directory") => {
      const key = `${type}:${path}`;
      let value = objects.get(key);
      if (!value) {
        value = { ...zero(), repoId: repo.id, repoName: repo.name, path, kind: type };
        objects.set(key, value);
      }
      return value;
    };
    const addPath = (path: string, binary: boolean) => {
      if (!binary) object(path, "file");
      for (const d of directoryPaths(path)) object(d, "directory");
    };

    // H is a collection of parent chains (merges are excluded). A snapshot at
    // each selected chain tip plus both paths of its diffs gives the union of
    // all selected trees AND parent trees, including deleted/unchanged files.
    const selectedParents = new Set(commits.map((c) => c.parent_sha));
    const tips = commits.filter((c) => !selectedParents.has(c.sha));
    for (const tip of tips) {
      const snapshot = await snapshotObjects(repo, tip.sha);
      for (const file of snapshot.files) object(file, "file");
      for (const dir of snapshot.directories) object(dir, "directory");
    }
    let current: CommitRow | undefined;
    let perCommit = new Map<string, Metrics>();
    let fullFocusChurn = 0;
    const repoTotals = { ...zero(), repoId: repo.id, repoName: repo.name, path: focus, kind, commitCount: count };
    const flush = () => {
      if (!current) return;
      const groupId = rawToGroup.get(identityKey(current.author_name, current.author_email));
      const included = !selectedAuthors || (groupId !== undefined && selectedAuthors.has(groupId));
      const focused = perCommit.get(`${kind}:${focus}`) ?? zero();
      fullFocusChurn += focused.added + focused.removed;
      const author = groupId === undefined ? undefined : authorStats.get(groupId);
      if (author) add(author, focused);
      if (included) {
        add(repoTotals, focused);
        for (const [key, value] of perCommit) add(objects.get(key)!, value);
        const date = new Date(current.committed_at * 1000).toISOString().slice(0, 10);
        const day = timeline.get(date) ?? { date, added: 0, removed: 0, churn: 0 };
        day.added += focused.added;
        day.removed += focused.removed;
        day.churn += focused.added + focused.removed;
        timeline.set(date, day);
      }
      perCommit = new Map();
    };
    // Read changes once. Aggregating within each commit prevents directory
    // modification counts from multiplying when several children changed.
    const changes = db.prepare("SELECT * FROM metric_changes WHERE repo_id = ? ORDER BY sha").iterate(repo.id) as Iterable<ChangeRow>;
    for (const change of changes) {
      const commit = commitBySha.get(change.sha);
      if (!commit) continue;
      if (current?.sha !== commit.sha) { flush(); current = commit; }
      addPath(change.path, Boolean(change.binary));
      addPath(change.old_path, Boolean(change.binary));
      if (change.binary) continue;
      const keys = [`file:${change.path}`, ...directoryPaths(change.path).map((p) => `directory:${p}`)];
      for (const key of keys) {
        const metric = perCommit.get(key) ?? zero();
        metric.added += change.added;
        metric.removed += change.removed;
        metric.modifications = Number(metric.added + metric.removed > 0);
        perCommit.set(key, metric);
      }
    }
    flush();
    finish(repoTotals, count);
    add(result.total, repoTotals);
    result.repositories.push(repoTotals);
    for (const metric of objects.values()) {
      finish(metric, count);
      if (matches(metric.path, metric.kind)) result.objects.push(metric);
    }
    for (const author of authorStats.values()) {
      finish(author, count);
      author.ownership = fullFocusChurn ? author.churn / fullFocusChurn : 0;
      if (!selectedAuthors || selectedAuthors.has(author.groupId)) result.authors.push(author);
    }
  }
  finish(result.total, result.commitCount);
  result.objects.sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path));
  result.authors.sort((a, b) => b.churn - a.churn || a.name.localeCompare(b.name));
  result.timeline = [...timeline.values()].sort((a, b) => a.date.localeCompare(b.date));
  result.commits.sort((a, b) => b.timestamp - a.timestamp || a.key.localeCompare(b.key));
  result.availableCommitCount = result.commits.length;
  result.commits = result.commits.slice(filter.offset ?? 0, (filter.offset ?? 0) + 100);
  return result;
}
