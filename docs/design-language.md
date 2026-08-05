# Rodeo Design Language

The system every page is built from. `src/app.css` is the machine-readable half of this document —
if the two disagree, `app.css` wins and this file is stale.

Companion doc: [`component-library-plan.md`](./component-library-plan.md) — the audit that motivated
this, and the migration order.

---

## 0. Where this came from

The `design/` folder is not a spec. Every file in it is a 3×2 grid of _competing_ directions — "V1
Editorial," "V2 Brutalist," "V3 Minimal," "V4 Systematic," "V5 Dashboard," "V6 Form-first" — each
with its own font stack, border weight, and type scale. It was an option menu, and nobody ever
picked. Pages then got built by grabbing whichever cell looked good that week, which is why the
audit found 58 distinct button styles and eight undeclared shades of gray.

This document is the pick.

### The four decisions

|                | Decision                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Direction**  | Keep Rodeo's identity — near-black monochrome, DM Mono for data, uppercase eyebrows — and adopt Stripe's _systems_ underneath it: layered elevation, a semantic status ramp, focus halos, one density scale. |
| **Accent**     | None. `#191919` is the only brand color. Color means status and nothing else.                                                                                                                                |
| **Foundation** | Hand-built primitives that own their own classes, delegating focus-trap/overlay/listbox behavior to **bits-ui** (v1.8, already installed). shadcn-svelte is a reference to read, not a package to install.   |
| **Density**    | Compact. 13px base, 32px controls, 36px table rows. Tuned for admissions triage and the scan log.                                                                                                            |

### What "Stripe systems" actually means here

Stripe's dashboard doesn't look good because of its purple. It looks good because of four things we
don't currently do:

1. **Elevation instead of hard lines.** A Stripe card is a hairline border _plus_ a barely-there
   shadow. Ours are flat 1px boxes, so nothing has a hierarchy — a modal and a table cell sit on the
   same visual plane.
2. **One semantic ramp, used sparingly.** Status colors are muted (`#ecfdf3`, not `#d1fae5`) and
   appear nowhere else, so they read instantly.
3. **A real focus story.** Every control has a translucent halo on `focus-visible`. We currently
   have 48 `hover:` styles and zero focus styles.
4. **Ruthless density discipline.** One type scale, one control height, everywhere.

We are taking those four. We are not taking the purple, the 8px radii, or the all-sans typography —
those are Stripe's identity, not ours.

---

## 1. The two rules

> **No hex codes outside `app.css`.**
> **No raw numbers for size, space, or type outside `app.css`.**

Concretely, this is banned in a `.svelte` file:

```svelte
<!-- ✗ every one of these is a rule violation -->
<button class="bg-[#191919] px-[18px] py-[9px] text-[13px] rounded-md">
<span class="text-[10px] tracking-[0.06em] text-[#aaa]">
<div class="max-h-[calc(100vh-280px)]">
```

and this is the same UI, compliant:

```svelte
<!-- ✓ every value resolves to a token in app.css -->
<Button variant="primary">          <!-- best: the component owns it -->
<span class="text-2xs tracking-eyebrow text-faint">
<div class="workspace-max-h">
```

Three escape hatches exist, in order of preference:

1. **A token** in `@theme` → generates a utility (`--color-success-50` → `bg-success-50`).
2. **A custom utility** via `@utility` in `app.css`, for things `@theme` can't express — currently
   only viewport-relative heights, since Tailwind v4 has no height namespace.
3. **Tailwind's own built-in scale** — `p-4`, `gap-2`, `duration-150`. These are named classes, not
   raw numbers, and they're fine.

There is no fourth. If you need a value that doesn't exist, add it to `app.css` first.

---

## 2. Tokens

Full definitions and rationale live in `src/app.css`. Summary:

### Color

| Group       | Tokens                                                            | Use                                                                  |
| ----------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| Neutrals    | `neutral-25` → `neutral-900`                                      | The spine. Ten rungs so nobody freehands `#333`/`#888`/`#bbb` again. |
| Surfaces    | `background` `card` `muted` `surface-hover`                       | Page is `#f4f4f4`, raised things are white.                          |
| Text        | `foreground` `foreground-secondary` `foreground-tertiary` `faint` | `faint` (`#aaa`) is for placeholders and disabled only.              |
| Borders     | `border` `border-subtle` `border-strong`                          | `border-subtle` is for table row dividers.                           |
| Brand       | `primary` `primary-hover` `primary-foreground`                    | `#191919`, never `#000`.                                             |
| Status      | `success-*` `warning-*` `danger-*` `info-*` at `50/200/500/700`   | 50 fills, 200 outlines, 500 is the dot, 700 is text on the 50.       |
| Destructive | `destructive` `destructive-hover`                                 | Aliases the danger ramp so there's one red, not two.                 |

