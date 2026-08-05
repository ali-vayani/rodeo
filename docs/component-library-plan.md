# Component Library — Audit & Consolidation Plan

Status: proposal. Written during the Phase 15 polish pass, after Custom Email and Schedule shipped
and while Blacklist is still in flight.

Scope: the 54 `.svelte` files under `src/` (8,781 lines). This document is an inventory of what we
build over and over, a proposed set of shared components to replace it, and an order to do the work
in.

---

## 1. What the audit found

The app has a design system on paper — `src/app.css` defines eight color tokens and two font
families — but no component layer under it. Every page reaches straight for raw Tailwind utilities,
so the same visual object gets re-typed at every call site with slightly different numbers.

The evidence, measured across `src/`:

| Finding                                                                   | Number               |
| ------------------------------------------------------------------------- | -------------------- |
| `<button>` elements                                                       | 106, across 37 files |
| Distinct class strings on the 69 buttons with a literal `class`           | **58**               |
| Distinct _primary_ button styles / actual primary buttons                 | **16 / 17**          |
| Distinct _secondary_ button styles / actual secondary buttons             | 18 / 25              |
| Distinct _danger_ button styles / actual danger buttons                   | 8 / 8                |
| Distinct "card" class strings (`rounded border border-border bg-white …`) | 26                   |
| Distinct uppercase eyebrow-label class strings                            | 40                   |
| Hand-rolled modal overlays (`fixed inset-0 …`)                            | 9                    |
| `showToast()` reimplementations                                           | 7                    |
| `DECISION_CLASS` color map, copy-pasted verbatim                          | 5                    |
| `formatDate()` definitions                                                | 5                    |
| `decLabel()` definitions                                                  | 4                    |
| "Type WORD to confirm" implementations                                    | 3                    |
| Uses of `cn()` from `src/lib/utils.ts`                                    | **0**                |
| Uses of `bits-ui` (installed, and required by PLAN.md)                    | **0**                |
| Uses of `focus-visible`                                                   | **0**                |

Sixteen distinct styles for seventeen primary buttons is the headline. It means there is effectively
no such thing as "the primary button" in this codebase — there are seventeen of them, and they
disagree about padding (`py-2` vs `py-[9px]`), radius (`rounded` vs `rounded-md`), font size
(`text-sm` vs `text-[13px]`), border (`border-none` vs `border border-primary`), and disabled state
(`opacity-40` vs `opacity-50` vs `opacity-60` vs `disabled:opacity-40` vs `class:opacity-60`).

### 1.1 Two competing style eras

The variance is not random. It splits cleanly into two dialects:

- **Mockup dialect** — `text-[13px]`, `py-[9px]`, `px-[18px]`, `rounded-md`, `tracking-widest`.
  Transcribed from the static HTML in `design/`. This is the majority and it is what the newest
  pages use.
- **Tailwind-scale dialect** — `text-sm`, `px-4 py-2`, `rounded`. Used in the hacker portal, the
  login page, and the older admin pages.

Both look fine in isolation. Side by side on the same screen they read as two different products.
The fix is not to relitigate which scale is right — it is to encode one of them **once, inside a
component**, so the numbers stop being reachable from a call site.

### 1.2 The `application-editor` island

`src/routes/admin/application-editor/` plus `src/lib/components/admin/applications/` is 1,943 lines
that does not participate in the design system at all:

- ~940 lines of scoped `<style>` CSS instead of Tailwind.
- `#191919` written as a literal **41 times** instead of `text-primary`; `#e0e0e0` 29 times instead
  of `border-border`; plus `#333`, `#444`, `#555`, `#666`, `#888`, `#aaa`, `#bbb`, `#ccc` as a
  freehand gray ramp.
- Indented with **spaces** while every other file uses tabs.

This is Phase 9's work, built before the shared design language settled. It is the single largest
consolidation target and it deserves its own PR.

### 1.3 Duplication that has already caused drift

Copy-paste has already produced inconsistency, not just repetition:

- **Toast.** Six pages carry a byte-identical `showToast()` + `{#if toast}` + `fly` transition block
  (3200ms). The seventh, `application-editor`, has its own variant with different state variable
  names and a 3500ms timeout. Same feature, two behaviors.
- **Page titles.** `text-[22px] font-bold text-primary` (8 uses) vs `text-2xl font-semibold
text-primary` (5 uses) vs `text-[22px] font-extrabold text-[#191919] m-0 tracking-tight` (1 use,
  raw hex instead of the token).
- **Empty states.** Six different treatments — `py-12 text-center text-[13px]`, `py-6 text-center
text-xs`, `px-4 py-6 text-center text-xs`, an italic inline span, a bare `<p>`, and a scoped-CSS
  one.
