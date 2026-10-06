/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");

// Use the project's compiler so tests need no additional runtime dependency.
require.extensions[".ts"] = (module, filename) => {
  const out = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(out.outputText, filename);
};
const root = path.resolve(__dirname, "..");
fs.mkdirSync(path.join(root, ".data"), { recursive: true });
const isolated = fs.mkdtempSync(path.join(root, ".data", "metrics-test-"));
process.chdir(isolated);
const source = path.join(isolated, "fixture");
fs.mkdirSync(source);
const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
git("init", "-b", "main");
const write = (file, text) => {
  const dest = path.join(source, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, text);
  git("add", "--", file);
};
let time = 1700000000;
const commits = [];
const commit = (subject, name = "Alice", email = "alice@example.com") => {
  const timestamp = time++;
  execFileSync("git", ["-C", source, "-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "--allow-empty", "-m", subject], {
    env: { ...process.env, GIT_COMMITTER_DATE: `@${timestamp} +0000`, GIT_AUTHOR_DATE: "@1600000000 +0000" }, stdio: "pipe",
  });
  const c = { sha: git("rev-parse", "HEAD"), timestamp };
  commits.push(c);
  return c;
};
const lines = Array.from({ length: 10 }, (_, i) => `unique line ${i}\n`).join("");
write("src/a.txt", lines);
write("src/nested/b.txt", "one\ntwo\n");
write("unchanged-empty.txt", "");
write("binary/image.bin", Buffer.from([0, 1, 2, 3]));
write("tab\tname\n{a => b}.txt", "odd path\n");
write(".mailmap", "Alice <alice@example.com> Alias <alias@example.com>\n");
const first = commit("initial");
write("src/a.txt", lines.replace("unique line 0", "edited line 0"));
write("src/nested/b.txt", "one\ntwo\nthree\n");
const edit = commit("two children changed", "Alias", "alias@example.com");
git("mv", "src/a.txt", "src/new.txt");
const rename = commit("pure rename", "Bob", "bob@example.com");
git("mv", "src/new.txt", "src/final.txt");
write("src/final.txt", lines.replace("unique line 0", "edited line 0").replace("unique line 9", "edited line 9"));
const renameEdit = commit("rename and edit", "Bob", "bob@example.com");
git("update-index", "--force-remove", "src/nested/b.txt");
fs.renameSync(path.join(source, "src/nested/b.txt"), path.join(isolated, "deleted-file-backup.txt"));
const deletion = commit("delete file");
const empty = commit("empty commit");
git("checkout", "-b", "topic");
write("topic.txt", "topic\n");
commit("topic work", "Bob", "bob@example.com");
git("checkout", "main");
write("main.txt", "main\n");
commit("main work");
git("-c", "user.name=Merge Only", "-c", "user.email=merge@example.com", "merge", "--no-ff", "topic", "-m", "merge excluded");
const mergeSha = git("rev-parse", "HEAD");
write("after.txt", "after\n");
const afterMerge = commit("after merge");
git("checkout", "-b", "unmerged", first.sha);
write("unreachable.txt", "not in HEAD\n");
commit("unreachable", "Other", "other@example.com");
git("checkout", "main");

const { getDb } = require(path.join(root, "src/lib/db.ts"));
const { queryMetrics } = require(path.join(root, "src/lib/metrics.ts"));
const { getAuthorOverview, mergeAuthorGroups, unmergeAuthorGroup } = require(path.join(root, "src/lib/authors.ts"));
const db = getDb();
const register = (name, gitDir) => Number(db.prepare("INSERT INTO repos(name, source, source_detail, git_dir, head_sha, status) VALUES (?, 'upload', 'test', ?, ?, 'ready')").run(name, gitDir, git("rev-parse", "HEAD")).lastInsertRowid);
const repoId = register("fixture", path.join(source, ".git"));
const run = (f = {}) => queryMetrics({ repoIds: [repoId], ...f });
const only = (c) => ({ commits: [`${repoId}:${c.sha}`] });

