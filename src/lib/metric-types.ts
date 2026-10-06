export interface MetricFilter {
  repoIds: number[];
  start?: number;
  end?: number;
  commits?: string[];
  authorIds?: number[];
  path?: string;
  kind?: "file" | "directory";
  search?: string;
  offset?: number;
}
export interface Metrics {
  added: number;
  removed: number;
  growth: number;
  churn: number;
  modifications: number;
  frequency: number;
  churnRate: number;
}
export interface ObjectMetrics extends Metrics {
  repoId: number;
  repoName: string;
  path: string;
  kind: "file" | "directory";
}
export interface AuthorMetrics extends Metrics {
  groupId: number;
  repoId: number;
  repoName: string;
  name: string;
  email: string;
  ownership: number;
}
export interface CommitView {
  key: string;
  repoId: number;
  repoName: string;
  sha: string;
  timestamp: number;
  author: string;
  subject: string;
}
export interface MetricResult {
  total: Metrics;
  commitCount: number;
  repositories: (ObjectMetrics & { commitCount: number })[];
  objects: ObjectMetrics[];
  authors: AuthorMetrics[];
  authorOptions: { groupId: number; label: string }[];
  timeline: { date: string; added: number; removed: number; churn: number }[];
  commits: CommitView[];
  availableCommitCount: number;
}
