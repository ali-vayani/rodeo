# Contributing to Echo

## Local development

1. Copy `.env.example` to `.env` and ensure Postgres is reachable (`docker compose up -d` for the bundled database)
2. Install dependencies: `npm install`
3. Run migrations: `npm run db:migrate` - If Postgres is not installed follow `install postgres`
4. Seed the database: `npm run db:seed`
5. Start the app: `npm run dev`

## Installing postgres (mac OS with apple sillicon)

1. run `brew install postgresql@16`
2. Add postgres to PATH `echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc`
3. run `brew services start postgresql@16`
4. run `psql postgres`
5. run `createdb rodeo-development`

## Before opening a pull request

Run the checks that match your changes:

- `npm run check` — TypeScript and Svelte diagnostics
- `npm run lint` — Prettier and ESLint
- `npm test` — Vitest

Fix any failures or explain intentional exceptions in the PR description.

## Project layout (scaffold)`

- `src/routes/` — SvelteKit pages and layouts (`/admin`, `/judge`, home)
- `src/routes/api/trpc/` — tRPC HTTP handler (Fetch adapter)
- `src/lib/server/trpc/` — Routers and procedures (add real logic here)
- `src/lib/server/db.ts` — Prisma client singleton
- `prisma/schema.prisma` — Database schema

## Style

From most important to least:

1. [KISS](https://wiki.c2.com/?KeepItSimple): don't overengineer your code. See also: [DTSTTCPW](http://wiki.c2.com/?DoTheSimplestThingThatCouldPossiblyWork), [YAGNI](https://wiki.c2.com/?YouArentGonnaNeedIt). You want this application to be as simple as possible to avoid high traffic in a situation where there's already going to be multiple judges using the platform at once.
2. Mobile-first: test on a 320px wide viewport first while you are working on the frontend. This doesn't mean to neglect the desktop layout; just make sure it works on smaller screens first and scale up (because we often forget if we do it the other way around). This is especially important as judges are going to be judging on their phones and not carry their laptops around.
3. [Progressive enhancement](https://en.wikipedia.org/wiki/Progressive_enhancement): if it doesn't cost anything, then use the browser's native ability to submit [form actions](https://kit.svelte.dev/docs/form-actions) so users without access to JavaScript can still use your feature.

Other things to keep note of:

1. Match existing formatting (Prettier) and lint rules (ESLint).
2. Prefer small, focused changes; avoid unrelated refactors in the same PR
3. Make sure your code is readable by other developers, add comments when necessary don't comment every other line.

## Branch naming

Use short, descriptive branch names, for example `feature/judge-assignment` or `fix/trpc-error-handling`.