- **Confirm-by-typing.** `admissions/+page.svelte` and `DangerZoneTab.svelte` each hand-roll the
  RELEASE gate; `SendConfirmation.svelte` hand-rolls a third for SEND and is the only one that
  bothers to export its magic word (`CONFIRM_WORD`).
- **Layouts.** `routes/admin/+layout.svelte` and `routes/hacker/+layout.svelte` are byte-identical
  except for the `links` array.

### 1.4 Accessibility debt, concentrated in the modals

The nine hand-rolled modals each re-derive their own backdrop click, Escape key, `role="dialog"`,
and `aria-modal` wiring — and seven files carry a `<!-- svelte-ignore a11y_* -->` to silence what
that hand-rolling trips. None of them trap focus or restore it on close. There are 48 `hover:`
styles and zero `focus-visible:` styles in the entire app, so keyboard users get no visible focus
ring anywhere.

`bits-ui` is already a dependency and PLAN.md's closing constraints say: _"Use shadcn primitives
(via bits-ui) as the base for all interactive components. Do not build custom dropdown, dialog, or
select components from scratch."_ We built nine dialogs from scratch and imported bits-ui zero
times.

### 1.5 Formatting is unenforced in practice

`.prettierrc` sets `useTabs: true` and loads `prettier-plugin-tailwindcss` (which sorts class
strings), but **29 of the 54 `.svelte` files fail `npx prettier --check`** — meaning `npm run lint`
is red on `mainline` right now. Unsorted class attributes are part of why near-duplicate styles are
hard to spot by eye: the same button written in two orders looks like two different buttons in a
diff. Running `npm run format` before any of this work starts makes every subsequent refactor diff
readable.

### 1.6 Dead code

- `src/lib/components/admin/UserTable.svelte` (103 lines) is never imported. `routes/admin/users/`
  inlines its own copy of the same table — including the same `['Name','Email','Role','Status',
'Pending','Decision','Created','']` header array and the same `DECISION_CLASS` map.

### 1.7 The good news

The most recently written code is already reaching for this abstraction on its own.
`schedule/EventForm.svelte` hoists `const inputClass = …` and `const labelClass = …` to the top of
its `<script>` and reuses them across six fields. That is exactly the right instinct, applied at the
wrong scope. This plan is mostly a proposal to move those constants up one level and give them a
`.svelte` file.

---

## 2. Proposed component library

Three layers. Everything new lands in `src/lib/components/ui/` (primitives) or
`src/lib/components/patterns/` (composed). Domain components keep their current folders and get
rewritten to consume these.

All components take a `class` prop merged with `cn()` from `$lib/utils.ts` — the helper we already
wrote and never used — so call sites can adjust spacing without forking the style.

### Layer 0 — Foundations (not components)

**`src/app.css` — tokens to add.** The palette is currently incomplete, which is _why_ status colors
get hardcoded. `#16a34a` (success green) appears 7 times, `#b00000` 11 times, and the badge ramp
(`#d1fae5`/`#065f46`, `#fef9c3`/`#713f12`, `#fee2e2`/`#991b1b`, `#e5e7eb`/`#374151`) is duplicated
whole in 5 files.

```css
--color-success: #16a34a;
--color-success-subtle: #f0fdf4;
--color-warning: #ca8a04;
--color-warning-subtle: #fef9c3;
--color-destructive-subtle: #fff1f2; /* --color-destructive: #b00000 exists */
--color-surface: #f9f9f9; /* table headers, inset inputs */
--color-border-subtle: #f0f0f0; /* table row dividers */
--color-overlay: rgb(0 0 0 / 0.45); /* every modal backdrop */
--shadow-modal: 0 8px 32px rgb(0 0 0 / 0.18);
--shadow-toast: 0 4px 24px rgb(0 0 0 / 0.09), 0 1px 4px rgb(0 0 0 / 0.05);
```

**`src/lib/format.ts` — new.** Absorbs the helpers currently duplicated across components:

```ts
formatDate(d)              // 5 copies today
formatDateTime(d, tz?)
formatTime(d, tz?)         // 2 copies
initials(name)             // 2 copies
humanizeEnum(v)            // the `s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g,' ')`
                           // incantation, currently inline in ~8 places
```

**`src/lib/ui/tone.ts` — new.** One source of truth for decision/status → visual tone, replacing the
5 copies of `DECISION_CLASS` and the 4 of `decLabel`:

```ts
export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export function decisionTone(d: DecisionStatus | null): Tone;
export function statusTone(s: UserStatus): Tone;
export function scheduleTypeTone(t: ScheduleType): Tone;
```