**Two deliberate color changes from today's app:**

- `muted-foreground` moves from `#aaa` to `#6b6b6b`. `#aaa` on white is **2.3:1** — it fails WCAG AA
  badly, and it's currently used for real body text in ~80 places, not just placeholders. The new
  value is 5.1:1. Secondary text across the app will get noticeably darker, and that is the point.
- `destructive` moves from `#b00000` to `#b42318`, joining the danger ramp. Visually near-identical;
  systematically it means red is one decision instead of two.

### Type — compact scale

| Token       | Size     | Used for                                    |
| ----------- | -------- | ------------------------------------------- |
| `text-2xs`  | 10px     | Eyebrow labels, table headers, badges       |
| `text-xs`   | 11px     | Meta, helper text, timestamps               |
| `text-sm`   | 12px     | Dense secondary                             |
| `text-base` | **13px** | Body default                                |
| `text-md`   | 14px     | Comfortable body — hacker portal, long-form |
| `text-lg`   | 15px     | Card and section titles                     |
| `text-xl`   | 17px     | Modal titles                                |
| `text-2xl`  | 22px     | Page titles                                 |
| `text-3xl`  | 28px     | Stat values                                 |

> **This redefines Tailwind's defaults.** `text-sm` is 12px here, not 14px; `text-base` is 13px, not
> 16px. That is intentional — it means the whole app lands on one scale — but it does shift the
> hacker portal and login page, which were built on the stock scale. Expect those to read tighter
> after migration and review them explicitly.

`--tracking-eyebrow: 0.08em` replaces the five tracking values currently in circulation.

### Radius, elevation, motion

|                                   |                                              |
| --------------------------------- | -------------------------------------------- |
| `rounded-sm` 4px                  | badges, chips, checkboxes                    |
| `rounded-md` 6px                  | buttons, inputs, selects                     |
| `rounded-lg` 8px                  | cards, panels, toasts                        |
| `rounded-xl` 12px                 | modals                                       |
| `shadow-xs`                       | resting secondary buttons and inputs         |
| `shadow-sm`                       | cards                                        |
| `shadow-md`                       | dropdowns, popovers, toasts                  |
| `shadow-lg`                       | modals                                       |
| `shadow-ring`                     | the focus halo — `focus-visible:shadow-ring` |
| `shadow-ring-danger`              | focus halo on destructive controls           |
| `ease-out-quick` + `duration-150` | hovers and state changes                     |

Shadows are tinted with the ink (`rgb(25 25 25 / …)`) rather than pure black, so they read as depth
rather than grime.

### Sizing

Control heights come off the 4px spacing base — `h-7` (28px), `h-8` (32px), `h-10` (40px) — so no
tokens are needed. Named widths that _are_ tokenized: `max-w-modal-sm|md|lg|xl` (400/480/560/720),
`w-sidebar` (210px), `max-w-prose` (640px).

---

## 3. Component inventory

Two folders. Primitives know nothing about Rodeo; patterns know about users, decisions, and scans.

```
src/lib/components/
  ui/          ← primitives. No domain types, no tRPC, no business logic.
  patterns/    ← composed, Rodeo-aware. Built only from ui/.
  <domain>/    ← existing feature folders. Built only from ui/ + patterns/.
```

Every primitive takes `class` (merged via the `cn()` helper already sitting unused in
`$lib/utils.ts`) and spreads `...rest` onto its root, so call sites can adjust spacing without
forking the style.

### 3.1 Primitives — `ui/`

#### `Button.svelte`

```
props   variant: 'primary' | 'secondary' | 'ghost' | 'danger'   (default secondary)
        size:    'sm' | 'md' | 'lg'                             (default md)
        loading, disabled, type, href?, onclick, children

base    inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md
        font-medium transition-colors duration-150 ease-out-quick
        focus-visible:shadow-ring disabled:pointer-events-none disabled:opacity-50

sizes   sm  h-7  px-3 text-xs        md  h-8  px-4 text-base        lg  h-10 px-5 text-md

primary    bg-primary text-primary-foreground font-semibold hover:bg-primary-hover
secondary  bg-card text-foreground border border-border shadow-xs hover:bg-muted
           active:bg-neutral-100
ghost      text-foreground-secondary hover:bg-muted hover:text-foreground
danger     bg-destructive text-destructive-foreground font-semibold
           hover:bg-destructive-hover focus-visible:shadow-ring-danger
```

Renders `<a>` when `href` is set. `loading` swaps the label for a `Spinner` **without changing
width**, so rows don't reflow mid-save. `disabled:opacity-50` is the single answer to the four
different disabled treatments in the codebase today.

