# Contributing to Rodeo

## Local development

The full walkthrough — environment variables, the dev login bypass, what the seed generates —
is in the [README](README.md#quick-start). The short version:

```bash
npm install
cp .env.example .env      # then uncomment ALLOW_DEV_AUTH=1
docker compose up -d
npm run db:setup
npm run dev
```

Log in at `/login` with any seeded `@yopmail.com` address (`admin1@yopmail.com`,
`organizer1@yopmail.com`, `hacker1@yopmail.com`, …), or use the dev account switcher in the
corner of the page.

### Running Postgres without Docker

macOS, Apple silicon:

1. `brew install postgresql@16`
2. Add it to your PATH:
   ```bash
   echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```
3. `brew services start postgresql@16`
4. `psql postgres`
5. `createdb rodeo-development`

Then point `DATABASE_URL` at it — note that the credentials differ from the Docker setup, whose
user and password are both `rodeo`.

## Before opening a pull request

Run the checks that match your changes:

- `npm run check` — TypeScript and Svelte diagnostics
- `npm run lint` — Prettier, ESLint, and the design-token rules
- `npm test` — Vitest

Fix any failures or explain intentional exceptions in the PR description.

If you changed `prisma/schema.prisma`, commit a **migration** (`npm run db:migrate`), not just a
`db:push`. Deployed environments apply migrations; a schema change that only exists as a push
never reaches them.

## Where things live

- `src/routes/` — SvelteKit pages and layouts (`/hacker`, `/admin`, `/login`)
- `src/routes/api/trpc/` — the single tRPC HTTP handler (Fetch adapter)
- `src/lib/server/trpc/routers/` — one router per admin section; add real logic here
- `src/lib/server/trpc/init.ts` — the procedure types that enforce permissions
- `src/lib/auth/permissions.ts` — role → section mapping, shared by the guard and the nav
- `src/lib/server/db.ts` — Prisma client singleton
- `prisma/schema.prisma` — database schema

See the [README](README.md#project-layout) for the full tree and how a request flows through it.

## Style

From most important to least:

1. [KISS](https://wiki.c2.com/?KeepItSimple): don't overengineer your code. See also: [DTSTTCPW](http://wiki.c2.com/?DoTheSimplestThingThatCouldPossiblyWork), [YAGNI](https://wiki.c2.com/?YouArentGonnaNeedIt). You want this application to be as simple as possible to avoid high traffic in a situation where there's already going to be multiple organizers using the platform at once.
2. Mobile-first: test on a 320px wide viewport first while you are working on the frontend. This doesn't mean to neglect the desktop layout; just make sure it works on smaller screens first and scale up (because we often forget if we do it the other way around). This is especially important as organizers are going to be scanning and triaging on their phones, not carrying laptops around.
3. [Progressive enhancement](https://kit.svelte.dev/docs/form-actions): if it doesn't cost anything, then use the browser's native ability to submit form actions so users without access to JavaScript can still use your feature.

Other things to keep note of:

1. Match existing formatting (Prettier) and lint rules (ESLint).
2. Follow `docs/design-language.md` for anything visual — no hex codes outside `app.css`, no raw numbers for size, space, or type. `npm run lint:tokens` enforces both in the directories already migrated.
3. Prefer small, focused changes; avoid unrelated refactors in the same PR.
4. Make sure your code is readable by other developers. Add comments when necessary — don't comment every other line.

## Permissions

Two rules, because getting this wrong leaks applicant data:

- Pick the **narrowest** procedure type that works (`authedProcedure` → `portalProcedure` →
  `adminProcedure`). `adminProcedure` is the default for anything touching per-person data;
  organizer-reachable endpoints opt in to `portalProcedure`.
- A new `/admin/*` page needs an entry in `SECTION_PATHS`. Without one the route guard treats it
  as admin-only — which fails safe, but means organizers silently can't reach a page you meant
  them to.

Hiding a nav link is cosmetic. The procedure is the boundary.

## Branch naming

Use short, descriptive branch names, for example `feature/team-invites` or
`fix/trpc-error-handling`. The default branch is `mainline`.
