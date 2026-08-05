# Blacklist — Design Notes

Lets organizers keep known bad actors out of the event, entered by hand or imported from a
CSV. Supersedes the earlier `feature/2-blacklist-page` prototype, which was built against a
different data model and is not merged.

## The central decision: email and name are not equal

The original plan had one `Blacklist` row carrying a `type` of `EMAIL` or `NAME` and a
single `value`, with either kind auto-rejecting on submit. That conflates two signals with
very different reliability.

| Signal    | Matching                   | Effect                                       |
| --------- | -------------------------- | -------------------------------------------- |
| **Email** | Exact, on a normalized address | Auto-sets `pendingDecision = REJECTED` at `application.submit` |
| **Name**  | First **and** last, typo-tolerant | Flags for a reviewer. Decides nothing.  |

An email address identifies one person. A name does not — and two people sharing a name is
ordinary, not exceptional. Auto-rejecting on a name means an applicant who happens to share
a name with a banned person loses their application silently, with no one ever looking.

This split is what makes the rest of the design safe. Because a name match cannot reject
anyone, the matching is free to tolerate misspellings; because email matching auto-rejects,
it stays strictly exact.

**A consequence worth knowing:** name flags are computed per request in `admissions.list`,
not stored at submit time. An entry added *after* someone applied still flags them. The
email auto-reject, by contrast, only fires at submit — blacklisting an address afterward
does not retroactively reject that application.

## Name matching

`$lib/blacklist/match.ts`. Two stages, in order of how much work they do:

**1. Normalization** handles most real cases for free — NFKD decomposition strips diacritics,
then punctuation and case are folded away. `José`/`Jose`, `O'Brien`/`O’Brien`/`OBrien`,
`Smith-Jones`/`SmithJones` and `JAY PATIL`/`Jay Patil` all collapse to one form before any
fuzziness is involved.

**2. Jaro-Winkler ≥ 0.92**, applied to first and last name independently. Chosen over raw
edit distance because it is length-normalized (one wrong character matters far more in `Ann`
than in `Bartholomew`) and prefix-weighted (names are misspelled toward their ends).

The threshold was set by measurement, and sits in the gap between a typo and a genuinely
different surname:

```
catches   hasan/hassan .961   jhon/john .925   garca/garcia .967   nguyan/nguyen .933
rejects   patel/patil .907    chen/chan .867   smyth/smith .893    stephens/stevens .908
```

That second row matters as much as the first. Patel and Patil are different families, as are
Chen and Chan. Lowering the bar to catch them would cost far more than it gained.

**Requiring both components** is what keeps false positives manageable — two independent
0.92 gates is a much higher bar than one gate on the joined string, which would let a common
surname carry a first name that isn't close at all.

**Deliberately not used: Soundex, Metaphone, and other phonetic encoders.** They encode
English pronunciation and misfire badly on the international names a hackathon receives —
worse errors than they fix on this population.

**Known limitations**, both accepted:

- Transliteration variants (`mohammed`/`muhammad`, .850) score too low to match. Catching
  them needs the phonetic encoding rejected above.
- `User.name` is a single field, so first/last is a guess: the first and last whitespace
  token. `Maria de la Cruz` → `maria`/`cruz`. A single-token name (`Adam`) has no last name
  to gate on and is never name-matched.

## Data model

```prisma
model Blacklist {
  id        String   @id @default(cuid())
  firstName String
  lastName  String
  email     String?  @unique   // normalized: trimmed + lowercased
  reason    String?
  createdAt DateTime @default(now())
  @@index([createdAt])
}
```

`email` is **optional** so an organizer can blacklist someone they only have a name for —
that entry flags at review but never auto-rejects. Postgres permits many NULLs under a
unique index, so name-only rows don't collide.

The migration is written add-backfill-drop rather than as the straight column swap
`prisma migrate diff` emits, because that version fails outright on a table with rows
(`ADD COLUMN ... NOT NULL` with no default). It splits old `NAME` values on first/last token
and deduplicates addresses before adding the unique index.

## CSV import

Import is **partial-success**: valid rows land, invalid rows come back with their row number
and reason, nothing rolls back. Rejecting a whole file over one bad address is the wrong
failure mode for a hand-maintained spreadsheet.

`$lib/blacklist/csv.ts` is a real RFC 4180 parser, not `split(',')`. Files come out of Excel
and Google Sheets, which means quoted fields, commas inside the reason column, CRLF, and a
UTF-8 BOM — a naive split turns each of those into silently wrong data rather than a visible
error. A header row is *detected*, not assumed; blindly dropping line one eats a real entry
whenever someone exports without headers.

Two behaviors that look inconsistent but aren't:

- **`add` upserts; import never overwrites.** An admin retyping an address means to correct
  the entry. A re-imported file should not silently revert reasons curated by hand.
- **Name-only rows are deduplicated in application code.** `skipDuplicates` leans on the
  unique index, which only covers rows that have an address. Without the explicit check,
  name-only rows would accumulate a fresh copy on every import.

The UI reports the counts the *server* returned. Reporting the number of rows sent — as the
earlier prototype did — calls every skipped duplicate and rejected row a success.

## Deliberately not built

- **CSV export.** Not asked for; the table is the source of truth.
- **A fuzzy-matching settings toggle.** The threshold is a constant with a documented
  rationale. Making it configurable invites tuning it without the calibration data above.
- **Bulk delete.** Removal is one row at a time, behind a confirm.