**`src/lib/ui/toast.svelte.ts` — new.** A module-level rune store, mounted once in
`routes/+layout.svelte`. Deletes 7 copies of the state + timer + transition block:

```ts
export const toasts = { list, push(message, type?), dismiss(id) };
export function toast(message: string, type?: 'success' | 'error'): void;
```

### Layer 1 — Primitives (`$lib/components/ui/`)

| Component                                                        | Props                                                                                                                                           | Replaces                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`Button.svelte`**                                              | `variant: 'primary' \| 'secondary' \| 'danger' \| 'ghost'`, `size: 'sm' \| 'md'`, `loading`, `disabled`, `type`, `href?`, `onclick`, `children` | 58 distinct class strings across 106 buttons. Renders `<a>` when `href` is set. Owns the disabled + loading treatment so `opacity-40/50/60` stops being a decision.                                                 |
| **`Badge.svelte`**                                               | `tone: Tone`, `variant: 'solid' \| 'subtle' \| 'outline'`, `mono?`, `children`                                                                  | The 5 `DECISION_CLASS` maps and the ad-hoc chips in `ApplicantList`, `ApplicantDetail`, `UserTable`, `users/+page`, `account/+page`, `EventCard`.                                                                   |
| **`Card.svelte`**                                                | `title?`, `padding: 'none' \| 'sm' \| 'md'`, `header?` snippet, `footer?` snippet, `children`                                                   | 26 distinct `rounded border border-border bg-white p-…` strings. Includes the muted title bar (`border-b border-border bg-muted px-4 py-[9px]`) that `EventForm`, `SendHistory`, and `TemplateEditor` each rebuild. |
| **`Modal.svelte`**                                               | `open` (bindable), `title`, `size: 'sm' \| 'md' \| 'lg'` → 440/480/560px, `onClose`, `dismissible`, `header?`/`footer?` snippets, `children`    | All 9 overlays. Built on `bits-ui` `Dialog` so we get focus trap, focus restore, scroll lock, and correct ARIA for free — and can delete 7 `svelte-ignore a11y_*` comments.                                         |
| **`Field.svelte`**                                               | `label`, `error?`, `hint?`, `required?`, `for`, `children`                                                                                      | The label + control + error triad. `EventForm` repeats it 6×, the users modal 4×, settings tabs ~10×. Owns the eyebrow label style, collapsing 40 variants to one.                                                  |
| **`Input.svelte`** / **`Textarea.svelte`** / **`Select.svelte`** | `value` (bindable), `invalid?`, `mono?`, plus native attrs                                                                                      | 46 `<input>`, 5 `<textarea>`, 11 `<select>` with hand-written borders and focus states.                                                                                                                             |
| **`Checkbox.svelte`**                                            | `checked` (bindable), `label`                                                                                                                   | The `accent-primary cursor-pointer` + `<label class="flex items-center gap-1.5">` pairing in `UserFilters`, `RecipientFilter`, the users modal, and `QuestionEditor`.                                               |
| **`Spinner.svelte`**                                             | `size`                                                                                                                                          | We have 2 `animate-spin` and otherwise signal loading via text swaps (`'Saving…'`) and `opacity-50`. Fine, but it should be one decision.                                                                           |
| **`EmptyState.svelte`**                                          | `message`, `icon?`, `action?` snippet                                                                                                           | The 6 divergent empty treatments.                                                                                                                                                                                   |
| **`SectionLabel.svelte`**                                        | `children`                                                                                                                                      | The uppercase eyebrow — 40 distinct class strings, ~35 uses. Cheapest single win in the audit.                                                                                                                      |

### Layer 2 — Patterns (`$lib/components/patterns/`)

