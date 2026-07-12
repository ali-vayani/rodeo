design_doc.md

date: 6/13/2025
branch: feature/2-blacklist-page

blacklist feature desc:

Build the /admin/blacklist page for managing the list of banned names and emails. The inputs we'll take are: name, email, and reason (optional). Entries are checked automatically on application submit.
https://gitlab.com/freetail-hackers/Rodeo-2.0/-/work_items?sort=created_date&state=opened&first_page_size=20&show=eyJpaWQiOiIyIiwiZnVsbF9wYXRoIjoiZnJlZXRhaWwtaGFja2Vycy9Sb2Rlby0yLjAiLCJpZCI6MTkxOTk3MDc3fQ%3D%3D

We want to make a blacklist feature to ensure hackers can attend the event with the comfort that any potential bad actors are not attending this event. To this effect, this admin page will enable admins to add a given user by their name, email and reason (optional) either manually or by importing a csv file. Additional features may also include enabling the admin to manually delete a user from the list and displaying the date they were added to the blacklist.

Referring to /design/admin-blacklist.html , elected to have a front end design inspired based off of Design 4. Light contrast, feels professional and easy on the eyes. Also feels intuitive to search, add and import names.

Files to be edited/looked into:
src/routes/admin/blacklist/+page.svelte
src/routes/admin/blacklist/+page.server.ts
src/lib/components/blacklist/BlacklistTable.svelte
src/lib/components/blacklist/AddBlacklistForm.svelte

1. Each row will contain a given actor’s fn, ln, reason (opt), email, date added and an “x” button to allow admin to delete a select user

model Blacklist {
id String @id @default(cuid())
name String
email String
reason String?
createdAt DateTime @default(now())
}

Separating the email and name field into two diff ones makes it easier to search by either or and more simpler parsing from csvs
Feature Implementations:

Import csv - Enables admin to add a large amount of users and migrate them with minimal hassle

Valid csv input:
name,email,reason
John Doe,john@example.com,suspicious activity
Jane Smith,jane@example.com,
Jane Smith,jane@example.com

Considering installing a tsx (prisma) dev dependency

Plain node prisma/seed.ts — Node 24 (what's installed here) can execute .ts files directly via built-in type-stripping, as long as the file avoids TS-only runtime constructs (enums, namespaces, etc.). My seed.ts only uses type annotations and imports Status as a value from @prisma/client, so it should qualify — zero new dependencies.
tsx — the more common/robust choice for Prisma seeds since it doesn't choke on edge-case TS syntax, but it's a new dependency for something Node can likely already do here.

Search - A search bar at the top of the UI that’ll enable users to quickly find users by their fn, ln or email

Regex for valid email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Manual Add - By filling in the fn/ln + reason (optional) field, an admin can manually add a blackmail user

Location: +page.svelte
Note: The Add button should be disabled until the name and email are non empty

Manual Delete - On each row on the right hand side, add an “x” button to enable an admin to delete a select user from the blacklist

Notable edgecases / things to look out for:

- check valid email format
- import csv func working; check if partially correct csvs input valid information or refuse to etc.
- if someone only has a fn/ln and no email, a person with the same exact name could in theory also be blacklisted… double check this…
- if there’s no reason, currently set for this to be a NULL value then displayed as “-” on the list
- search by name should not be case sensitive

Questions:

How do we handle duplicates?

Do we want to add a feature that enables admin to delete more than one blacklist user at a time? (A clear button?)

Should we also add an export feature?

Testing:

src/lib/server/trpc/routers/test/blacklist.test.ts

src/lib/server/trpc/routers/test/application.test.ts
