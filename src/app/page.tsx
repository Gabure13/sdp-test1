"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RepoSummary } from "@/lib/types";

const STATUS_LABEL: Record<RepoSummary["status"], string> = {
  pending: "Pending",
  cloning: "Cloning",
  extracting: "Extracting",
  indexing: "Indexing",
  ready: "Ready",
  failed: "Failed",
};

const IN_FLIGHT: RepoSummary["status"][] = [
  "pending",
  "cloning",
  "extracting",
  "indexing",
];

const numberFormat = new Intl.NumberFormat("en-US");

function formatDate(value: string): string {
  return value.replace(" ", " · ").replace("T", " · ");
}

function StatusPill({ repo }: { repo: RepoSummary }) {
  const styles: Record<RepoSummary["status"], string> = {
    pending: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    cloning: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 animate-pulse",
    extracting:
      "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 animate-pulse",
    indexing:
      "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 animate-pulse",
    ready: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[repo.status]}`}
    >
      {STATUS_LABEL[repo.status]}
    </span>
  );
}

function SourceBadge({ repo }: { repo: RepoSummary }) {
  const isClone = repo.source === "clone";
  return (
    <span
      className="inline-block rounded border px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:text-gray-400"
      title={repo.source_detail}
    >
      {isClone ? "clone" : "zip"}
    </span>
  );
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `request failed (${response.status})`;
  } catch {
    return `request failed (${response.status})`;
  }
}

export default function RepositoriesPage() {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/repos", { cache: "no-store" });
      if (!response.ok) throw new Error(await readError(response));
      const body = (await response.json()) as { repos: RepoSummary[] };
      setRepos(body.repos);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "failed to load repositories");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [refresh]);

  const addByClone = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!cloneUrl.trim() || cloning) return;
    setCloning(true);
    setActionError(null);
    try {
      const response = await fetch("/api/repos/clone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: cloneUrl.trim() }),
      });
      if (!response.ok) throw new Error(await readError(response));
      setCloneUrl("");
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "clone failed");
    } finally {
      setCloning(false);
    }
  };

  const addByUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file || uploading) return;
    setUploading(true);
    setActionError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/repos/upload", {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error(await readError(response));
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "upload failed");
    } finally {
      setUploading(false);
    }
  };

  const deleteRepo = async (repo: RepoSummary) => {
    if (!window.confirm(`Remove "${repo.name}" and its ingested data?`)) return;
    setActionError(null);
    try {
      const response = await fetch(`/api/repos/${repo.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await readError(response));
      await refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "delete failed");
    }
  };

  const anyInFlight = repos.some((repo) => IN_FLIGHT.includes(repo.status));

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">RAT — Repo Analysis Tool</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Add repositories by cloning a remote URL or uploading a zip archive.
        </p>
      </header>

      {(loadError || actionError) && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {loadError ?? actionError}
        </div>
      )}

      <section className="mb-8 grid gap-4 md:grid-cols-2">
        <form
          onSubmit={addByClone}
          className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
        >
          <h2 className="mb-3 text-sm font-semibold">Clone from URL</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={cloneUrl}
              onChange={(event) => setCloneUrl(event.target.value)}
              placeholder="https://github.com/user/repo.git"
              className="min-w-0 flex-1 rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-gray-500 dark:border-gray-700"
              disabled={cloning}
            />
            <button
              type="submit"
              disabled={cloning || !cloneUrl.trim()}
              className="shrink-0 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {cloning ? "Adding…" : "Clone"}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Deep clone: full history, all branches.
          </p>
        </form>

        <form
          onSubmit={addByUpload}
          className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
        >
          <h2 className="mb-3 text-sm font-semibold">Upload zip archive</h2>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="min-w-0 flex-1 rounded-md border border-gray-300 bg-transparent px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-transparent file:text-sm file:font-medium dark:border-gray-700"
              disabled={uploading}
            />
            <button
              type="submit"
              disabled={uploading || !fileInputRef.current?.files?.[0]}
              className="shrink-0 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {uploading ? "Adding…" : "Upload"}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            The zip must contain the repository&apos;s{" "}
            <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">.git</code>{" "}
            directory.
          </p>
        </form>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Repositories
            {repos.length > 0 && (
              <span className="ml-2 text-gray-400">{repos.length}</span>
            )}
          </h2>
          {anyInFlight && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              refreshing every 2s…
            </span>
          )}
        </div>

        {repos.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            No repositories yet — add one above.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-4 py-3 font-medium">Repository</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Commits</th>
                  <th className="px-4 py-3 text-right font-medium">Authors</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {repos.map((repo) => (
                  <tr
                    key={repo.id}
                    className="border-b border-gray-100 last:border-0 dark:border-gray-900"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium">
                        <SourceBadge repo={repo} />
                        {repo.name}
                      </div>
                      <div className="mt-0.5 max-w-[22rem] truncate text-xs text-gray-500 dark:text-gray-400">
                        {repo.source_detail}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill repo={repo} />
                      {repo.status_message && (
                        <div
                          className="mt-1 max-w-[18rem] truncate text-xs text-gray-500 dark:text-gray-400"
                          title={repo.status_message}
                        >
                          {repo.status_message}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {repo.status === "ready" ? numberFormat.format(repo.commit_count) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {repo.status === "ready" ? numberFormat.format(repo.author_count) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                      {formatDate(repo.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void deleteRepo(repo)}
                        className="rounded-md border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:border-red-400 hover:text-red-600 dark:border-gray-700 dark:text-gray-400 dark:hover:border-red-800 dark:hover:text-red-400"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="mt-10 text-xs text-gray-400 dark:text-gray-500">
        Repositories and the SQLite database are stored locally under{" "}
        <code className="rounded bg-gray-100 px-1 dark:bg-gray-800">.data/</code>{" "}
        (gitignored).
      </footer>
    </main>
  );
}
