# Static datasets

Generated data, committed to the repo. Nothing here is edited by hand — change the
generator and re-run it.

## `universities.json`

The vocabulary behind the University linked field: every university and college in
North America, ~6,450 rows.

```
npm run data:universities
```

Two sources, because neither alone covers both halves of the question:

| Source                                                                                               | Covers                                                                                                 | Licence                         |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------- |
| [IPEDS `HD2023`](https://nces.ed.gov/ipeds/datacenter/data/HD2023.zip) — NCES, US Dept. of Education | The US, incl. Puerto Rico and the USVI. ~6,050 active institutions with city, state, and known aliases | Public domain (US federal work) |
| [Hipo/university-domains-list](https://github.com/Hipo/university-domains-list)                      | Canada, Mexico, Central America, the Caribbean. ~510 rows, name and country only                       | MIT                             |

IPEDS has an address for every row but stops at the US border; Hipo crosses it but
carries only a country code and lists a third as many US schools. Neither source's
territory overlaps the other's, so the two never disagree about a school.

The generator (`scripts/build-universities.mjs`) documents the filtering decisions —
which US territories count as North America, why `PR` comes from IPEDS rather than
Hipo, and how IPEDS's separator-free alias column is split.

**Read the diff after regenerating.** A large change in row count means a source
moved, not that hundreds of colleges opened or closed. The list is committed so that
builds do not depend on two third-party hosts, and so that the set of answers the
server will accept cannot change under a deploy.

Reach it through `universities.ts`, never by importing the JSON — see that file for
why the dynamic import matters.
