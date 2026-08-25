# Rejourney observability

[Rejourney](https://rejourney.co) is a lightweight session-replay and product-analytics
platform (open source, Apache-2.0, hosted in Germany / GDPR-compliant). One browser SDK
(`@rejourneyco/browser`, ~61 kB) gives us, with no further wiring:

- **Session replay** — rrweb-based recording of what the user actually saw and did
- **Route tracking** — automatic, via the History API, so SvelteKit client navigation is covered
- **Network capture** — every fetch/XHR with status and timing (tRPC calls included)
- **Error capture** — `window.onerror`, unhandled promise rejections, failed resource loads
- **Console capture** — browser console output attached to the session
- **User identity** — sessions tied to our `User.uid` so a bug report can be matched to a replay

## How it's wired in

Everything lives in three places:

| File                           | What it does                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `src/routes/+layout.svelte`    | Boots the SDK on mount via `startRejourneyOnMount` and syncs user identity in an `$effect` |
| `src/routes/+layout.server.ts` | Exposes `userId` (opaque cuid, not PII) and `userRole` to the client                       |
| `.env.example`                 | Documents `PUBLIC_REJOURNEY_KEY`                                                           |

The single switch is `PUBLIC_REJOURNEY_KEY`. Unset (local dev), the SDK never
initialises and adds nothing to the page. Set, the root layout initialises it once and
starts recording. Identity follows the session: `setUserIdentity(uid)` when signed in
(with a `role` metadata tag, so sessions filter by hacker vs. admin portal),
`clearUserIdentity()` when signed out. The SDK queues identity calls made before init
finishes, so there is no ordering hazard between the `$effect` and `onMount`.

## Privacy defaults

SDK defaults we are relying on (see `DEFAULT_WEB_CONFIG` in the package):

- `maskAllInputs: true` — keystrokes into password/email/tel/number inputs are masked in replay
- `ignoreBots: true`, `recordAutomation: false` — Playwright runs and crawlers don't record
- Elements can be excluded ad hoc: `rr-block` class or `data-rj-block` blocks an element
  entirely; `rr-mask` class or `data-rj-mask` masks its text

**Known tradeoff:** rendered page _text_ is not masked by default, so admin-portal
replays will contain applicant names/emails/answers as reviewers scroll them. If that is
not acceptable, the one-line fix is `observeOnly: true` in the `startRejourneyOnMount`
options — full analytics, no visual replay. Alternatively, sprinkle `data-rj-mask` on
the PII-bearing admin components.

## Turning it on (the deferred last step)

Nothing records until this is done — the code is inert without a key.

1. Register at <https://rejourney.co> (free tier, no card) and create a project.
2. Copy the `pk_live_…` public key from Project Settings.
3. **Add the site's domain(s) to Allowed Domains** in Project Settings — recording
   silently refuses to start without this.
4. Set `PUBLIC_REJOURNEY_KEY` in Vercel (production; preview too if wanted) and redeploy.
5. Verify: load the site, then check the session appears in the Rejourney dashboard.
   `Rejourney.getSessionId()` in the browser console should return an id.

## API surface for later use

Available anywhere client-side via `import { Rejourney } from '@rejourneyco/browser'`:

```ts
Rejourney.logEvent('application_submitted', { track: 'general' }); // custom funnel events
Rejourney.setMetadata('plan', 'premium');
Rejourney.setConsent({ replay: false }); // granular consent gating
Rejourney.getSessionId(); // attach to bug reports
```

No custom events are wired yet — auto-capture covers routes, clicks, network, and
errors. Add `logEvent` calls only where a funnel needs a named step.
