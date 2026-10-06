"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { RepoSummary } from "@/lib/types";
import type { MetricFilter, MetricResult, Metrics } from "@/lib/metric-types";

const number = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const percent = (value: number) => `${number(value * 100)}%`;
const input = "w-full rounded-lg border border-gray-300 bg-background px-3 py-2 text-sm dark:border-gray-700";
const button = "rounded-lg border border-gray-300 px-3 py-2 text-sm hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-900";
const panel = "rounded-xl border border-gray-200 bg-background p-5 dark:border-gray-800";
const columns: [keyof Metrics, string][] = [["added", "Added"], ["removed", "Removed"], ["growth", "Growth"], ["churn", "Churn"], ["modifications", "Modifications"], ["frequency", "Frequency"], ["churnRate", "Churn / commit"]];

function Cells({ metric }: { metric: Metrics }) {
  return <>{columns.map(([key]) => <td key={key} className={`whitespace-nowrap px-3 py-3 text-right tabular-nums ${key === "added" ? "text-emerald-600 dark:text-emerald-400" : key === "removed" ? "text-rose-600 dark:text-rose-400" : ""}`}>{key === "frequency" ? percent(metric[key]) : number(metric[key])}</td>)}</>;
}

function Timeline({ data }: { data: MetricResult["timeline"] }) {
  const step = Math.max(1, Math.ceil(data.length / 60));
  const buckets = [];
  for (let i = 0; i < data.length; i += step) {
    const slice = data.slice(i, i + step);
    buckets.push({ label: `${slice[0].date} – ${slice[slice.length - 1].date}`, added: slice.reduce((n, d) => n + d.added, 0), removed: slice.reduce((n, d) => n + d.removed, 0) });
  }
  const max = Math.max(1, ...buckets.map((d) => d.added + d.removed));
  return <section className={panel} aria-label="Added and removed lines over time">
    <div className="flex justify-between gap-3"><h2 className="font-semibold">Activity over time</h2><span className="text-xs"><span className="text-emerald-600">Added</span> / <span className="text-rose-600">Removed</span></span></div>
    {buckets.length ? <><div className="mt-5 flex h-36 items-end gap-1">{buckets.map((d) => <div key={d.label} className="flex min-w-0 flex-1 flex-col justify-end" style={{ height: `${Math.max(1, (d.added + d.removed) / max * 100)}%` }} title={`${d.label}: +${number(d.added)} / −${number(d.removed)}`}><div className="min-h-0 bg-rose-400" style={{ flex: d.removed }} /><div className="min-h-0 bg-emerald-500" style={{ flex: d.added }} /></div>)}</div><div className="mt-2 flex justify-between text-xs text-gray-500"><span>{data[0]?.date}</span><span>{data[data.length - 1]?.date}</span></div></> : <p className="py-12 text-center text-sm text-gray-500">No activity in this selection.</p>}
  </section>;
}