// One sequential suite shares only its isolated fixture, never the user's DB.
test("RAT metric definitions and filters", async (t) => {
  await t.test("initial adds, binaries, empty and unusual paths", async () => {
    const r = await run(only(first));
    assert.equal(r.total.added, 14);
    assert.equal(r.total.removed, 0);
    assert.equal(r.total.modifications, 1);
    assert(r.objects.some((o) => o.path === "tab\tname\n{a => b}.txt" && o.added === 1));
    assert(!r.objects.some((o) => o.path === "binary/image.bin"));
    assert(r.objects.some((o) => o.path === "unchanged-empty.txt" && o.churn === 0));
  });
  await t.test("recursive directory modifications count once per commit", async () => {
    const r = await run({ ...only(edit), path: "src", kind: "directory" });
    assert.equal(r.total.added, 2); assert.equal(r.total.removed, 1);
    assert.equal(r.total.modifications, 1); assert.equal(r.total.churn, 3);
    assert.equal(r.total.growth, 1); assert.equal(r.total.frequency, 1);
    assert.equal(r.authors.find((a) => a.name === "Alice").ownership, 1);
  });
  await t.test("pure rename contributes no churn or modifications", async () => {
    const r = await run(only(rename));
    assert.equal(r.total.churn, 0); assert.equal(r.total.modifications, 0);
    assert(r.objects.some((o) => o.path === "src/a.txt"));
    assert(r.objects.some((o) => o.path === "src/new.txt"));
  });
  await t.test("rename plus edit attributed only to new path", async () => {
    const r = await run(only(renameEdit));
    assert.equal(r.total.churn, 2);
    assert.equal(r.objects.find((o) => o.path === "src/final.txt").churn, 2);
    assert.equal(r.objects.find((o) => o.path === "src/new.txt").churn, 0);
  });
  await t.test("deleted files and directories remain measurable", async () => {
    const r = await run({ ...only(deletion), path: "src/nested", kind: "directory" });
    assert.equal(r.total.removed, 3); assert.equal(r.total.growth, -3);
    assert.equal(r.objects.find((o) => o.path === "src/nested/b.txt").removed, 3);
  });
  await t.test("time boundaries use committer date, end exclusive", async () => {
    const r = await run({ start: edit.timestamp, end: rename.timestamp });
    assert.equal(r.commitCount, 1); assert.equal(r.total.churn, 3);
  });
  await t.test("empty selection and zero-change commit have finite zero rates", async () => {
    const r = await run({ commits: [] });
    assert.equal(r.commitCount, 0); assert.equal(r.total.frequency, 0); assert.equal(r.total.churnRate, 0);
    const e = await run(only(empty));
    assert.equal(e.commitCount, 1); assert.equal(e.total.churn, 0);
    assert(e.objects.some((o) => o.path === "src/final.txt" && o.churn === 0));
  });
  await t.test("HEAD reachability, merge exclusion and parent snapshot union", async () => {
    const r = await run();
    assert.equal(r.commitCount, 9);
    assert.equal(r.total.added, 20); assert.equal(r.total.removed, 5);
    assert.equal(r.total.modifications, 7); assert.equal(r.total.frequency, 7 / 9);
    assert.equal(r.total.churnRate, 25 / 9);
    assert(!r.commits.some((c) => c.sha === mergeSha || c.subject === "unreachable"));
    const a = await run(only(afterMerge));
    assert(a.objects.some((o) => o.path === "topic.txt" && o.churn === 0));
  });
  await t.test("manual merge updates author metrics immediately without reindex", async () => {
    const groups = getAuthorOverview(repoId).groups;
    const alice = groups.find((a) => a.name === "Alice");
    const bob = groups.find((a) => a.name === "Bob");
    assert.equal(alice.contributing[0].identities.length, 2);
    mergeAuthorGroups(repoId, bob.groupId, alice.groupId);
    const r = await run({ authorIds: [alice.groupId] });
    assert.equal(r.authors.length, 1); assert.equal(r.authors[0].churn, 25);
    assert.equal(r.authors[0].ownership, 1); assert.equal(r.authors[0].modifications, 7);
    unmergeAuthorGroup(repoId, bob.groupId);
    const b = await run({ authorIds: [bob.groupId] });
    assert.equal(b.total.churn, 3); assert.equal(b.commitCount, 9);
    assert.equal(b.authors[0].ownership, 3 / 25);
  });
  await t.test("multiple repos remain separate; bare clone mailmap works", async () => {
    const bare = path.join(isolated, "bare.git");
    git("clone", "--bare", source, bare);
    const secondId = register("bare", bare);
    const r = await queryMetrics({ repoIds: [repoId, secondId] });
    assert.equal(r.commitCount, 18); assert.equal(r.total.churn, 50);
    assert.equal(r.repositories.length, 2);
    assert.equal(r.authors.filter((a) => a.name === "Alice").length, 2);
  });
});
