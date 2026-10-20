## This is a fork of the Freetail Hacker Rodeo repo setup for my GitHub portfolio + personal experimentation. You can find the offical GitLab repo [here](https://gitlab.com/freetail-hackers/Rodeo-2.0).

# Rodeo

Freetail Hackers' hackathon management platform. Two portals:

- **Hacker portal** (`/hacker/*`) — apply, RSVP, manage a team, show a QR code at check-in.
- **Admin portal** (`/admin/*`) — review applications, release decisions, scan attendees, send email, configure the event.

## Stack

| Layer    | Technology                                                         |
| -------- | ------------------------------------------------------------------ |
| Frontend | SvelteKit (Svelte 5, runes), Tailwind CSS v4                       |
| API      | tRPC (`/api/trpc`)                                                 |
| Database | Prisma ORM → PostgreSQL (local Docker or Supabase)                 |
| Auth     | Supabase (Google OAuth or email/password) in deployed environments |
| Email    | Resend                                                             |
| Hosting  | Vercel                                                             |

## Quick start

**Prerequisites:** Node.js 22, Docker Desktop (or a local Postgres — see [Without Docker](#without-docker)).

```bash
npm install
cp .env.example .env      # then uncomment ALLOW_DEV_AUTH=1
docker compose up -d      # Postgres on 127.0.0.1:5432
npm run db:setup          # push schema, generate client, seed
npm run dev               # http://localhost:5173
```

Two things easy to miss:

- **`ALLOW_DEV_AUTH=1` is commented out on purpose.** The dev environment signs in any `@yopmail.com` address with no password — enabling it has to be deliberate. The server prints a boot error if you forget.
- **`npm install` runs `prisma generate`** via the `prepare` script. The generated client lands in `src/lib/generated/` (gitignored), so a fresh clone has no Prisma types until something generates them.

### Logging in locally

No passwords in development. Any seeded `@yopmail.com` address logs straight in at `/login`:

| Address                  | Role                                   |
| ------------------------ | -------------------------------------- |
| `admin1@yopmail.com`     | full admin — every section of `/admin` |
| `organizer1@yopmail.com` | organizer — dashboard, scan, schedule  |
| `hacker1@yopmail.com`    | a hacker somewhere in the funnel       |

The **dev account switcher** in the bottom corner lists every seeded account and swaps sessions in one click. It is stripped from production builds entirely.

### Without Docker

macOS (Apple Silicon):

```bash
brew install postgresql@16
echo 'export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
brew services start postgresql@16
createdb rodeo-development
```

Then update `DATABASE_URL` — the credentials differ from the Docker setup (Docker uses `rodeo`/`rodeo`).

## Seeding

`npm run db:seed` generates **171 accounts** across every role and lifecycle state. Seeding is deterministic, idempotent, and non-destructive — re-running is the reset button. `npm run db:seed:fresh` additionally deletes any `@yopmail.com` accounts the generator didn't produce.

### Scenario seeds

Three scripts simulate specific points in the admission timeline:

| Script                   | Phase               | What's seeded                                             |
| ------------------------ | ------------------- | --------------------------------------------------------- |
| `npm run db:seed:open`   | Applications open   | ~70% applied/pending, ~30% just registered                |
| `npm run db:seed:closed` | Applications closed | Everyone scored with a pending decision, nothing released |
| `npm run db:seed:event`  | Hackathon day       | Mix of confirmed, checked-in, accepted/no RSVP, rejected  |

Role counts are overridable: `SEED_HACKERS=10 SEED_JUDGES=0 npm run db:seed`.

**The seed refuses to run against a non-local database.** It checks `DATABASE_URL` and bails on anything that isn't localhost, and on `NODE_ENV`/`VERCEL_ENV` of `production`. CI uses `SEED_ALLOW_REMOTE=1` to seed per-branch preview databases.

### Schema changes

| Command              | When to use                                                      |
| -------------------- | ---------------------------------------------------------------- |
| `npm run db:push`    | Iterating locally — fast, no migration file                      |
| `npm run db:migrate` | Anything that ships — writes a file that deployed envs can apply |
| `npm run db:studio`  | Prisma Studio, for poking at rows by hand                        |

## Project layout

```
src/
  routes/
    login/                   dev email form, Google OAuth, email/password
    auth/callback/           Supabase code exchange (OAuth, confirm, recovery)
    reset-password/          set a new password from a recovery link
    hacker/                  application, account, team invites
    admin/                   dashboard, admissions, users, scan, schedule,
                             email-templates, custom-email, application-editor,
                             blacklist, settings, logs
    api/trpc/[...path]/      the single tRPC HTTP handler
  lib/
    server/trpc/routers/     one router per admin section
    server/trpc/init.ts      procedure types and the permission split
    auth/permissions.ts      role → section mapping, shared client and server
    components/              feature components, plus ui/ and patterns/
    server/auth.ts, env.ts, db.ts, email.ts, log.ts
    generated/               Prisma client (gitignored)
  hooks.server.ts            env validation + route guards + security headers
prisma/
  schema.prisma, migrations/, seed.ts, seedUsers.ts
docs/                        design language, component plan, blacklist notes
```

Every request goes through `hooks.server.ts` (session → `event.locals.user`, route guards), then the page's `+page.server.ts` (initial data load), then the browser calls the same tRPC procedures through `$lib/trpc/client` for mutations.

## Permissions

Roles are `HACKER`, `JUDGE`, `MENTOR`, `VOLUNTEER`, `ORGANIZER`, `ADMIN`, and `UNDECLARED`. The permission split is expressed in two places deliberately:

| Procedure         | Requires               |
| ----------------- | ---------------------- |
| `publicProcedure` | nothing                |
| `authedProcedure` | signed-in user         |
| `portalProcedure` | admin **or** organizer |
| `adminProcedure`  | admin only             |

`adminProcedure` is the default for anything touching per-person data. Organizer-reachable endpoints opt in to `portalProcedure`. A new `/admin/*` page needs an entry in `SECTION_PATHS` — without one it fails closed (admin-only), not open. Hiding a nav link is cosmetic; the procedure is the real boundary.

### Adding an endpoint

1. Add the procedure to the relevant router in `src/lib/server/trpc/routers/`, using the narrowest procedure type and validating input with Zod.
2. If it returns user rows, project through a select in `src/lib/server/trpc/selects.ts` to prevent unreleased decisions from leaking.
3. If it mutates something administratively, log it via `logAction` and register the slug in `src/lib/log/actions.ts`.
4. Add a test in `routers/test/` using `createTestCaller` from `routers/test-utils.ts`.

## Environments

| Environment     | Auth              | Email                              |
| --------------- | ----------------- | ---------------------------------- |
| **development** | yopmail bypass    | printed to the console, never sent |
| **preview**     | Supabase (Google) | printed to the console, never sent |
| **production**  | Supabase (Google) | Resend                             |

Resolved from `VERCEL_ENV` (falling back to `NODE_ENV`) in `src/lib/server/env.ts`. A production boot fails immediately if `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or `RESEND_API_KEY` is missing.

### Email attachments

Custom emails accept up to five files, 4 MB each. The composer uploads files to private
S3 storage and saves their references in `EmailLog`. Each recipient gets the file bytes
as Resend attachments. PDFs open from the filename links in the composer and confirmation
step; other files download. The browser must stay open while a bulk send runs.

The email template editor supports the same attachments, saved separately for each
template. Save Changes stores files under `email-template-attachments/`, outside the
30-day draft expiration policy. Send Test includes the current draft's files, even
before saving. Application, decision, and RSVP emails include the saved files alongside
any recipient QR image. Revert restores the saved file list. Removing a file deletes
it only after saving, and only when no other template still references it.

Apply database migrations before deploying these changes. Configure S3 using the four
variables in `.env.example`, and configure `RESEND_API_KEY` and a verified `EMAIL_FROM`
for production. Development and preview never deliver email.

Configure attachment retention once per bucket with the same S3 environment variables.
The setup identity also needs `s3:GetLifecycleConfiguration` and
`s3:PutLifecycleConfiguration` on `arn:aws:s3:::BUCKET`. The app's runtime identity does
not need those permissions.

```sh
npm run email:retention
npm run email:retention -- --apply
```

The first command previews the resulting bucket configuration. The second installs
30-day expiration for `email-attachments/`, preserving unrelated lifecycle rules.
It applies to existing uploads too, including abandoned drafts. Application files and
wallet artwork are outside the prefix. S3 removes noncurrent versions after one day
and cleans up expired delete markers in versioned buckets. Cleanup runs asynchronously;
30 days is eligibility for expiration, not an exact deletion time.
See [AWS lifecycle configuration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/how-to-set-lifecycle-configuration-intro.html)
and [version expiration rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html).

Email logs keep filenames after file expiration. Old or removed files must be reattached
before sending again. Delivered attachments remain in recipients' mailboxes. Local
`.uploads` files are for development and are not subject to S3 lifecycle rules.

Retries reuse a Resend idempotency key for each send and recipient. Resend deduplicates
matching requests for [24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys).
The application also skips recipients already marked as sent. A send with unresolved
requests is reported as incomplete. Success means Resend accepted the message, not
that the recipient's inbox has confirmed delivery.

Run the pipeline integration tests against a local PostgreSQL database with schema-creation
permission. They create an isolated schema, apply all migrations, and remove the schema
afterward. Uploads use real local files; the real Resend SDK serializes requests, but
HTTP delivery is intercepted so no email leaves the machine.

```sh
EMAIL_PIPELINE_TEST_DATABASE_URL=postgresql://rodeo:rodeo@localhost:5432/rodeo-development npm run test:email-pipeline
```

The integration tests skip when the variable is unset and refuse remote databases.
Production verification still requires uploading a PDF and sending to one controlled
inbox, then checking the attachment and Resend delivery status.

### Production auth

Production signs in through Supabase — Google OAuth or email/password — and first login **is** registration: the `User` row is created from the Supabase identity with the `HACKER` role. The email/password sign-up form registers with Supabase only; the local row still comes from that first authenticated request. Password resets ride Supabase's recovery mail: the link signs the user in through `/auth/callback` and lands on `/reset-password`. Elevating someone to organizer or admin is done from `/admin/users`.

#### Testing Google OAuth locally

You can run Google OAuth against your local Docker Postgres. Supabase handles only the OAuth handshake; your local database is used for all data.

**1. Get credentials from the tech director.** You need `SUPABASE_URL` and `SUPABASE_ANON_KEY` — ask the tech director. If you don't have Supabase dashboard access, also ask them to add the redirect URL in step 2.

**2. Add a localhost redirect URL** in the Supabase dashboard under Authentication → URL Configuration:

```
http://localhost:5173/auth/callback
```

**3. Update `.env`** — remove `ALLOW_DEV_AUTH=1` and add:

```env
VERCEL_ENV=preview
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

`VERCEL_ENV=preview` activates Supabase auth without requiring `RESEND_API_KEY`.

**4.** `npm run dev` — the login page will show the Google button.

First login creates a `HACKER` account. To test the admin portal, open `npm run db:studio` and set your user's `role` to `ADMIN`.

### Email

Templates are authored as markdown at `/admin/email-templates` and rendered on the way out. Preview deploys refuse every recipient that isn't `@yopmail.com`.

## Testing

```bash
npm test              # run once
npm run test:unit     # watch mode
```

Router tests call the real tRPC routers through `createTestCaller` against a mocked Prisma client — no database needed. `expect.requireAssertions` is on; a test that asserts nothing fails.

## Scripts

| Script                   | Description                          |
| ------------------------ | ------------------------------------ |
| `npm run dev`            | Dev server                           |
| `npm run build`          | Production build                     |
| `npm run preview`        | Serve the production build locally   |
| `npm run check`          | `svelte-check` (TypeScript + Svelte) |
| `npm run lint`           | Prettier + ESLint + design tokens    |
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

Vercel, via `@sveltejs/adapter-vercel` on the Node runtime (not edge — Prisma needs a TCP socket). Deploys are driven by GitLab CI; the Vercel project has no Git integration.

Three pipeline stages on every push:

1. **test** — build, `svelte-check`, lint, unit tests. No database needed.
2. **deploy-preview** — each branch gets its own Postgres schema inside the shared Supabase database, dropped and recreated, migrated, and seeded on every push. `mainline` also gets a staging alias (`rodeo-2-0-nightly.vercel.app`). Run the manual `stop-preview-job` when a branch is done — abandoned schemas accumulate.
3. **deploy-production** — manual, Maintainer only. Runs migrations then `vercel deploy --prod`. Never seeded.

Environment variables live in Vercel, not GitLab. GitLab only stores the four Vercel tokens, and the pipeline config is pinned to `mainline` so a branch can't rewrite it to leak them.

**Two database URLs in Vercel:**

- `DATABASE_URL` — Supabase transaction pooler (port 6543), used by the app at runtime.
- `DIRECT_URL` — Supabase session pooler (port 5432), used by migrations and the seed.

## Contributing

### Before opening a PR

- `npm run check` — TypeScript and Svelte diagnostics
- `npm run lint` — Prettier, ESLint, design-token rules
- `npm test` — Vitest

If you changed `prisma/schema.prisma`, commit a **migration** (`npm run db:migrate`), not just a `db:push`. Deployed environments apply migrations; a push-only change never reaches them.

### Style

1. **Keep it simple.** Don't overengineer. Every unnecessary abstraction is something the next person has to understand at 2am during the event.
2. **Mobile-first.** Test at 320px wide first, then scale up. Organizers scan and triage on phones, not laptops.
3. **Progressive enhancement.** Use form actions where possible so the feature works without JavaScript.
4. Match Prettier formatting and ESLint rules. Follow `docs/design-language.md` for anything visual — no hex codes outside `app.css`, no raw numbers for size or spacing.
5. Small, focused PRs. No unrelated refactors bundled in.

### Branch naming

The pipeline enforces: `(feature|bugfix|hotfix|devops)/\d+-description`, e.g. `feature/42-team-invites`. The default branch is `mainline`.

## Design system

`docs/design-language.md` is the spec; `src/app.css` is the machine-readable half. Two rules enforced by `npm run lint:tokens`: no hex codes outside `app.css`, no raw numbers for size, space, or type. The linter is scoped to directories already migrated — widen it as pages land.

`/design` renders the live style guide (staff-only, 404s for hackers). The `design/` folder at the repo root is the original competing mockups — not a spec, don't build against it.

## Audit log

Every administrative mutation writes a `Log` row via `logAction` in `src/lib/server/log.ts`, readable at `/admin/logs`. Action slugs must be registered in `src/lib/log/actions.ts` — an unregistered slug is a compile error. Review-lock churn (`claim`, `heartbeat`) is deliberately unlogged.

## Docs

- `docs/design-language.md` — design system and its two hard rules
- `docs/component-library-plan.md` — the `ui/` and `patterns/` layers
- `docs/blacklist.md` — why email auto-rejects and a name only flags
