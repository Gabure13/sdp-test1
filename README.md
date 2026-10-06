# sdp-test1 — RAT (Repo Analysis Tool)

A local web dashboard that ingests git repositories (zip upload or deep clone of a remote URL), stores them in SQLite, and will compute per-author, per-file, per-directory, and repository metrics.

Built with Next.js (App Router), TypeScript, Tailwind CSS, and SQLite (`better-sqlite3`).

## Stack

- [Next.js](https://nextjs.org) 15 (App Router, Turbopack)
- [React](https://react.dev) 19
- [TypeScript](https://www.typescriptlang.org) 5
- [Tailwind CSS](https://tailwindcss.com) 4.1 (pinned to `~4.1.18`; Tailwind 4.2+ requires Node >= 20)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) 11 (SQLite driver)
- [adm-zip](https://github.com/cthackers/adm-zip) (zip extraction)
- [ESLint](https://eslint.org) 9 with `eslint-config-next`

> Toolchain constraint: this machine runs Node 18.19, so Next.js is pinned to 15.x (16+ requires Node >= 20.9) and Tailwind to 4.1.x (4.2+ requires Node >= 20). After upgrading to Node 20+, bump both with `npm install next@latest eslint-config-next@latest tailwindcss@latest @tailwindcss/postcss@latest`.

## Getting started

Requires Node.js >= 18.18 and `git` on PATH.

```bash
npm install
npm run build:native   # only needed if npm install could not fetch a prebuilt better-sqlite3 (see below)
npm run dev            # start the dev server at http://localhost:3000
```

### Native module note (Ubuntu Node.js)

Ubuntu's `nodejs` package reports `NODE_MODULE_VERSION 109`, while upstream Node 18 is 108 — no prebuilt `better-sqlite3` binary exists for ABI 109, so `npm install` fails on the package's install script. On this machine (and any Ubuntu with distro Node):

```bash
npm install --ignore-scripts   # skip the broken prebuild attempt
npm run build:native           # compile better-sqlite3 from source
```

`build:native` uses Ubuntu's own Node headers (`/usr/include/node`, from the `libnode-dev` package) so the module matches the runtime ABI. On standard Node installs, plain `npm install` fetches a prebuilt binary and `build:native` is a no-op.

## Scripts

| Command             | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Start the development server                         |
| `npm run build`     | Create an optimized production build                 |
| `npm run start`     | Serve the production build                           |
| `npm run lint`      | Run ESLint                                           |
| `npm run build:native` | (Re)build the better-sqlite3 native module from source |

## Features (so far)

**Repository ingestion** — the first piece of RAT:

- Add a repository by **cloning a remote URL** (deep clone: full history, all branches) or by **uploading a zip** that contains the repository's `.git` directory (bare layouts and a `.git` worktree pointer inside the archive also work).
- Live status per repository: cloning / extracting / indexing with progress messages, then ready (or failed with a reason).
- Registry persisted in SQLite; multiple repositories supported; repos can be removed (deletes stored data).
- Zip safety: entries that try to escape the extraction directory (zip-slip) are rejected.

### API

| Method   | Route                | Description                                  |
| -------- | -------------------- | -------------------------------------------- |
| `GET`    | `/api/repos`         | List repositories with status and counts     |
| `POST`   | `/api/repos/clone`   | Body `{ "url": "https://..." }` — start clone |
| `POST`   | `/api/repos/upload`  | Multipart form with a `file` zip field       |
| `GET`    | `/api/repos/:id`     | Fetch one repository                         |
| `DELETE` | `/api/repos/:id`     | Remove repository and its stored data        |

## Project structure

```
src/
  lib/
    paths.ts          # .data/ layout (db, repos)
    db.ts             # SQLite connection + schema (repos registry)
    git.ts            # git helpers (clone, log, authors, url validation)
    ingest.ts         # ingestion service (extract/clone + index pipeline)
    types.ts          # shared client/server types
  app/
    page.tsx          # Repositories dashboard (add + monitor repos)
    api/repos/...     # REST endpoints above
scripts/
  rebuild-native.mjs  # better-sqlite3 source build (Ubuntu ABI 109)
.data/                # gitignored: rat.db + ingested repositories
```

Routing follows the App Router convention: each folder under `src/app/` becomes a route, with `page.tsx` as its UI and `route.ts` defining API endpoints.

## Deployment

The app is designed to run locally (it shells out to `git` and writes to `.data/`): `npm run build && npm run start` on any Node host with `git` installed.