Replaces: 58 distinct class strings across 106 buttons.

#### `Badge.svelte`

```
props   tone:    'neutral' | 'success' | 'warning' | 'danger' | 'info'
        variant: 'subtle' | 'solid' | 'outline'     (default subtle)
        dot?: boolean

base    inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5
        font-mono text-2xs font-medium uppercase tracking-eyebrow

subtle  bg-{tone}-50  border-{tone}-200  text-{tone}-700
solid   bg-{tone}-500 border-transparent text-white
outline bg-card       border-{tone}-200  text-{tone}-700
dot     size-1.5 rounded-full bg-{tone}-500
```

Mono + uppercase keeps the Rodeo character; the tinted ramp is the Stripe part. `neutral` maps to
`bg-muted border-border text-foreground-secondary`.

Replaces: the 5 copy-pasted `DECISION_CLASS` maps and every ad-hoc status chip.

#### `Card.svelte`

```
props   title?, padding: 'none' | 'sm' | 'md'  (default md), header? footer? children

root    bg-card border border-border rounded-lg shadow-sm
header  flex items-center justify-between gap-3 border-b border-border bg-muted px-4 py-2.5
        └ title renders as an Eyebrow
body    none → ''   sm → p-4   md → p-5
footer  flex justify-end gap-2 border-t border-border px-4 py-3
```

The muted header bar is the one `EventForm`, `SendHistory`, and `TemplateEditor` each rebuild today.

#### `Modal.svelte` — wraps `bits-ui` `Dialog`

```
props   open (bindable), title, description?, size: 'sm'|'md'|'lg'|'xl' (default md),
        dismissible = true, onClose, header? footer? children

overlay fixed inset-0 z-50 bg-overlay
panel   fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2
        w-full max-w-modal-{size} rounded-xl bg-card shadow-lg
header  flex items-start justify-between gap-4 border-b border-border px-6 py-4
        title: text-xl font-semibold   description: text-xs text-foreground-secondary
body    px-6 py-5 panel-scroll
footer  flex justify-end gap-2 border-t border-border px-6 py-4
```

bits-ui supplies focus trap, focus restore, scroll lock, Escape, and correct ARIA — which is what
lets us delete the seven `<!-- svelte-ignore a11y_* -->` comments the hand-rolled overlays needed.

Replaces: all 9 hand-rolled overlays, and their six different panel widths.

#### `Field.svelte` + controls

```
Field    props: label, for, error?, hint?, required?
         label → Eyebrow;  hint → text-xs text-foreground-tertiary
         error → text-xs text-danger-700, and sets aria-invalid on the control

Input    h-8 w-full rounded-md border border-border bg-card px-3 text-base text-foreground
         placeholder:text-faint
         focus-visible:border-primary focus-visible:shadow-ring
         aria-invalid:border-danger-500 aria-invalid:focus-visible:shadow-ring-danger
         disabled:bg-muted disabled:text-faint
         props: mono? → adds font-mono (for codes, UIDs, datetimes)

Textarea same, plus min-h-16 resize-y py-2
Select   wraps bits-ui Select — same shell as Input, chevron, styled listbox popover
         (shadow-md, rounded-lg, max-h + scroll)
Checkbox wraps bits-ui Checkbox — size-4 rounded-sm border-border-strong
         checked: bg-primary + white check;  focus-visible:shadow-ring
Switch   wraps bits-ui Switch — settings toggles
```

`Field` collapses the 40 distinct eyebrow-label class strings into one, and gives every form control
a consistent error slot — something no page has today.

#### Small primitives

