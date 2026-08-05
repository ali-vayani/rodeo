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
| Email      | Resend, with an SMTP fallback                      |
| Validation | Zod                                                |
| Tests      | Vitest                                             |
| Hosting    | Vercel                                             |

## Prerequisites

- Node.js 22+
- Docker Desktop for local Postgres

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

   Local development needs `DATABASE_URL` and `ALLOW_DEV_AUTH=1` — see
   [Environments](#environments) for why. Without the second one the server refuses
   to start: the development environment signs in any `@yopmail.com` account with no
   password, so enabling it has to be a deliberate act rather than the default a
   misconfigured deploy falls into.

3. Start Postgres:

   ```bash
   docker compose up -d
   ```

4. Apply migrations and seed test accounts:

   ```bash
   npm run db:setup
   ```

5. Start the dev server:

   ```bash
   npm run dev
   ```

### Logging in locally

There are no passwords in development. Any seeded `@yopmail.com` address logs straight in —
`admin@yopmail.com` for the admin portal, `hacker.applied@yopmail.com` for a hacker mid-flow.
See `prisma/seed.ts` for the full set, which covers every role and status combination.

## Environments

Three environments, resolved from `VERCEL_ENV` (falling back to `NODE_ENV`) in
`src/lib/server/env.ts`. `NODE_ENV` alone is not enough, because a Vercel preview deploy is a
_production build_ pointed at the _production database_:

| Environment     | Auth              | Email                                              |
| --------------- | ----------------- | -------------------------------------------------- |
| **development** | yopmail bypass    | printed to the console, never sent                 |
| **preview**     | Supabase (Google) | real transport, but `@yopmail.com` recipients only |
| **production**  | Supabase (Google) | Resend, or SMTP if no Resend key is set            |

A production boot fails immediately if `SUPABASE_URL`, `SUPABASE_ANON_KEY`, or an email
transport is missing, rather than on the first hacker who tries to sign in.

### Production auth

Google OAuth is the only production sign-in path, and the first login **is** registration — the
`User` row is created from the Google profile with the `HACKER` role. There is no sign-up form
and no password reset to maintain. Elevating someone to organizer or admin is done from
`/admin/users`.

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

## Useful Scripts

| Script                | Description                             |
| --------------------- | --------------------------------------- |
| `npm run dev`         | Dev server                              |
| `npm run build`       | Production build                        |
| `npm run check`       | `svelte-check`                          |
| `npm run lint`        | Prettier + ESLint + design tokens       |
| `npm run lint:tokens` | Design-system token rules (see `docs/`) |
| `npm run format`      | Write with Prettier                     |
| `npm test`            | Vitest (run once)                       |
| `npm run db:setup`    | Push schema, generate client, seed      |
| `npm run db:migrate`  | `prisma migrate dev`                    |
| `npm run db:seed`     | Re-seed dev accounts                    |
| `npm run db:studio`   | Prisma Studio                           |

## Supabase

Use the **PostgreSQL connection string** from your Supabase project (Settings → Database) as
`DATABASE_URL`. For auth, enable the Google provider in the Supabase dashboard and register
`https://<your-domain>/auth/callback` as an authorised redirect URL.

## Docs

- `docs/design-language.md` — the design system and its two hard rules
- `docs/component-library-plan.md` — the `ui/` and `patterns/` layers
- `docs/blacklist.md` — why email auto-rejects and a name only flags

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
