"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type {
  AuthorGroupView,
  AuthorIdentityView,
  AuthorOverview,
  RepoSummary,
} from "@/lib/types";

const numberFormat = new Intl.NumberFormat("en-US");

const STATUS_LABEL: Record<RepoSummary["status"], string> = {
  pending: "Pending",
  cloning: "Cloning",
  extracting: "Extracting",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

const STATUS_STYLES: Record<RepoSummary["status"], string> = {
  pending: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  cloning: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 animate-pulse",
  extracting: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 animate-pulse",
  indexing: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 animate-pulse",
  ready: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
};

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `request failed (${response.status})`;
  } catch {
    return `request failed (${response.status})`;
  }
}

function IdentityList({ identities }: { identities: AuthorIdentityView[] }) {
  return (
    <ul className="mt-1.5 space-y-1">
      {identities.map((identity) => (
        <li key={identity.authorId} className="flex flex-wrap justify-between gap-x-4">
          <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
            {identity.name} &lt;{identity.email}&gt;
          </span>
          <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {numberFormat.format(identity.commits)}{" "}
            {identity.commits === 1 ? "commit" : "commits"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AuthorCard({
  group,
  others,
  mergeTarget,
  onSelectTarget,
  onMerge,
  onUnmerge,
  busy,
}: {
  group: AuthorGroupView;
  others: AuthorGroupView[];
  mergeTarget: string;
  onSelectTarget: (value: string) => void;
  onMerge: (group: AuthorGroupView, targetId: number) => void;
  onUnmerge: (fromGroupId: number) => void;
  busy: boolean;
}) {
  return (
    <article className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-medium">{group.name}</h3>
          <p className="truncate font-mono text-xs text-gray-500 dark:text-gray-400">
            {group.email}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm tabular-nums text-gray-600 dark:text-gray-300">
            {numberFormat.format(group.commitCount)}{" "}
            {group.commitCount === 1 ? "commit" : "commits"}
          </span>
          {others.length > 0 && (
            <>
              <select
                value={mergeTarget}
                onChange={(event) => onSelectTarget(event.target.value)}
                disabled={busy}
                className="rounded-md border border-gray-300 bg-transparent px-2 py-1 text-xs dark:border-gray-700"
                aria-label={`Merge ${group.name} into another author`}
              >
                <option value="">Merge into…</option>
                {others.map((other) => (
                  <option key={other.groupId} value={other.groupId}>
                    {other.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !mergeTarget}
                onClick={() => onMerge(group, Number(mergeTarget))}
                className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background disabled:opacity-50"
              >
                Merge
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {group.contributing.map((contributing) => (
          <div
            key={contributing.groupId}
            className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {contributing.isSelf
                  ? contributing.identities.length > 1
                    ? "identities (joined by .mailmap)"
                    : "identity"
                  : `merged from ${contributing.name}`}
              </span>
              {!contributing.isSelf && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onUnmerge(contributing.groupId)}
                  className="rounded-md border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:border-red-400 hover:text-red-600 dark:border-gray-700 dark:text-gray-400 dark:hover:border-red-800 dark:hover:text-red-400"
                >
                  Unmerge
                </button>
              )}
            </div>
            <IdentityList identities={contributing.identities} />
          </div>
        ))}
      </div>
    </article>
  );
}

export default function RepoAuthorsPage() {
  const params = useParams<{ id: string }>();
  const repoId = params?.id;
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [authors, setAuthors] = useState<AuthorOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mergeTargets, setMergeTargets] = useState<Record<number, string>>({});

  const refresh = useCallback(async () => {
    if (!repoId) return;
    try {
      const response = await fetch(`/api/repos/${repoId}/authors`, { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as {
        repo: RepoSummary;
        authors: AuthorOverview;
      };
      setRepo(body.repo);
      setAuthors(body.authors);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "failed to load authors");
    } finally {
      setLoading(false);
    }
  }, [repoId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applyOverview = (overview: AuthorOverview) => {
    setAuthors(overview);
    setMergeTargets({});
  };

  const doMerge = async (group: AuthorGroupView, targetId: number) => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/repos/${repoId}/authors/merge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromGroupId: group.groupId, toGroupId: targetId }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { authors: AuthorOverview };
      applyOverview(body.authors);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "merge failed");
    } finally {
      setBusy(false);
    }
  };

  const doUnmerge = async (fromGroupId: number) => {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/repos/${repoId}/authors/merge?fromGroupId=${fromGroupId}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { authors: AuthorOverview };
      applyOverview(body.authors);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "unmerge failed");
    } finally {
      setBusy(false);
    }
  };

  const groups = authors?.groups ?? [];

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">
      <Link
        href="/"
        className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        ← Repositories
      </Link>
      <Link href={`/metrics?repo=${repoId}`} className="ml-5 text-sm text-blue-600 hover:underline">
        View metrics →
      </Link>

      {loading ? (
        <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">Loading authors…</p>
      ) : loadError ? (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {loadError}
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700"
          >
            Retry
          </button>
        </div>
      ) : repo && (
        <>
          <header className="mb-6 mt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{repo.name}</h1>
              <span
                className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[repo.status]}`}
              >
                {STATUS_LABEL[repo.status]}
              </span>
            </div>
            <p className="mt-1 max-w-[36rem] truncate font-mono text-xs text-gray-500 dark:text-gray-400">
              {repo.source_detail}
            </p>
          </header>

          {repo.status !== "ready" && (
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-900 dark:bg-yellow-950 dark:text-yellow-300">
              {repo.status === "failed"
                ? repo.status_message ?? "This repository failed to ingest."
                : "This repository is still being ingested — authors will appear once it is ready."}
            </div>
          )}

          {repo.status === "ready" && authors && (
            <>
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  Authors
                  <span className="ml-2 text-gray-400">
                    {groups.length} effective · {authors.identityCount} raw identities
                  </span>
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  .mailmap identities are joined automatically; merge manually below.
                </p>
              </div>

              {actionError && (
                <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                  {actionError}
                </div>
              )}

              {groups.length === 0 ? (
                <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  No authors found in this repository.
                </p>
              ) : (
                <div className="space-y-4">
                  {groups.map((group) => (
                    <AuthorCard
                      key={group.groupId}
                      group={group}
                      others={groups.filter((other) => other.groupId !== group.groupId)}
                      mergeTarget={mergeTargets[group.groupId] ?? ""}
                      onSelectTarget={(value) =>
                        setMergeTargets((current) => ({
                          ...current,
                          [group.groupId]: value,
                        }))
                      }
                      onMerge={(g, targetId) => void doMerge(g, targetId)}
                      onUnmerge={(fromGroupId) => void doUnmerge(fromGroupId)}
                      busy={busy}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </main>
  );
}