| Component           | Spec                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Eyebrow.svelte`    | `font-mono text-2xs font-medium uppercase tracking-eyebrow text-foreground-tertiary`. The single most-repeated string in the app (~35 uses, 40 variants).   |
| `Spinner.svelte`    | `animate-spin rounded-full border-2 border-current border-t-transparent`, sizes `size-3 / size-4`.                                                          |
| `EmptyState.svelte` | `flex flex-col items-center gap-2 py-10 text-center`, message `text-base text-foreground-secondary`, optional action slot. Replaces 6 divergent treatments. |
| `Divider.svelte`    | `border-t border-border-subtle`, optional inset label.                                                                                                      |
| `IconButton.svelte` | Square `Button` — `size-7`/`size-8`, `rounded-md`, ghost by default. Requires `aria-label`.                                                                 |
| `Tooltip.svelte`    | bits-ui Tooltip. `rounded-md bg-primary px-2 py-1 text-2xs text-primary-foreground shadow-md`.                                                              |

### 3.2 Patterns — `patterns/`

| Component              | Props                                                                                     | Replaces                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PageHeader.svelte`    | `title`, `subtitle?`, `actions?`                                                          | 16 `<h1>` rows in 3 title styles. `text-2xl font-bold`.                                                                                                                                  |
| `DataTable.svelte`     | `columns`, `rows`, `onRowClick?`, `loading?`, `empty?`, `stickyHeader?`                   | The dead `UserTable`, the inlined users table, `ApplicantTable`, `SendHistory`. Header `bg-muted` + Eyebrow `th`; rows `h-9`, `border-b border-border-subtle`, `hover:bg-surface-hover`. |
| `Pagination.svelte`    | `page`, `totalPages`, `loading`, `onChange`                                               | The prev/next bar in users — and whatever Blacklist needs.                                                                                                                               |
| `Tabs.svelte`          | `tabs`, `active` (bindable), `orientation`                                                | Five implementations of one control: settings' 4 tabs, email-templates' rail, custom-email's step rail, admissions' filters, `DayToggle`.                                                |
| `FilterGroup.svelte`   | `title`, `options`, `selected` (bindable), `onClear`                                      | `UserFilters` + `RecipientFilter` — the same checkbox-group-with-clear built twice.                                                                                                      |
| `ConfirmDialog.svelte` | `open`, `title`, `body`, `confirmLabel`, `tone`, `confirmPhrase?`, `onConfirm`, `loading` | `DeleteEventDialog`, `IdleWarningModal`, the decline confirm — and via `confirmPhrase`, all three type-the-word gates (RELEASE ×2, SEND ×1).                                             |
| `StatCard.svelte`      | `label`, `value`, `hint?`, `tone?`                                                        | Dashboard tiles. Value in `font-mono text-3xl`, label in `Eyebrow`.                                                                                                                      |
| `ToastHost.svelte`     | —                                                                                         | Mounted once in the root layout. Deletes 7 copies of the toast state/timer/transition block.                                                                                             |
| `SidebarNav.svelte`    | `links`, `brand`                                                                          | The two byte-identical layouts. `w-sidebar`.                                                                                                                                             |

### 3.3 Supporting modules

| File                      | Contents                                                                                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$lib/ui/toast.svelte.ts` | Module-level rune store + `toast(message, tone)`. One timeout constant, ending the 3200ms/3500ms split.                                                                                             |
| `$lib/ui/tone.ts`         | `decisionTone()`, `statusTone()`, `scheduleTypeTone()` — the single mapping from domain enum to `Badge` tone. Kills 5 `DECISION_CLASS` copies.                                                      |
| `$lib/format.ts`          | `formatDate`, `formatDateTime`, `formatTime`, `initials`, `humanizeEnum`. Kills 5 `formatDate` copies, 2 `initials`, 4 `decLabel`, and the inline `charAt(0) + slice(1).toLowerCase()` incantation. |

### 3.4 Deliberately not building

- **A form abstraction.** Auto-save, validation, and dirty-tracking differ too much between the
  application form, the event form, and the question editor. Premature.
- **A layout/grid primitive.** Tailwind already does this; wrapping it is indirection with no
  consistency payoff.
- **Dark mode.** Not asked for, and it would double every token. The structure supports adding it
  later — semantic aliases already sit between components and raw values.

---

## 4. Build order

1. ~~**Tokens.**~~ Done — `app.css` rewritten and validated against a real build.
2. **Supporting modules** — `format.ts`, `tone.ts`, `toast.svelte.ts`. No UI, no risk.
3. **Primitives** — `Button`, `Badge`, `Eyebrow`, `Card`, `Spinner`, `EmptyState`, then `Field` +
   controls, then `Modal`.
4. **Patterns** — `ToastHost` and `PageHeader` first (highest use, lowest risk), then `DataTable`,
   `Tabs`, `FilterGroup`, `ConfirmDialog`, `Pagination`, `StatCard`, `SidebarNav`.
5. **Migrate pages**, newest first — schedule and custom-email are closest to the target and will
   surface API gaps cheaply. Then users, admissions, scan, settings, email-templates, dashboard,
   hacker portal.
6. **The `application-editor` island** — 1,943 lines and ~940 lines of scoped CSS, on its own. Own
   PR, reviewed visually.
7. **Sweep** — `npm run format`, delete the dead `UserTable.svelte`, grep for surviving `[#` and
   `-[` arbitrary values and drive it to zero.

A CI grep is worth adding at step 7 to keep rule 1 honest:

```bash
# fails if any .svelte file contains a hex literal or an arbitrary size value
! grep -rnE '#[0-9a-fA-F]{3,8}\b|(text|p[xytblr]?|m[xytblr]?|gap|w|h|max-h|min-h)-\[' \
    src --include='*.svelte'
```
