# Echo

Echo is a judging platform for in-person hackathons. It provides an **Admin** panel that only admistors can access to help run the event and a **Judge** panel that judges can access to score projects.

This repository is a **scaffold**: SvelteKit, Tailwind CSS, tRPC, Prisma (PostgreSQL), and Docker Compose for local Postgres. Features that need to be implemented are assigning tables to projects, judging portal, flagging system, and leaderboard (among others).

## Stack

| Layer      | Technology                                         |
| ---------- | -------------------------------------------------- |
| Frontend   | SvelteKit (Svelte 5), Tailwind CSS                 |
| API        | tRPC (`/api/trpc`)                                 |
| Database   | Prisma ORM → PostgreSQL (local Docker or Supabase) |
| Validation | Zod                                                |
| Tests      | Vitest                                             |
| Quality    | ESLint, Prettier, svelte-check                     |

## Prerequisites

- Node.js 20+
- Docker Desktop for local Postgres

## Setup

1. Clone the repo and install dependencies:

   ```bash
   npm install
   ```

2. Copy environment variables:

   ```bash
   cp .env.example .env
   ```

   Adjust `DATABASE_URL` if you use Supabase or a non-default local Postgres URL.

3. Start Postgres:

   ```bash
   docker compose up -d
   ```

4. Apply migrations:

   ```bash
   npm run db:migrate
   ```

5. Start the dev server:

   ```bash
   npm run dev
   ```

   Open the app (e.g. http://localhost:5173). The home page calls the `health` tRPC procedure to verify the API.

## Useful Scripts

| Script                | Description                    |
| --------------------- | ------------------------------ |
| `npm run dev`         | Dev server                     |
| `npm run build`       | Production build               |
| `npm run check`       | `svelte-check`                 |
| `npm run lint`        | Prettier + ESLint              |
| `npm run format`      | Write with Prettier            |
| `npm test`            | Vitest (run once)              |
| `npm run db:generate` | `prisma generate`              |
| `npm run db:migrate`  | `prisma migrate dev`           |
| `npm run db:push`     | `prisma db push` (prototyping) |
| `npm run db:studio`   | Prisma Studio                  |

## Supabase

Use the **PostgreSQL connection string** from your Supabase project (Settings → Database) as `DATABASE_URL`. Prisma works with Supabase Postgres the same way as with local Docker Postgres; choose the connection mode (direct vs pooler) that matches your hosting and Prisma docs.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).
