# Rodeo

Rodeo is Freetail Hackers' hackathon management platform. It has two portals:

- **Hacker portal** (`/hacker/*`) — apply, RSVP, manage a team, and show a QR code at check-in.
- **Admin portal** (`/admin/*`) — review applications, release decisions, scan attendees, send
  email, and configure the event.

## Stack

| Layer      | Technology                                         |
| ---------- | -------------------------------------------------- |
| Frontend   | SvelteKit (Svelte 5, runes), Tailwind CSS v4       |
| API        | tRPC (`/api/trpc`)                                 |
| Database   | Prisma ORM → PostgreSQL (local Docker or Supabase) |
| Auth       | Supabase (Google OAuth) in deployed environments   |
| Email      | Resend                                             |
| Validation | Zod                                                |
| Tests      | Vitest                                             |
| Hosting    | Vercel                                             |

## Prerequisites

- Node.js 22 (the Vercel runtime is pinned to `nodejs22.x`)
- Docker Desktop, for the bundled Postgres. A locally installed Postgres works too — see
  [CONTRIBUTING.md](CONTRIBUTING.md#running-postgres-without-docker).

## Quick start

```bash
npm install
cp .env.example .env      # then uncomment ALLOW_DEV_AUTH=1
docker compose up -d      # Postgres on 127.0.0.1:5432
npm run db:setup          # push schema, generate client, seed
npm run dev               # http://localhost:5173
```

Two things in that sequence are easy to miss:

- **`ALLOW_DEV_AUTH=1` is commented out in `.env.example` on purpose.** The development
  environment signs in any `@yopmail.com` account with no password, so enabling it has to be
  a deliberate act rather than the default a misconfigured deploy falls into. The server
  prints a boot error telling you to set it if you forget.
- **`npm install` runs `prisma generate`** via the `prepare` script. The generated client
  lands in `src/lib/generated/` and is gitignored, so a fresh clone has no Prisma types until
  something generates them.

### Logging in locally

There are no passwords in development. Any seeded `@yopmail.com` address logs straight in at
`/login`:

| Address                  | Who                                    |
| ------------------------ | -------------------------------------- |
| `admin1@yopmail.com`     | full admin — every section of `/admin` |
| `organizer1@yopmail.com` | organizer — dashboard, scan, schedule  |
| `hacker1@yopmail.com`    | a hacker somewhere in the funnel       |

The seed numbers accounts sequentially per role (`hacker1` … `hacker120`), so any address you
can guess exists. See [Seeding](#seeding-the-database) for which state each one is parked in.

Easier than typing addresses: the **dev account switcher** in the bottom corner of every page
lists every seeded account with its role, status, and pending decision, and swaps sessions in
one click. It is gated on four independent conditions (`vite dev` **and** no Supabase auth
**and** `ALLOW_DEV_AUTH=1` **and** a local `DATABASE_URL`), and `vite.config.ts` empties its
modules at build time so no chunk for it is ever emitted into a production bundle.

## Seeding the database

`npm run db:seed` generates **171 accounts** spread across every role and lifecycle state the
UI can render:

| Role      | Count | States                                                |
| --------- | ----- | ----------------------------------------------------- |
| hacker    | 120   | the full funnel, weighted toward the admissions queue |
| admin     | 5     | internal staff, never applicants                      |
| organizer | 8     | internal staff, never applicants                      |
| judge     | 10    | applied → accepted → confirmed → checked in           |
| mentor    | 14    | same                                                  |
| volunteer | 14    | same                                                  |

It also seeds the application **questions** — identity questions linked to `User` fields, plus
per-role questions — and generates answers for every applicant from whatever questions are in
the table. Add a question in `/admin/application-editor`, re-seed, and everyone has an answer
to it.

Three properties worth knowing:

- **Deterministic.** Every account is derived from its index, with no randomness.
  `hacker42@yopmail.com` is the same person in the same state on every run, so a bug you found
  yesterday still reproduces today.
- **Idempotent.** Accounts are upserted by email and questions are matched on `order` (not
  title, which is editable in the admin UI). Re-running is the reset button, not a way to end
  up with two copies of everything.
- **Non-destructive by default.** Hand-made accounts are left alone. `npm run db:seed:fresh`
  (`SEED_PRUNE=1`) additionally deletes every `@yopmail.com` account the generator did not
  produce, when you want the database to hold exactly the generated set.

### Scenario seeds

Three additional seed scripts simulate specific points in the admission timeline.
Each one is a drop-in replacement for `npm run db:seed` — it upserts the same
questions and 171 accounts, just with a different state distribution. All the same
overrides (`SEED_PRUNE=1`, `SEED_HACKERS=N`, …) work the same way.

#### `npm run db:seed:open` — Applications Open

Right after the portal goes live. No decisions have been made yet.

| Who                           | State                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| ~30% of hackers               | `CREATED` — registered, haven't submitted yet                             |
| ~70% of hackers               | `APPLIED` + `pendingDecision=PENDING` — submitted, untouched queue        |
| Judges / mentors / volunteers | Mix of applied → accepted → confirmed (recruited before hacker apps open) |
| Admins / organizers           | `CREATED` (internal, never applicants)                                    |

Quick logins: `admin1@yopmail.com` (admin), `hacker1@yopmail.com` (CREATED),
`hacker4@yopmail.com` (APPLIED + PENDING).

#### `npm run db:seed:closed` — Applications Closed

After the deadline. Every applicant has been reviewed and given a `pendingDecision`,
but `activeDecision` is still null — nothing has been released to hackers yet.

| Who             | State                                                 |
| --------------- | ----------------------------------------------------- |
| ~9% of hackers  | `CREATED` — registered but never applied              |
| ~36% of hackers | `APPLIED` + `pendingDecision=ACCEPTED` (unreleased)   |
| ~36% of hackers | `APPLIED` + `pendingDecision=REJECTED` (unreleased)   |
| ~18% of hackers | `APPLIED` + `pendingDecision=WAITLISTED` (unreleased) |
| All staff       | `CONFIRMED` — logistics locked in                     |

Quick logins: `admin1@yopmail.com` (use the Admissions page to release decisions),
`hacker2@yopmail.com` (unreleased ACCEPTED), `hacker6@yopmail.com` (unreleased REJECTED),
`hacker10@yopmail.com` (unreleased WAITLISTED).

#### `npm run db:seed:event` — Hackathon Start

Morning of the event. Decisions are released, the RSVP window has closed, and
attendees are arriving. The state cycle is ordered so the first accounts in each
email range land in the most actionable states:

| Logins                     | State                                                   |
| -------------------------- | ------------------------------------------------------- |
| `hacker1`–`hacker5`        | `CONFIRMED` — accepted, RSVPd, not yet scanned          |
| `hacker6`–`hacker8`        | `CHECKED_IN` — already through the door                 |
| `hacker9`–`hacker10`       | `APPLIED` + released `ACCEPTED` — accepted, never RSVPd |
| `hacker11`                 | `DECLINED` — accepted but said no                       |
| `hacker12`–`hacker13`      | `APPLIED` + released `REJECTED`                         |
| `hacker14`                 | `APPLIED` + released `WAITLISTED`                       |
| (pattern repeats every 14) |                                                         |
| All staff                  | Mix of `CONFIRMED` and `CHECKED_IN`                     |

Quick logins: `admin1@yopmail.com` (use the Scan page), `hacker1@yopmail.com`
through `hacker5@yopmail.com` (CONFIRMED — ready to check in).

---

Counts are overridable per role:

```bash
SEED_HACKERS=10 SEED_JUDGES=0 npm run db:seed
```

`SEED_HACKERS`, `SEED_ADMINS`, `SEED_ORGANIZERS`, `SEED_JUDGES`, `SEED_MENTORS`, and
`SEED_VOLUNTEERS` all work this way.

**The seed refuses to run against a non-local database.** It writes passwordless admin
accounts and can delete accounts, so it checks `DATABASE_URL` and bails on anything that isn't
localhost, as well as on `NODE_ENV`/`VERCEL_ENV` of `production`. Two overrides exist:
`SEED_ALLOW_REMOTE=1` is what CI uses to seed per-branch preview databases — it lifts only the
localhost check and still refuses production and any database named `postgres` — and
`SEED_ALLOW_PRODUCTION=1` disables the guard entirely if you genuinely mean to.

### Schema changes

Two workflows, and which you want depends on whether the change is going anywhere:

| Command               | What it does                                                           |
| --------------------- | ---------------------------------------------------------------------- |
| `npm run db:push`     | Sync `schema.prisma` straight to the database. Fast, no migration file |
| `npm run db:migrate`  | `prisma migrate dev` — writes a migration in `prisma/migrations/`      |
| `npm run db:studio`   | Prisma Studio, for poking at rows by hand                              |
| `npm run db:generate` | Regenerate the client into `src/lib/generated/`                        |

Use `db:push` while you're iterating on your own machine. Commit a **migration** for anything
that ships — deployed environments apply migrations, and a schema that only exists as a push
never reaches them.

## Project layout

```
src/
  routes/
    +page.svelte             landing / redirect
    login/                   dev email form + Google OAuth button
    auth/callback/           Supabase OAuth handshake
    hacker/                  application, account, team invites
    admin/                   dashboard, admissions, users, scan, schedule,
                             email-templates, custom-email, application-editor,
                             blacklist, settings, logs
    api/trpc/[...path]/      the single tRPC HTTP handler
    design/                  internal style guide (staff only)
    dev/accounts/            dev-only account switcher backend
  lib/
    server/
      trpc/routers/          one router per admin section
      trpc/init.ts           procedure types and the permission split
      auth.ts, env.ts, db.ts, email.ts, log.ts, invite.ts
    components/              feature components, plus ui/ and patterns/
    auth/permissions.ts      role → section mapping, shared client and server
    generated/               Prisma client (gitignored)
  hooks.server.ts            env validation + route guards + security headers
prisma/
  schema.prisma, migrations/, seed.ts, seedUsers.ts
docs/                        design language, component plan, blacklist notes
design/                      original HTML mockups (historical, not a spec)
```

## How a request works

1. **`hooks.server.ts`** resolves the session into `event.locals.user`, then guards
   `/hacker/*` and `/admin/*` by prefix. Admin pages are checked per _section_, and an
   unmapped `/admin/*` path is treated as admin-only — a new page added without a
   `SECTION_PATHS` entry fails closed rather than being waved through.
2. **The page's `+page.server.ts`** loads initial data, usually by calling a tRPC procedure
   server-side.
3. **The browser** calls the same procedures through `$lib/trpc/client` for mutations and
   refreshes. Everything goes through the one handler at `/api/trpc`.

### Roles and the permission split

Roles are `HACKER`, `JUDGE`, `MENTOR`, `VOLUNTEER`, `ORGANIZER`, `ADMIN`, and `UNDECLARED`; a
user can hold several. Organizers reach exactly three admin sections — **dashboard, scan, and
schedule** — and admins reach everything.

That split is expressed twice, deliberately. `src/lib/auth/permissions.ts` filters the nav and
backs the route guard; `src/lib/server/trpc/init.ts` is the real boundary:

| Procedure         | Requires               |
| ----------------- | ---------------------- |
| `publicProcedure` | nothing                |
| `authedProcedure` | a signed-in user       |
| `portalProcedure` | admin **or** organizer |
| `adminProcedure`  | admin                  |

`adminProcedure` is the default for anything touching per-person data. An endpoint an
organizer should reach has to opt in to `portalProcedure`, so a procedure nobody thought
carefully about denies rather than leaks. Hiding a nav link proves nothing on its own.

### Adding an endpoint

1. Add the procedure to the relevant router in `src/lib/server/trpc/routers/`, picking the
   narrowest procedure type that works and validating input with Zod.
2. If it returns user rows, project them through a select in
   `src/lib/server/trpc/selects.ts` rather than returning the model — that file exists to keep
   unreleased decisions from leaking.
3. If it mutates something administratively, log it (see [Audit log](#audit-log)).
4. Add a test in `routers/test/` using `createTestCaller` from `routers/test-utils.ts`, which
   runs the real router against a mocked Prisma client.

## Environments

Three environments, resolved from `VERCEL_ENV` (falling back to `NODE_ENV`) in
`src/lib/server/env.ts`. `NODE_ENV` alone is not enough, because a Vercel preview deploy is a
_production build_ pointed at the _production database_:

| Environment     | Auth              | Email                              |
| --------------- | ----------------- | ---------------------------------- |
| **development** | yopmail bypass    | printed to the console, never sent |
| **preview**     | Supabase (Google) | printed to the console, never sent |
| **production**  | Supabase (Google) | Resend                             |

A production boot fails immediately if `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or an email
transport is missing, rather than on the first hacker who tries to sign in.

### Production auth

Google OAuth is the only production sign-in path, and the first login **is** registration — the
`User` row is created from the Google profile with the `HACKER` role. There is no sign-up form
and no password reset to maintain. Elevating someone to organizer or admin is done from
`/admin/users`.

### Email

Templates are authored as **markdown** at `/admin/email-templates` — organizers write prose,
not HTML — and rendered on the way out. Lifecycle mail (submit, accept, reject, waitlist,
confirm, decline) is driven by the templates on the `Settings` row; one-off sends go through
the wizard at `/admin/custom-email`. Anything sent outside production carries a banner saying
so, and preview deploys refuse every recipient that isn't `@yopmail.com`.

## Audit log

Every administrative mutation writes a `Log` row through `logAction` in `src/lib/server/log.ts`,
readable at `/admin/logs`. Each entry records the action slug, a human summary, the acting
admin (snapshotted by name and email so history survives that account being deleted), the row
acted on, and a JSON metadata blob with the before/after detail.

Adding a new logged action means adding its slug to `src/lib/log/actions.ts` — the `LogAction`
union is derived from that list, so an unregistered slug is a compile error rather than a row
the logs page can never filter to.

Review-lock churn (`claim`, `heartbeat`) is deliberately unlogged; a reviewer generates one
every few seconds and it would bury everything else.

## Design system

`docs/design-language.md` is the spec and `src/app.css` is the machine-readable half of it —
if they disagree, `app.css` wins. Two rules are enforced by `npm run lint:tokens`: **no hex
codes outside `app.css`**, and **no raw numbers for size, space, or type**. The linter is
scoped to the directories already migrated onto the system (the `SCOPES` list in
`scripts/lint-tokens.mjs`); widen it as pages land.

`/design` renders the live style guide. It's staff-only, and 404s for hackers.

The `design/` folder at the repo root is _not_ a spec — it's the original set of competing
mockups the design language was picked from. Don't build against it.

## Testing

```bash
npm test              # run once
npm run test:unit     # watch mode
```

Vitest runs in a Node environment over `src/**/*.test.ts`. Router tests call the real tRPC
routers through `createTestCaller` against a `vitest-mock-extended` Prisma mock, so permission
checks and business logic are exercised without a database. `expect.requireAssertions` is on —
a test that asserts nothing fails.

## Scripts

| Script                   | Description                          |
| ------------------------ | ------------------------------------ |
| `npm run dev`            | Dev server                           |
| `npm run build`          | Production build                     |
| `npm run preview`        | Serve the production build locally   |
| `npm run check`          | `svelte-check` (TypeScript + Svelte) |
| `npm run lint`           | Prettier + ESLint + design tokens    |
| `npm run lint:tokens`    | Design-system token rules            |
| `npm run format`         | Write with Prettier                  |
| `npm test`               | Vitest (run once)                    |
| `npm run db:setup`       | Push schema, generate client, seed   |
| `npm run db:push`        | Push schema without a migration      |
| `npm run db:migrate`     | `prisma migrate dev`                 |
| `npm run db:seed`        | Re-seed dev accounts                 |
| `npm run db:seed:fresh`  | Re-seed, pruning unmanaged accounts  |
| `npm run db:seed:open`   | Scenario: applications open          |
| `npm run db:seed:closed` | Scenario: applications closed        |
| `npm run db:seed:event`  | Scenario: hackathon start            |
| `npm run db:studio`      | Prisma Studio                        |

## Deploying

Vercel, using `@sveltejs/adapter-vercel` on the Node runtime rather than edge — every route
talks to Postgres through Prisma, which needs a real TCP socket. Deploys are driven entirely
by GitLab CI (`.gitlab-ci.yml`); the Vercel project has **no** Git integration.

### The pipeline

Every push runs three stages:

1. **test** — `npm ci`, build, `svelte-check`, lint, unit tests. No database needed:
   `prisma generate` runs without one.
2. **deploy-preview** — every branch gets its own preview deploy against its own Postgres
   **schema** inside the shared Supabase database, named after `$CI_COMMIT_REF_SLUG`,
   dropped and recreated, migrated, and seeded with the fake yopmail data on every run.
   Pushes to `mainline` also alias the deploy to the staging URL
   (`rodeo-2-0-nightly.vercel.app`). Branch schemas live until someone runs the manual
   `stop-preview-job` from Deployments → Environments (do this when a branch is done;
   abandoned schemas accumulate otherwise).
3. **deploy-production** — manual. Runs `prisma migrate deploy` against the production
   database, then `vercel deploy --prod`. Production is **never seeded**. To promote, a
   Maintainer who was not the author of the commit runs the job from the pipeline or
   Deployments → Environments.

**Environment variables live in Vercel**, not GitLab: jobs run `vercel pull` and export the
result. The GitLab side only stores `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VERCEL_TOKEN`, and
`VERCEL_SCOPE` — and the pipeline configuration is pinned to
`.gitlab-ci.yml@freetail-hackers/Rodeo-2.0:mainline` in the project settings so a branch
cannot rewrite the pipeline to leak the token.

### Database connections

Two URLs, both stored in Vercel:

- `DATABASE_URL` — the Supabase **transaction pooler** (port 6543). What the app queries
  through at runtime; safe for many short-lived serverless connections.
- `DIRECT_URL` — the Supabase **session pooler** (port 5432). What `prisma migrate`, the
  seed, and psql go through; migrations cannot run over the transaction pooler.

Both environments store complete URLs into the default `postgres` database — Supabase's
pooler only serves the default database, which is why preview isolation is **by schema,
not by database**. The pipeline passes `DATABASE_SCHEMA=$CI_COMMIT_REF_SLUG` to preview
deploys; `prisma.config.ts` scopes CLI operations with `?schema=`, and the app and seeds
hand it to the driver adapter, which qualifies every generated query (pooler-safe — no
session state). Production and local dev never set it and live in `public`.

### Supabase auth

Enable the Google provider in the Supabase dashboard and register
`https://<your-domain>/auth/callback` as an authorised redirect URL. Supabase is auth-only:
the app talks to Postgres directly through Prisma, so keep the `public` schema out of the
Data API's exposed schemas — Prisma tables carry no RLS policies.

Set `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `EMAIL_FROM`, and
`RESEND_API_KEY`. Never
set `ALLOW_DEV_AUTH` on a deployed environment. `.env.example` documents each variable and
why it exists.

### CI image

Jobs run on `registry.gitlab.com/freetail-hackers/rodeo-2.0` — node:22 plus `psql`, built
from the `Dockerfile` at the repo root. It changes roughly never; the build/push one-liner
is in the Dockerfile's header comment.

## Docs

- `docs/design-language.md` — the design system and its two hard rules
- `docs/component-library-plan.md` — the `ui/` and `patterns/` layers
- `docs/blacklist.md` — why email auto-rejects and a name only flags

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