| Component                  | Props                                                                                                 | Replaces                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`ConfirmDialog.svelte`** | `open`, `title`, `body`, `confirmLabel`, `tone`, `confirmPhrase?`, `onConfirm`, `onCancel`, `loading` | `DeleteEventDialog`, `IdleWarningModal`, the decline-confirm in `ApplicationStateView`, and — via `confirmPhrase` — all 3 type-the-word gates (RELEASE ×2, SEND ×1). |
| **`PageHeader.svelte`**    | `title`, `subtitle?`, `actions?` snippet                                                              | The 16 `<h1>` + right-aligned-action rows, currently in 3 divergent title styles.                                                                                    |
| **`DataTable.svelte`**     | `columns: Column[]`, `rows`, `onRowClick?`, `empty?`, `loading?`                                      | `UserTable` (dead), the inlined users table, `ApplicantTable`, `SendHistory`. Owns sticky headers, zebra/hover, and the empty state.                                 |
| **`Pagination.svelte`**    | `page`, `totalPages`, `loading`, `onChange`                                                           | The prev/next/count bar in `users/+page.svelte`, which is the only paginated view today but won't be once Blacklist lands.                                           |
| **`Tabs.svelte`**          | `tabs`, `active` (bindable), `orientation: 'horizontal' \| 'vertical'`                                | Settings' 4 tabs, Email Templates' left rail, Custom Email's 3-step rail, Admissions' filter tabs, `DayToggle`. Five implementations of one control.                 |
| **`FilterGroup.svelte`**   | `title`, `options`, `selected` (bindable), `onClear`                                                  | `UserFilters` and `RecipientFilter` — near-identical checkbox-group-with-clear-link, built twice.                                                                    |
| **`SidebarNav.svelte`**    | `links`, `brand`                                                                                      | Collapses the two byte-identical layouts into one component the two `+layout.svelte` files parameterize.                                                             |
| **`ToastHost.svelte`**     | —                                                                                                     | Mounted once in `routes/+layout.svelte`; reads the store. Deletes 7 copies.                                                                                          |

### What is deliberately _not_ on this list

- **A `Table` abstraction beyond `DataTable`.** Four tables is not enough evidence to design a
  generic one; `DataTable` covers the three that are genuinely alike.
- **Form-state management.** Auto-save, validation, and dirty-tracking differ enough per page
  (application, event form, question editor) that a shared `<Form>` would be premature.
- **A `Layout`/`Grid` primitive.** Tailwind already does this; wrapping it adds indirection with no
  consistency payoff.

---

## 3. Migration order

Sequenced so each step is independently shippable and reviewable, and so no step mixes a refactor
with a visual change.

**Step 0 — Pick the dialect.** One decision, made once, before any component is written: the
mockup dialect (`text-[13px]`, `py-[9px]`, `rounded-md`) is the majority and matches `design/`, so
it should win. Record it here and let the primitives be the only place those numbers appear.

**Step 0.5 — `npm run format`.** One mechanical commit, 29 files, zero behavior change. Gets
`npm run lint` green and gets Tailwind class strings sorted so every later diff is readable. Do this
alone, before anything else, so it never contaminates a review.

**Step 1 — Foundations.** Tokens in `app.css`, `format.ts`, `tone.ts`, `toast.svelte.ts`. No visual
change, no call sites touched. Safe to merge immediately.

**Step 2 — Toast.** Mount `ToastHost` in the root layout, replace 7 `showToast` implementations with
the store import. Pure deletion, ~120 lines out, and it fixes the 3200/3500ms split.

**Step 3 — Primitives.** Build Layer 1. Migrate mechanically, one page per commit, starting with
the newest pages (`schedule`, `custom-email`) since they are closest to the target style and will
surface API gaps cheaply.

**Step 4 — Modals.** `Modal` + `ConfirmDialog` on bits-ui, then convert all 9 overlays. Delete the
`svelte-ignore a11y_*` comments as they become unnecessary. This is the step that pays down the
accessibility debt.

**Step 5 — Tables and patterns.** `DataTable`, `Pagination`, `Tabs`, `FilterGroup`, `PageHeader`,
`SidebarNav`. Delete `UserTable.svelte`.

**Step 6 — The `application-editor` island.** Rewrite all 5 files onto the primitives; delete ~940
lines of scoped CSS. Own PR, reviewed against the mockup, because it is the only step with real
visual risk.

**Step 7 — Accessibility pass.** Add `focus-visible:` rings to every primitive (one place, now).
Audit keyboard paths through the modals and tab controls. Closes PLAN.md §15.5.

**In flight:** Blacklist should be built directly on the Step 1–3 primitives rather than shipped in
the current style and migrated later. If it lands before those exist, it adds a 10th modal, a 5th
table, and a 17th primary-button variant.

---

## 4. Rules going forward

1. **Any button, badge, card, input, modal, or table goes through a component.** If a call site
   needs a shape the component cannot express, extend the component's props — do not fork the class
   string.
2. **No raw hex in `.svelte` files.** Every color comes from an `app.css` token. (Today: `#191919`
   appears 41 times in `application-editor` alone, and there is no success-green token at all, which
   is why `#16a34a` is scattered across 7 files.)
3. **No scoped `<style>` blocks in new work.** Tailwind + tokens only.
4. **`bits-ui` for anything with focus or overlay behavior** — dialogs, dropdowns, selects — per
   PLAN.md's existing constraint. Hand-rolling these is what produced the current a11y debt.
5. **Class merging via `cn()`,** so a `class` prop can override rather than collide.
6. **Tabs, not spaces.** Prettier already enforces this; the `application-editor` island predates
   it being run over that directory.