export default function MetricsPage() {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [repoIds, setRepoIds] = useState<number[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [author, setAuthor] = useState("");
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<"file" | "directory">("directory");
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [tab, setTab] = useState<"file" | "directory" | "authors" | "commits">("file");
  const [objectPage, setObjectPage] = useState(0);
  const [result, setResult] = useState<MetricResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    fetch("/api/repos", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) throw new Error("Could not load repositories");
      const body = await r.json() as { repos: RepoSummary[] };
      const ready = body.repos.filter((repo) => repo.status === "ready");
      setRepos(ready);
      const requested = Number(new URL(window.location.href).searchParams.get("repo"));
      setRepoIds(ready.some((r) => r.id === requested) ? [requested] : ready.map((r) => r.id));
      setInitialized(true);
    }).catch((e: Error) => setError(e.message));
  }, []);

  const filter = useMemo<MetricFilter>(() => ({
    repoIds,
    start: start ? Math.floor(new Date(start).getTime() / 1000) : undefined,
    end: end ? Math.floor(new Date(end).getTime() / 1000) : undefined,
    authorIds: author ? [Number(author)] : undefined,
    path: path.replace(/^\.\//, "").replace(/\/$/, ""), kind,
    commits: manual ? selected : undefined,
    search, offset,
  }), [repoIds, start, end, author, path, kind, manual, selected, search, offset]);

  useEffect(() => {
    if (!initialized) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      fetch("/api/metrics", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(filter), signal: controller.signal }).then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Analysis failed");
        setResult(body as MetricResult);
        setObjectPage(0);
      }).catch((e: Error) => { if (e.name !== "AbortError") setError(e.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [filter, initialized, reload]);

  useEffect(() => {
    if (!busy) return;
    const poll = () => fetch("/api/metrics").then((r) => r.json()).then((body: { indexes: { repo_id: number; status: string; processed: number }[] }) => {
      const active = body.indexes.filter((r) => repoIds.includes(r.repo_id) && r.status === "indexing");
      setProgress(active.map((r) => `${repos.find((repo) => repo.id === r.repo_id)?.name ?? "Repository"}: ${number(r.processed)} commits indexed`).join(" · "));
    }).catch(() => {});
    void poll();
    const timer = setInterval(poll, 1500);
    return () => clearInterval(timer);
  }, [busy, repoIds, repos]);

  const clear = () => { setStart(""); setEnd(""); setAuthor(""); setPath(""); setKind("directory"); setManual(false); setSelected([]); setSearch(""); setOffset(0); };
  const focusObject = (p: string, k: "file" | "directory") => { setPath(p); setKind(k); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const exportCsv = () => {
    if (!result) return;
    const quote = (v: string | number) => `"${String(typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v).replaceAll('"', '""')}"`;
    const rows = [["Repository", "Kind", "Path", ...columns.map(([, label]) => label)], ...result.objects.map((m) => [m.repoName, m.kind, m.path || "/", ...columns.map(([key]) => m[key])])];
    const url = URL.createObjectURL(new Blob([rows.map((row) => row.map(quote).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "rat-metrics.csv"; a.click(); URL.revokeObjectURL(url);
  };
  const objects = result?.objects.filter((o) => o.kind === tab) ?? [];
  const headers = <>{columns.map(([key, label]) => <th key={key} className="whitespace-nowrap px-3 py-3 text-right font-medium">{label}</th>)}</>;

  return <main className="mx-auto min-h-screen max-w-7xl px-4 py-8 sm:px-6">
    <header className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><Link href="/" className="text-sm text-gray-500 hover:underline">← Repositories</Link><h1 className="mt-2 text-3xl font-semibold tracking-tight">Repository insights</h1><p className="mt-1 text-sm text-gray-500">File, directory, repository and author metrics from non-merge HEAD history.</p></div><div className="flex gap-2"><button onClick={() => setReload((n) => n + 1)} className={button}>Refresh</button><button onClick={exportCsv} disabled={!result || busy} className={button}>Export CSV</button></div></header>
    <section className={`${panel} mb-6`} aria-label="Metric filters">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Filters</h2><button className="text-sm text-blue-600 hover:underline" onClick={clear}>Reset filters</button></div>
      <fieldset className="mb-4"><legend className="mb-2 text-xs font-medium text-gray-500">REPOSITORIES</legend><div className="flex flex-wrap gap-2">{repos.map((repo) => <label key={repo.id} className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${repoIds.includes(repo.id) ? "border-blue-400 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200" : "border-gray-300 dark:border-gray-700"}`}><input type="checkbox" checked={repoIds.includes(repo.id)} onChange={(e) => { setRepoIds((ids) => e.target.checked ? [...ids, repo.id] : ids.filter((id) => id !== repo.id)); setAuthor(""); setOffset(0); }} className="mr-2" />{repo.name}</label>)}{initialized && !repos.length && <Link className="text-sm text-blue-600 underline" href="/">Import a repository to get started.</Link>}</div></fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs text-gray-500">From (inclusive, local time)<input type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); setOffset(0); }} className={`${input} mt-1`} /></label>
        <label className="text-xs text-gray-500">Until (exclusive, local time)<input type="datetime-local" value={end} onChange={(e) => { setEnd(e.target.value); setOffset(0); }} className={`${input} mt-1`} /></label>
        <label className="text-xs text-gray-500">Author after merging<select value={author} onChange={(e) => setAuthor(e.target.value)} className={`${input} mt-1`}><option value="">All authors</option>{result?.authorOptions.map((a) => <option key={a.groupId} value={a.groupId}>{a.label}</option>)}</select></label>
        <label className="text-xs text-gray-500">Object type<select value={kind} onChange={(e) => setKind(e.target.value as "file" | "directory")} className={`${input} mt-1`}><option value="directory">Directory (recursive)</option><option value="file">Exact file</option></select></label>
        <label className="text-xs text-gray-500">Path (blank = repository root)<input value={path} onChange={(e) => setPath(e.target.value)} placeholder="src or src/app/page.tsx" className={`${input} mt-1`} /></label>
      </div>
      <p className="mt-3 text-xs text-gray-500">Dates use committer timestamps. Frequency and churn rate divide by all commits in H, including zero-change commits. Author filtering keeps that denominator; ownership uses all-author churn on the chosen object.</p>
    </section>
    {error && <div role="alert" className="mb-5 rounded-xl border border-red-300 bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-200">{error} <button className="ml-3 underline" onClick={() => setReload((n) => n + 1)}>Retry</button></div>}
    {busy && <div role="status" className="mb-5 rounded-xl bg-blue-50 p-4 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">{progress || "Calculating metrics… The first analysis indexes history; later queries use SQLite."}</div>}
    {result && <div className={busy ? "opacity-60" : ""} aria-busy={busy}>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">{[["Commits in H", number(result.commitCount)], ...columns.map(([key, label]) => [label, key === "frequency" ? percent(result.total[key]) : number(result.total[key])])].map(([label, value]) => <div key={label} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"><p className="text-xs text-gray-500">{label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p></div>)}</div>
      <div className="mb-6 grid gap-5 lg:grid-cols-2"><Timeline data={result.timeline} /><section className={panel}><h2 className="font-semibold">Author ownership · {path || "repository root"}</h2><p className="mt-1 text-xs text-gray-500">Churn share within each repository · top 6</p><div className="mt-4 space-y-3">{result.authors.slice(0, 6).map((a) => <div key={a.groupId}><div className="mb-1 flex justify-between gap-2 text-xs"><span className="truncate">{a.name} <span className="text-gray-500">· {a.repoName}</span></span><span>{percent(a.ownership)} · {number(a.churn)} lines</span></div><div className="h-2 rounded bg-gray-100 dark:bg-gray-800"><div className="h-full rounded bg-blue-500" style={{ width: `${a.ownership * 100}%` }} /></div></div>)}{!result.authors.length && <p className="text-sm text-gray-500">No authors in this selection.</p>}</div></section></div>
      <section className={`${panel} mb-6 overflow-x-auto`}><h2 className="mb-3 font-semibold">Repository comparison{path && ` · ${path}`}</h2><table className="w-full text-sm"><thead className="border-b text-xs text-gray-500"><tr><th className="py-3 text-left">Repository</th><th className="px-3 text-right">Commits</th>{headers}</tr></thead><tbody>{result.repositories.map((r) => <tr key={r.repoId} className="border-b border-gray-100 dark:border-gray-800"><td className="whitespace-nowrap py-3"><Link className="text-blue-600 hover:underline" href={`/repos/${r.repoId}`}>{r.repoName} · manage authors ↗</Link></td><td className="px-3 text-right">{number(r.commitCount)}</td><Cells metric={r} /></tr>)}</tbody></table></section>
      <section className={panel}>
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Metric views">{(["file", "directory", "authors", "commits"] as const).map((value) => <button key={value} role="tab" aria-selected={tab === value} onClick={() => { setTab(value); setObjectPage(0); }} className={`${button} ${tab === value ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-200" : ""}`}>{value === "file" ? "Files" : value === "directory" ? "Directories" : value === "authors" ? "Authors" : "Choose commits"}</button>)}</div>
        {(tab === "file" || tab === "directory") && <><p className="mb-3 text-xs text-gray-500">{number(objects.length)} objects · click a path to inspect it. Deleted and unchanged text files are included. Directory rows roll up descendants; do not sum parent and child rows.</p><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-b text-xs text-gray-500"><tr><th className="py-3 text-left">Repository / path</th>{headers}</tr></thead><tbody>{objects.slice(objectPage, objectPage + 100).map((m) => <tr key={`${m.repoId}:${m.kind}:${m.path}`} className="border-b border-gray-100 dark:border-gray-800"><td className="min-w-56 py-3"><span className="block text-xs text-gray-500">{m.repoName}</span><button onClick={() => focusObject(m.path, m.kind)} className="break-all text-left font-mono text-xs text-blue-600 hover:underline">{m.path || "/"}{m.kind === "directory" && m.path ? "/" : ""}</button></td><Cells metric={m} /></tr>)}</tbody></table>{!objects.length && <p className="py-8 text-center text-sm text-gray-500">No matching objects. Check the path or reset filters.</p>}</div><div className="mt-4 flex items-center justify-between text-sm"><button disabled={objectPage === 0} onClick={() => setObjectPage((n) => n - 100)} className={button}>Previous</button><span>{objects.length ? objectPage + 1 : 0}–{Math.min(objectPage + 100, objects.length)} of {number(objects.length)}</span><button disabled={objectPage + 100 >= objects.length} onClick={() => setObjectPage((n) => n + 100)} className={button}>Next</button></div></>}
        {tab === "authors" && <div className="overflow-x-auto"><p className="mb-3 text-xs text-gray-500">Author metrics for {kind} {path || "/"}. Merge identities using the repository links above; Refresh applies changes without re-indexing.</p><table className="w-full text-sm"><thead className="border-b text-xs text-gray-500"><tr><th className="py-3 text-left">Author</th>{headers}<th className="px-3 text-right">Ownership</th></tr></thead><tbody>{result.authors.map((a) => <tr key={a.groupId} className="border-b border-gray-100 dark:border-gray-800"><td className="py-3"><span className="block font-medium">{a.name}</span><span className="text-xs text-gray-500">{a.repoName} · {a.email}</span></td><Cells metric={a} /><td className="px-3 text-right">{percent(a.ownership)}</td></tr>)}</tbody></table></div>}
        {tab === "commits" && <><div className="mb-4 flex flex-wrap items-center gap-3"><label className="text-sm"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} className="mr-2" />Use only checked commits ({selected.length})</label><button onClick={() => setSelected([])} className={button}>Clear selection</button><button className={button} onClick={() => setSelected((old) => [...new Set([...old, ...result.commits.map((c) => c.key)])])}>Select this page</button></div><input aria-label="Search commits" className={`${input} mb-3`} value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} placeholder="Find commits by SHA, message or author (search does not change H)" /><div className="max-h-96 overflow-auto">{result.commits.map((c) => <label key={c.key} className="flex cursor-pointer items-start gap-3 border-b border-gray-100 py-3 dark:border-gray-800"><input type="checkbox" checked={selected.includes(c.key)} onChange={(e) => setSelected((old) => e.target.checked ? [...old, c.key] : old.filter((key) => key !== c.key))} className="mt-1" /><span className="min-w-0"><span className="block truncate text-sm">{c.subject || "(no message)"}</span><span className="text-xs text-gray-500"><code>{c.sha.slice(0, 10)}</code> · {c.repoName} · {c.author} · {new Date(c.timestamp * 1000).toLocaleString()}</span></span></label>)}</div><div className="mt-4 flex items-center justify-between text-sm"><button disabled={busy || offset === 0} onClick={() => setOffset((n) => n - 100)} className={button}>Previous</button><span>{result.availableCommitCount ? offset + 1 : 0}–{Math.min(offset + 100, result.availableCommitCount)} of {number(result.availableCommitCount)}</span><button disabled={busy || offset + 100 >= result.availableCommitCount} onClick={() => setOffset((n) => n + 100)} className={button}>Next</button></div></>}
      </section>
      <footer className="mt-6 text-xs text-gray-500">Growth = added − removed · Churn = added + removed · Modifications count commits with positive churn · Pure renames contribute zero · Rename threshold 50% · Binary changes excluded · All data stays local.</footer>
    </div>}
  </main>;
}
