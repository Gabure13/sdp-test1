// Rebuilds the better-sqlite3 native module from source when no prebuilt
// binary matches the running Node.js (e.g. Ubuntu's nodejs builds report
// NODE_MODULE_VERSION 109, for which no prebuilds are published).
// On standard Node installs `npm install` fetches a prebuilt binary instead
// and this script exits immediately.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(new URL("..", import.meta.url).pathname);
const moduleDir = path.join(root, "node_modules", "better-sqlite3");
const gypJs = path.join(root, "node_modules", "node-gyp", "bin", "node-gyp.js");

function moduleLoads() {
  try {
    require(moduleDir);
    return true;
  } catch {
    return false;
  }
}

if (!fs.existsSync(moduleDir)) {
  console.error("better-sqlite3 is not installed. Run `npm install` first.");
  process.exit(1);
}

if (moduleLoads()) {
  console.log("better-sqlite3 already loads, nothing to do.");
  process.exit(0);
}

if (!fs.existsSync(gypJs)) {
  console.error("node-gyp is not installed. Run `npm install` first.");
  process.exit(1);
}

const args = ["rebuild", "--release"];
// Prefer the distribution's own Node headers when present: they match the
// distro runtime's ABI (Ubuntu: /usr/include/node, requires libnode-dev).
if (fs.existsSync("/usr/include/node/node_version.h")) {
  args.push("--nodedir=/usr");
  console.log("Using distro Node headers from /usr/include/node ...");
}

const result = spawnSync(process.execPath, [gypJs, ...args], {
  cwd: moduleDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

if (!moduleLoads()) {
  console.error("better-sqlite3 was built but still fails to load.");
  process.exit(1);
}

console.log("better-sqlite3 built successfully.");
