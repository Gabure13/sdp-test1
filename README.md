# sdp-test1

Website built with Next.js (App Router), TypeScript, and Tailwind CSS, scaffolded with `create-next-app`.

## Stack

- [Next.js](https://nextjs.org) 15 (App Router, Turbopack)
- [React](https://react.dev) 19
- [TypeScript](https://www.typescriptlang.org) 5
- [Tailwind CSS](https://tailwindcss.com) 4.1 (pinned to `~4.1.18`; Tailwind 4.2+ requires Node >= 20)
- [ESLint](https://eslint.org) 9 with `eslint-config-next`

> Toolchain constraint: this machine runs Node 18.19, so Next.js is pinned to 15.x (16+ requires Node >= 20.9) and Tailwind to 4.1.x (4.2+ requires Node >= 20). After upgrading to Node 20+, bump both with `npm install next@latest eslint-config-next@latest tailwindcss@latest @tailwindcss/postcss@latest`.

## Getting started

```bash
npm install    # only needed after a fresh clone
npm run dev    # start the dev server at http://localhost:3000
```

## Scripts

| Command           | Description                          |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the development server         |
| `npm run build`   | Create an optimized production build |
| `npm run start`   | Serve the production build           |
| `npm run lint`    | Run ESLint                           |

## Project structure

```
src/
  app/
    layout.tsx    # Root layout (wraps every page)
    page.tsx      # Home page (/)
    globals.css   # Global styles + Tailwind imports
public/           # Static assets served from /
```

Routing follows the App Router convention: each folder under `src/app/` becomes a route, with `page.tsx` as its UI and optional `layout.tsx` for shared chrome.

## Deployment

The default output is a Node.js server (`next start`) and deploys as-is to Vercel, or to any Node host with `npm run build && npm run start`.
