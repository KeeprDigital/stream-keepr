# Decisions

One section per settled architectural decision, numbered in the order taken; read the sections that touch an area before working in it, and surface a contradiction rather than silently overriding one. A new decision goes at the end under the next unused number — take it from `origin/main` at merge time, because parallel branches otherwise pick the same one. When a decision changes, edit its section to state what is now true and say in a line what changed; git history keeps the old text, so there are no separate superseded records. Numbers 0003, 0008 and 0013 were superseded and folded into ADR-0010 (0003, 0008) and ADR-0017 (0013); they are not reused.

## ADR-0001: Graphic Style Sets reference application fonts only

Accepted · 2026-08-01 · [#143](https://github.com/KeeprDigital/stream-keepr/issues/143) · Superseded 2026-10-28 by ADR-0049 and ADR-0050 · [#830](https://github.com/KeeprDigital/stream-keepr/issues/830)

**Fully superseded.** Graphic Style Sets and the `.skstyle` package are gone (#830), so nothing remains for this decision to govern. It kept a Style Set's typography entries to application fonts so `.skstyle` could stay data-only, with no asset pipeline. Themes replace Style Sets (ADR-0049), and a Theme's typography may name a library font (ADR-0050). A Graphic Item's own typography takes either arm of `GraphicFontSelection`, as before. What changed: the Style Set typography entry, its `GraphicApplicationFontSelection`-only wire schema and the `.skstyle` font refusals were deleted with Style Sets.

## ADR-0002: Concurrent Graphic Animation phases compose by nesting

Accepted · 2026-08-01 · [#110](https://github.com/KeeprDigital/stream-keepr/issues/110)

### Decision

A Broadcast Graphic projects an **ordered set of concurrent lifecycle phases** (`broadcastGraphicPhaseProjections`, `[]` when none), and the compositor composes their projected values rather than choosing one. The set is bounded at two and the pairing is structural: at most one _content_ phase (an update crossing its pair, or a cycling excursion), innermost, moving the rendering; and at most one _enter/exit_ phase, outermost, moving the result.

Each channel composes the way it means:

- **Fades multiply** — an element at `a` inside a parent at `b` contributes `a * b`.
- **Slides add** — both are canvas-space offsets applied outside the authored Graphic Rotation.
- **Scales apply in turn** — each keeps its own `translate(shift) scale(s)` pair in one transform list, outermost first. Two scales about different Graphic Animation Origins are a scale plus a translation, and folding them into one factor degenerates when the factors cancel.
- **Reveals intersect, on separate elements** — CSS allows one mask per element, so a second wipe gets an element of its own, sized to the owner's box so the gradient still resolves across the bounds it was authored across.

An enclosing element appears only for a second wipe, or for a phase that moves every rendering while an update moves them separately. A graphic in one phase resolves to exactly the descriptor it did before concurrency existed.

`cyclingStartedAt` is stored, and only on an intent that actually interrupted cycling in progress. Cycling's origin is otherwise derived (entrance settled, or last update completed), and an Out overwrites the record it is derived from — so an exit could not locate the cycle it runs over and would start from the Graphic Resting State, which is the snap. Like `reversalCompletesAt` and `updateStartedAt` it is an origin, read forwards and monotone in the reader's instant; nothing validates or clears it and it names no phase, so recovery still settles every graphic at its Graphic Resting State.

### Why

Exit interrupting an update, or interrupting on-screen cycling, is not a position on the enter/exit axis, so #70's reversal cannot express it — both are a second phase at the same instant. A single-phase projection forced the compositor to pick one, and every pick snapped.

The Key Output survives: its rule is that every painted element is pure white at its own alpha with no blend modes, and no filter but a glow's plain source-over drop shadow (ADR-0026). Composition uses no property beyond the `opacity`, `transform` and `mask-image` animation already used — nested opacity multiplies alpha, nested masks multiply alpha, a transform moves paint without changing it — so nothing new paints. The guard in `graphicsRenderModel.test.ts` walks the new elements.

### Consequences

- Every reader — both Screen Output hosts, Live Control, the Program monitor, the Graphic Animation Preview — speaks the set.
- The bound of two is load-bearing: it lets the compositor commit to one enclosing element. It is stated and tested in `broadcastGraphicPhaseProjections`; a third concurrent phase would need a third element first.
- An intent that takes over a phase in flight carries **both** concurrent schedules: a Take reversing an exit keeps the update crossing and the cycle, since dropping either snaps that channel to rest in the very frame the enter/exit channel was made smooth. An Out is the exception only for the update — it may carry a transition that never began, so the exit path decides whether an exit has one to run underneath. Cycling needs no adjudication (an origin in the future projects the resting state), so that path refreshes it and never strips it.
- A graphic leaving with a pending visual update discarded holds the rendering the interrupted update was travelling towards until it leaves. Snapping to the accepted set would be the discarded update happening anyway; the accepted values are what the next Take enters with.

### Rejected alternatives

- **A reveal as a second `clip-path`** — a Graphic Group already spends its one clip path on Shape Geometry clipping.
- **`mask-image` layers with `mask-composite: intersect`** — not uniformly available in the browsers outputs are captured in, and the default composite is a union, which fails open.
- **Folding two reveals into one gradient** — perpendicular wipes intersect to a rectangle no single `linear-gradient` expresses.
- **Applying the enclosing phase to each rendering** — an exit fade on each half of a cross-dissolve composites differently from the same fade on the pair.
- **A second compositor pass, or per-owner animation state** — either ends the property that makes late-loading outputs agree: every frame is a pure projection of one authoritative instant, with nothing accumulated between frames.

## ADR-0004: A Live Session notification carries the difference

Accepted · 2026-08-02 · [#168](https://github.com/KeeprDigital/stream-keepr/issues/168)

### Decision

`broadcastGraphicsLiveSession:commandApplied` carries **what the command changed**: the entries of `playout`, `inputs` and `sources` that differ, keyed by Broadcast Graphic id, `null` for a removal, measured against the live state the command was reduced onto. `BroadcastGraphicsLiveStateChange` is that description; `changedBroadcastGraphicsLiveState` applies it.

**When the difference does not fit, it is dropped and the peer reloads.** A payload over `MAX_REALTIME_MESSAGE_BYTES` (64 KiB) is published without its change, and a client given no change fetches the authoritative snapshot, as it already does for a sequence gap. The same applies to a notification the publisher cannot describe: a recognised command replay (answered with a snapshot possibly newer than the command) and a live state carrying a field this build does not recognise. That fallback bounds the message by construction — the part that scales with the show is the part that can be left out.

`MAX_GRAPHIC_INPUT_VALUE_LENGTH` is 1,200. It only has to exceed the 1,000-byte authored cap so an over-long value is storable and therefore showable as unavailable; the old 2,000 bought nothing and cost 96,000 bytes of worst case.

### Why

- **Not the whole live state**: at the sizes the authoring caps admit it reached 463,053 bytes, seven times the per-message limit, and failed silently because publication logs and swallows.
- **Not notification-plus-reload** (how #95 fixed `screen:updated`, per spec #60's "realtime is notification, snapshots are authority"): a Screen changes when an author saves, but live state changes on every accepted command, so that is a snapshot fetch per command per client. Worse, every output projects an animation phase from one authoritative start time, monotone in the current instant — an output that spends a round trip fetching joins the entrance part-played (a 500 ms enter fetched in 80 ms starts 16% in).
- **Not a whole Broadcast Graphic per change**: an Out changes a playout record of a few hundred bytes, but pairing it with the graphic's Graphic Input state made the worst-case Out fall back to a reload. Naming entries keeps it at 280 bytes.
- **Not finer than an entry**: naming values inside a Graphic Input state would buy one case (an edit to a graphic holding more than eleven fully loaded Graphic Inputs) at the cost of a second description with its own removal rules. Map entries are the granularity live state is keyed at, so no reducer can drift from it.

### Measured cost

Pinned in `test/unit/server/mappers/broadcastGraphicsCommandAppliedMeasurements.test.ts` against worst cases driven through the real reducer:

| case                                                             | whole live state | change      |
| ---------------------------------------------------------------- | ---------------- | ----------- |
| Out, worst case the caps admit                                   | 367,053 B        | **280 B**   |
| Set Input, realistic show (6 graphics, 8 inputs, 60-char values) | 7,906 B          | **1,355 B** |
| Out, realistic show                                              | 7,906 B          | **189 B**   |

Where the round trip is paid depends on the command. A **Graphic Input edit** carries the graphic's whole Graphic Input record: eleven fully loaded inputs fit (62,260 B), the twelfth falls back. A **Take** carries a playout record and that record: fourteen fit (64,670 B), the fifteenth falls back. An **Out** never falls back. So "zero round trips on the on-air path" holds for realistic shows, not every legal one — a Take on a graphic with fifteen fully loaded inputs (legal; the per-graphic cap is 24; roughly 80 KB of text) joins its entrance part-played. The dearest whole state (inputs spread across all fifty graphics) and the dearest single change (inputs concentrated on one) are different Screens, so the test asserts both arrangements.

### Consequences

- 64 KiB is the account's **confirmed** limit: the package is Free (#189, recorded beside the constant in `shared/types/messages.ts`). It was first adopted as the documented floor, on the reasoning that measuring against a floor can only cost an unneeded reload while an unestablished ceiling could cost a lost notification — re-apply that if the package changes.
- `realtime_publish_oversized` cannot fire for this message type.
- The sequenced live-state port's `publish` receives a publication context carrying the aggregate the command was reduced onto (absent on a recognised replay). Only that module knows which aggregate a merge retry re-reduced onto, and a difference measured against the wrong one would silently leave peers holding a state the store does not have.
- A client falls behind in two ways — a missed sequence, or a notification with no difference — and both resolve by reloading.
- Recovery validates `sources` as well as `playout` and `inputs`. `null` means "removed" in a change, which is sound only while no entry can itself be null; the description checks that rule rather than assuming it.

## ADR-0005: `static-font-v1`'s server-side checks are a floor; the browser is the gate

Accepted · 2026-08-02 · [#153](https://github.com/KeeprDigital/stream-keepr/issues/153)

### Decision

1. **`static-font-v1` rejects a cmap subtable declaring a non-zero `language` on any platform other than Macintosh**, with code `font-cmap-language-invalid`. It reads the parsed cmap, so it holds for TTF, OTF, WOFF and WOFF2 alike. On the Macintosh platform OpenType defines `language` as the Mac language ID plus one, so non-zero is correct there; the exemption is pinned twice — a unit test builds a Mac-language-only variant and requires acceptance, and the browser acceptance harness (`scripts/run-font-browser-acceptance.mjs`) serves that variant as a face that must load and render.
2. **The server-side checks are a floor, not the gate.** Acceptance requires browser evidence — `FontFace.load()` plus representative glyph rendering at server-selected code points, bound to the source and challenge digests — and `reportWithBrowserDecodeEvidence` refuses to publish a font without it.

### Why

`public/fonts/mplantin.ttf` passed every server-side check yet Chromium's sanitiser refused it, because its Microsoft-platform subtable declares `language` 1. The platform split was settled by experiment, restating each subtable independently and loading all four combinations in real Chromium: only a zero Microsoft-platform language loads, and the wrong `rangeShift` the sanitiser also logs does not matter.

A font sanitiser is a large, versioned, adversarially maintained program whose refusals track browser releases; reimplementing it means maintaining a second copy of someone else's moving contract and being wrong silently. The actual requirement is "this face loads and renders in the browser that shows it on air", and only a browser answers that — the same shape as silent-video validation (#38): where proof needs a runtime the validator is not, the validator bounds and describes the bytes and the runtime's evidence decides publication.

Server rules still earn a place because they fail earlier and more legibly: without one, the profile reports the font accepted and hands the author a glyph challenge their browser cannot answer. Each future rule needs a real observed defect, a cheap deterministic check and a stable code, and must be settled against a browser before it ships — the first version of this one read the sanitiser log's three severities as one rule and rejected fonts that load.

### Consequences

- `mplantin.ttf` is only a negative fixture; accepted-TTF fixtures use `mana.ttf`. It is removed from the `MPlantin` `@font-face` in `app/assets/css/main.css`, where it was an unreachable fallback that could only ever have produced the silent substitution #28 forbids; MPlantin renders from `mplantin.woff`.
- The harness proves both directions: `refusedFaces` in `public/_acceptance/static-font-v1.json` lists faces the profile rejects, and the run fails with `font-refused-face-loaded` if the browser loads one.
- The unreferenced `mplantin.eot`/`.svg` and `mana.eot`/`.svg` were left alone and not investigated.

## ADR-0006: Over-broad Graphic Style Set override pins are not migrated

Accepted · 2026-08-05, amended under #229 and #240 · [#199](https://github.com/KeeprDigital/stream-keepr/issues/199) (decided under #167) · Superseded 2026-10-28 by ADR-0049 · [#830](https://github.com/KeeprDigital/stream-keepr/issues/830)

**Fully superseded.** Graphic Style Sets are gone (#830), and with them the review flow, the recorded overrides and the pins this decision governed. A Graphic Item property now binds a whole Foundation Token or holds a literal, with no override record (ADR-0049). What changed: `heldGraphicStyleOverrides`, `recaptureGraphicStyleOverrides` and the bind and unbind edits were deleted. A stored or packaged document still carrying a `styleRefs` override record reads, and the record is dropped (ADR-0049).

## ADR-0007: The Broadcast Graphics Graphic Item cap is set from what a show needs, and the worst case is allowed not to fit

Accepted · 2026-08-01 · [#99](https://github.com/KeeprDigital/stream-keepr/issues/99) · Amended 2026-10-28: the worst case is re-measured without Style Set references · [#830](https://github.com/KeeprDigital/stream-keepr/issues/830)

### Decision

**`MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN = 300`** — Graphic Items on one Broadcast Graphics Screen in total, Graphic Group children included — **and the worst case is allowed not to fit** the 512 KiB `modeConfigs` budget shared by every Screen Mode. The cap exists because the per-list caps multiply to 50 Broadcast Graphics × 100 Graphic Items × 50 Graphic Group children = 255,000 items. It had been repriced three times by three tickets, each measuring only its own vocabulary; it is now set once, here, from one composed measurement, and no feature ticket picks the number.

**300 = `MAX_BROADCAST_GRAPHICS_PER_SCREEN` (50) × 6**, the Graphic Items in the richest reconstruction of the fidelity acceptance set. The prototype document that set came from is no longer in the repository; this table is its surviving record:

| reconstruction                              | Graphic Items                                                 |
| ------------------------------------------- | ------------------------------------------------------------- |
| Split angular commentator lower-third       | 6 (two shape beds, two accent rules, two text items)          |
| Full-width animated commentator lower-third | ~6 (media bed, rules/decorations, two text items, brand item) |
| Full-screen branded slate                   | 4 (three image items, one text item)                          |
| Derived persistent brand bug                | 2–3 (shape bed, brand image, optional text)                   |

A realistic Screen filled to the cap measures 248,734 bytes, 47% of the shared budget.

Three axes that were unbounded relative to their own meaning were narrowed, at no cost to realistic authoring:

1. **A Graphic Animation Stagger** names no more ids than its container has direct items (it was 100 regardless) — about 2 MB off the worst case, which no item cap could reach. Stale ids stay legal (the count is bounded, membership is not); `deleteGraphicItem` and the template copy path remove deleted ids.
2. **`MAX_GRAPHIC_ITEM_ID_LENGTH = 64`** (was 100; the app writes 36-character uuids), also for stagger ids.
3. **A Feature Match Layout's** item cap now bounds its total including group children, not only its top-level list (which admitted 5,100 items into the same budget).

### Why

The worst case populates every construct `broadcastGraphicsModeConfigSchema` admits at its own maximum — all seven Graphic Item types including groups, maximal-length ids, a Theme binding in every slot, animation and staggers on items, groups and shells, every Graphic Input, binding, Graphic Source Selection and Graphic Channel slot. It cost **11,876 bytes per Graphic Item on 288,564 bytes of fixed shell cost**, reaching 3,851,414 bytes at 300, while Graphic Style Sets existed. #830 removed them, and with them a Style Set reference in every slot and a link on every Broadcast Graphic: 6,130 bytes per maximal Graphic Item and 1,734 per Broadcast Graphic. #831 added a `media` binding slot: 15 bytes per maximal Graphic Item. The worst case is now 1,930,214 bytes at 300, with no construct left unpopulated: the Style Set link's unbounded `revision` was the one exception the measurement had to name. (#829 added a Theme binding in every slot: 433 bytes per maximal Graphic Item and 120 per Broadcast Graphic. The lowering-the-cap figures below were not re-measured for it, nor for #830 or #831, so they understate the cap that now fits.) (#539 widened a Graphic Placeholder Style's font weight to 1–1000 and populated every font weight at 1000, which base typography and its override already admitted: 6 bytes more per maximal Text Graphic Item. The lowering-the-cap figures below predate that and were not re-measured; at 6 bytes an item they move by at most 132, which leaves 21 as the cap that fits.)

- **Lowering the cap until it fits** gives 21 (521,272 bytes; 22 is 532,755). That clears the 19-item acceptance set, but the objection is volume: it would leave most of a Screen's 50 Broadcast Graphics unable to carry a single item, while the spec asks for commentator and player lower thirds, slates and brand bugs concurrently.
- **Narrowing further cannot close it.** At 300 the budget left after fixed cost is 241,724 bytes, 806 per item, and `MAX_GRAPHIC_TEXT_LENGTH` is 1,000 — a maximal text template alone overshoots before anything else is counted. Removing the largest axis, a Style Set reference in every slot, took 6,130 bytes an item (#830) and was not enough. Only cutting vocabulary the spec settles would be.
- **The overshoot is safe** because the byte total is enforced on the editors' write path (#85), refusing an oversized configuration legibly at authoring time, and because realtime no longer publishes mode configurations (#95), so anything storable is notifiable. The live-session message is keyed by graphic and input, never by item, so this cap does not touch it (ADR-0004).

What is given up is "the named cap binds first", only for configurations nobody authors: they read a byte count instead of a limit name. One non-pathological shape crosses the line — a Screen at the cap where every item carries a 1,000-character template (300,000 characters) is refused by byte count.

### Consequences

- The measurement is pinned with `toBe` in `broadcastGraphicsModeConfigWorstCase.test.ts` in two arrangements — grouped (1,930,214, `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES`) and flat (1,927,576) — so "which worst case" stays a checked choice.
- A ticket that adds vocabulary extends that builder and moves a visible constant. Moving the cap means re-deriving it here, not in a docblock.
- `MAX_GRAPHIC_ITEM_ID_LENGTH` is also an import constraint: a Template Package document is proved against the Screen write-path schema, so ids over 64 characters are refused on install. Accepted — one bound on both paths keeps "a document that installs is one the write path accepts", and copy paths mint fresh uuids anyway.
- `MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN` (60) binds first for any package whose graphics declare Live Control (two inputs each covers 30 of 50 graphics). Move that before this cap, and re-measure when you do.
- Making the worst case fit means cutting `MAX_GRAPHIC_TEXT_LENGTH` — a question about what an author may express, not a budget question.

## ADR-0009: The current page of a Page Rotation is a clock projection, not persisted state

Accepted · 2026-08-12 · [#312](https://github.com/KeeprDigital/stream-keepr/issues/312)

### Decision

The current page of a paginated Screen Mode (standings, metagame, most played cards, player history, pairings, archetype spotlight) is a **pure projection of (Rotation Anchor, page duration, page count, server time)**, computed identically by every rendering — Screen Output, Program monitor, operator settings — from one shared function in `shared/modules/page-rotation/`. Nothing writes as the rotation runs; a rendering re-evaluates exactly at each flip boundary.

- **Only operator surfaces write `rotationAnchor`**, on three occasions: enabling auto-page; an edit that changes the rotation's shape (page duration, page size, a display reset restoring them; decided once by `pageRotationEdit`, ADR-0039); and a manual page selection while rotating, written so the chosen page is current for one full duration. It rides the existing config write and `screen:updated` announcement.
- **A missing anchor projects from epoch zero**, still deterministic, so older configs rotate without migration.
- **An unsynced rendering shows the first page statically** — never project on an unknown clock. With auto-page off, the persisted `currentPage` is the manually selected page.

### Why

Every rendering used to run a timer that persisted the next page. A freshly opened output could not persist at all and silently stalled; two renderings of one Screen (a fill/key pair, a redundant machine) each advanced the page, at double rate. Every tick cost a realtime fan-out plus a Screen re-fetch by every client (the pattern ADR-0004 rejects), and outputs writing contradicted the invariant that a Screen Output only enters presence and answers commands, which race-safety arguments in the code rely on. Synchronisation instead falls out of the shared RTT-compensated clock (`useServerTime`), the way outputs already agree on animation phases, and paging continues through a realtime outage.

### Consequences

- Screen Outputs are pure consumers again; the paging persist was the only output-originated server write.
- Flips land within clock-sync tolerance across renderings (tens of milliseconds); frame-atomic flips across independent browsers were never achievable.
- When the row set changes mid-rotation the projected page can jump, identically everywhere. Nothing re-anchors on data changes — determinism, not continuity, is the invariant.
- The metagame toggle is the canonical `autoPageEnabled` (a pre-ship data migration rewrote stored blobs; squashed by ADR-0019).

### Rejected alternatives

- **An elected writer** (first output in presence, or the server) running the timer — fixes stall and double-advance but keeps leader election and failover mid-show, per-tick fan-out and re-fetch traffic, and outputs that write.

## ADR-0010: Authentication replaces the anonymous author session

Accepted · 2026-08-17, cutover landed on [#398](https://github.com/KeeprDigital/stream-keepr/issues/398) · [#383](https://github.com/KeeprDigital/stream-keepr/issues/383) (decisions #384–#391). Replaces the former ADR-0003 (ingestion ownership by anonymous session) and ADR-0008 (no authentication boundary, perimeter trust).

Before this, the installation had no login: a self-issued, anonymous Graphics Author Session was minted on any HTML page load and owned Graphics Ingestion Operations, so every guard resting on it was attribution rather than authentication, and the network perimeter was the only boundary. Constraints for its replacement: single-tenant, a small invited team, email/password only, admin-created accounts with no self-signup, and a library that leaves OAuth, passkeys and roles open for later. Roles and permissions, a Screen Output Asset Capability redesign, and multi-tenancy are out of scope.

### Decision

**Library: Better Auth, sessions in D1** through the first-party Drizzle adapter, so its tables generate into `server/db/migrations/sqlite/` as the single migration history.

- Minimal plugin surface: email/password with `disableSignUp: true`, plus the admin plugin (admin-created accounts, `setUserPassword`, banning). Stay off the SSO/OIDC/SCIM/OAuth-provider plugins, where the June 2026 advisory cluster lived.
- The `no_nodejs_compat_v2` pin stays: Better Auth reaches native `node:crypto` scrypt via the `workerd` export condition in `@better-auth/utils`, which depends on the bundler resolving that condition — `scripts/assert-native-scrypt.mjs` guards it.
- No email sender: an invite is an admin-created account plus a single-use, expiring password-reset link handed over out of band; resets work the same way.
- Exact version pins; read release notes on every bump.

**The user replaces the Graphics Author Session**, rather than layering on it. Better Auth's per-browser, sliding, server-side, revocable D1 session and its user are the only identities.

- **Operation ownership belongs to the person.** `initiatedBy` on Graphics Ingestion Operations is the userId. Ownership is what bounds who can read an operation's unpublished staged bytes (`GET .../staged-source`), so it must bind to an identity that means something. An operation paused overnight at `awaiting-confirmation` survives its browser and resumes from any machine where that user signs in. The idempotency scope `(initiatedBy, idempotencyKey)` is per person: the same key from two browsers dedupes to one operation, intentionally.
- **The lease holder stays browser-scoped.** Leases guard concurrent editors, and one person in two browsers is two editors; `holderSessionId` carries the Better Auth session id, and takeover UI resolves session → user for display.
- **The Evidence Ledger actor is the userId**, display name resolved at read time so it survives renames. Anonymous-era rows keep their opaque actor, which accurately records that era; admin-token entries keep their actor spelling.
- **Session policy: Better Auth defaults, `expiresIn` 7 days, `updateAge` 1 day.** An idle-sliding window (measured from last use, not issue) is the right shape, and nothing now argues for a short one: a lapse no longer destroys ownership of work, D1 has no per-key write cap, and a mid-show forced re-login is the costliest failure this product can buy. The abandoned-shared-machine risk is answered by admin session revocation and banning.
- **The Graphics Administrator shared token (`x-graphics-admin-token`) is untouched** — the admin credential until a roles effort redraws that seam.

**Deny-by-default over `/api/**`.** `server/middleware/api-session.ts` requires a session on every `/api/**` route that `apiPathRequiresSession` (`server/utils/apiBoundary.ts`) does not exempt, so a new route is private until consciously allowlisted. The exempt surface, exhaustively: `/api/auth/**`; `/api/time` (output drift correction); `/api/realtime/token` (scoped below); `/api/screen-output/**` (capability-authorised); `/api/bootstrap/ensure-admin`; `/api/admin/**`; `/api/public/**` (ADR-0055); and the SPA shell and static assets, unavoidably public under `ssr: false`.

- **The Screen-by-slug bootstrap route lives at `/api/screen-output/events/:id/screens/slug/:slug`** and accepts either the Screen Output Asset Capability bearer from the output page's URL hash or a session. The session arm exists for editor previews (`embed=preview`), which deliberately resolve media as the author with no capability; it adds no reach, since any signed-in user can read the same Screen elsewhere and `mapScreenToResponse` strips the capability digest either way. Minting capabilities for previews would contradict that design, and a second session-only route for the same resource would make a repository choose a path by credential.
- **Realtime token: dual grant, no anonymous issuance.** A user gets the event channel plus all screen channels (subscribe, history, presence) with `clientId` = userId. A capability bearer gets that screen's channels plus its event channel, with a screen-output `clientId`. Screen Outputs need no account — the capability already in hand is their credential.
- **`/api/admin/**` is exempt from the session check**, not unguarded: every route there calls `requireGraphicsAdministrator`.
- **Refusal shape**: a missing session inside the boundary is one uniform **401**. The capability surface keeps its 404-never-401/403 posture. The screen-command route's 401 is a legitimate entry in `SCREEN_COMMAND_ROUTE_REFUSALS`. Pages are gated client-side only (`app/middleware/auth.global.ts`), which is UX; the API boundary is the wall.

**First-admin bootstrap is a secret-armed endpoint.** `/api/bootstrap/ensure-admin` is active only while `NUXT_ADMIN_BOOTSTRAP_TOKEN` is set; blank, it answers the 503 `ServiceConfigurationError` naming the variable, like `NUXT_GRAPHICS_ADMIN_TOKEN`. It has ensure semantics — a new email creates an admin, an existing one gets the given password and admin role — through Better Auth's server-side admin API, so rows are always Better Auth-shaped and repeats create no junk. One mechanism covers install #1 and break-glass lockout, which with no email sender would otherwise mean hand-editing D1 and orphaning `initiatedBy` and Evidence Ledger references. The ceremony is curl-only and in the README: set the secret, curl, delete the secret. Local development arms it from `.env`, so the path is exercised constantly.

**Cutover was drain-first, with no migration code.** In-flight anonymous operations drained; leftovers are reclaimed by the 24-hour retention sweep, and orphaned rows stay (a sentinel rewrite could collide on the `(initiated_by, idempotency_key)` unique index and would falsify the record). `server/middleware/retired-author-session-cookies.ts` expires the two old cookies with `maxAge: 0`.

### Consequences

- **Known wart:** admin retry (`admin/graphics-assets/ingestion-operations/[operationId]/retry.post.ts`) can revive an anonymous-era orphan, which stalls at any author-scoped step — its `initiatedBy` can never match — and re-expires under the sweep. Harmless and self-healing; the cockpit shows an "anonymous era" fallback where an initiator resolves to no user.
- A new 401 inside the boundary trips the `test/helpers/routeRefusalScan.ts` census; each is legitimised deliberately, never blanket-silenced.
- Guards are the seams a credential attaches to; describe session-scoping or attribution as such, not as authentication.

### Rejected alternatives

- **nuxt-auth-utils** — a toolkit: users, invites, reset and revocation all hand-built, and its sealed-cookie session is a fixed window with no revocation — the mid-upload-expiry shape this design exists to avoid. **@sidebase/nuxt-auth** is not credible on Workers; **Lucia** is deprecated.
- **Layering the credential on the author session** — two identity spaces to keep consistent.
- **A longer-lived anonymous identity** (a device cookie) instead of a person — buys a longer window, not durable ownership (a cleared cookie, another machine, a second browser all still lose it), and is a longer-lived grant to read unpublished staged bytes.
- **KV-backed auth sessions** — Workers KV rate-limits writes to a single key to about one per second, which a resumable transfer sending concurrent parts would hit.
- **Migration or adoption tooling for anonymous-era work** — drain plus retention reclaims what a sweep can; the rest is accurately recorded as anonymous.
- **Guard-by-guard protection** — fails open on every route someone forgets, as it did for all 96 `events/**` routes including the on-air screen command route. Deny-by-default fails closed.
- **A stopgap boundary** (a shared token) ahead of this design — would have hardened the wrong seam.

## ADR-0011: Social Profile Rotation projects into ordinary Graphic Items

Accepted · 2026-08-18 · [#416](https://github.com/KeeprDigital/stream-keepr/issues/416)

### Decision

A rotating Talent identity is a named **Social Profile Projection**, not an opaque all-in-one Graphic Item or a collection-valued Graphic Input. The projection references a Talent Graphic Source Selection, atomically supplies read-only network and profile values, and transitions one explicitly associated Social Profile Presentation Group, whose ordinary Text, Social Network Icon and decorative Graphic Items keep the compositor's layout, styling, animation and Theme binding capabilities.

Rotation is a pure projection of authoritative Broadcast Graphics Live Session state, the accepted populated profile set, and synchronised server time (as ADR-0009). Operator actions write the projection's selection, automatic mode and rotation anchor; Screen Outputs never write as it advances. A rendering without trustworthy synchronised time holds its last accepted or anchored profile rather than blanking or writing. An accepted profile-set change preserves and re-anchors the current network when it still exists, so adding a profile cannot make program jump because catalogue indexes moved. The Feature Match Overlay is out of scope.

### Rejected alternatives

- **An opaque Social Profile Graphic Item** — duplicates a weaker subset of Text Item, Graphic Group and styling controls in a bespoke widget.
- **A collection-valued Graphic Input** — puts collection and clock behaviour into the scalar binding catalogue, which deliberately excludes it, and still yields no independently styled icon and text consumers.
- **Timer-driven accepted-value updates** — a write per profile change, competing outputs or a writer election, and the loss of ADR-0009's output purity.

## ADR-0012: Environment-dependent library behaviour is stated, tested, or recorded

Accepted · 2026-08-20, census refreshed for 1.7.7 under #621 · [#438](https://github.com/KeeprDigital/stream-keepr/issues/438); secure-cookie prefix amended under [#451](https://github.com/KeeprDigital/stream-keepr/issues/451); rate limiter amended under [#697](https://github.com/KeeprDigital/stream-keepr/issues/697)

### Decision

Every test runs against libraries told they are under test: Vitest sets `NODE_ENV ??= 'test'`, `@nuxt/test-utils` never forces `production` here, and `@better-auth/core` captures `NODE_ENV` into a module constant at import, so nothing in-process can un-see it. Better Auth's origin check being off under test let a defect only a built Worker refused ship (#410, #397). For each site where the environment decides behaviour, in order of preference:

1. **State the option** when one value is right in every environment, taking the decision away from `NODE_ENV`.
2. **Construct the library under an environment the test controls** when no option exists — given the frozen constant, a child process.
3. **Record the blindness with its reason** when neither is worth its cost.

**The suite's `NODE_ENV` is not globally overridden.** It would change everything at once in a suite that has never run under another setting; stating options is reversible per site.

### The census

A grep of the pinned `better-auth`, `@better-auth/core` and `@better-auth/telemetry` dists for `isTest`, `isDevelopment`, `isProduction` and `NODE_ENV`. First taken at 1.6.29; re-run on 2026-10-21 at 1.7.7, the version `package.json` pins, which found the same sites plus the client store row. It did not audit Nitro, h3, Nuxt, Drizzle, Ably or anything else — a floor, not a ceiling. Stated options live in `server/utils/authOptions.ts`, each with its reason.

| Site                                                 | Under test                                                                  | Decision                                                                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin check defaults off                            | CSRF defence disabled                                                       | **Stated**: `advanced.disableOriginCheck: false` (#410)                                                                                                                 |
| `validateSecret` returns early                       | Weak or default secrets admitted silently                                   | **Tested**: `test/unit/server/utils/authSecretValidation.test.ts` constructs the library in a child process with `NODE_ENV=production`                                  |
| `rateLimit.enabled ?? isProduction`                  | Rate limiter off; so was the built Worker's (#697)                          | **Stated**: `rateLimit: { enabled: import.meta.dev !== true, storage: 'database' }` — on, counted in D1, on every built server; off on `nuxt dev` (#697)                |
| Client IP: header walk, then loopback under test/dev | Caller-writable `x-forwarded-for` read; header-less callers all `127.0.0.1` | **Split**: header stated as `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']`, pinned by `test/unit/server/utils/authClientIp.test.ts`; loopback **accepted** |
| Secure-cookie prefix falls back to `isProduction`    | Cookies unprefixed; so was the built Worker's, without `Secure` (#621)      | **Stated**: `advanced.useSecureCookies: import.meta.dev !== true` — `Secure` and `__Secure-` on every built server, neither on `nuxt dev` (#451)                        |
| Telemetry publishes only when `!isTest()`            | Suppressed                                                                  | **Stated**: `telemetry.enabled: false`                                                                                                                                  |
| `/error` page blanked in production                  | Suite sees a dev page                                                       | **Accepted blindness** — response shape only                                                                                                                            |
| Dev-only log lines                                   | Log output differs                                                          | **No action**                                                                                                                                                           |
| Vue client store readonly and devtools-registered    | Client session state is a readonly ref outside production                   | **No action** — client-side only                                                                                                                                        |

### Why the blindnesses are accepted

- **Loopback for header-less callers** is inside the library past every option; nothing keyed on client IP is distinguishable locally. The last case in `authClientIp.test.ts` pins the residual and fails if a bump changes it.
- **Blanked error page**: cosmetic; nothing about admission rides on it.

### Why the secure-cookie prefix is stated after all

It was accepted as a blindness on the premise that the fallback gave production `__Secure-` cookies. It did not: `isProduction` is `NODE_ENV` read at module load, nothing sets `NODE_ENV` in the Worker, and the built Worker under local workerd set an unprefixed `better-auth.session_token` without `Secure` (measured on #621). Stating it restores the premise; it is not a new cookie policy.

- **The value follows the kind of server, not the request.** No option means "secure exactly when the request is https", and the instance is built once. `import.meta.dev` is the build's own answer: Nitro replaces it with a literal (`false` in a build), so the uploaded artifact's value is a constant in its code. Anything not a Nitro dev build, the unit suite included, gets production's cookie.
- **This contradicts the earlier reasoning that `useSecureCookies` would be wrong on one side.** That held for a constant. `nuxt dev`, where people sign in over `http://localhost` every day, keeps the unprefixed, non-`Secure` cookie it always had, so a browser that does not count loopback as secure for cookies (WebKit has not, historically) still signs in there. What ships is the built artifact, so it alone is held to production's cookie, `pnpm preview` included; Chromium keeps a `Secure` cookie on loopback (measured with the acceptance browser).
- **Rejected**: `NODE_ENV=production` in the Worker build flips every `isProduction` site in the census at once, the rate limiter among them, to fix one. A Worker var is a deploy setting that a forgotten value silently undoes.
- **Observed**: `pnpm worker:smoke` refuses a built Worker whose session cookie is not `__Secure-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`; `test/unit/server/utils/authSessionCookie.test.ts` holds the server's options to it over `http://`; `test/integration/auth.test.ts` pins the dev server's unprefixed cookie. The deployed origin is still #451's to observe.
- **On deploy, signed-in browsers sign in once more.** Better Auth's session read uses only the name it is configured with, so a leftover unprefixed cookie admits nothing and refuses nothing; its D1 Session lapses under the ordinary 7-day expiry.

### Why the rate limiter is stated after all

It was accepted as a blindness on the premise that production's limiter was on. It was not: `enabled` falls back to `isProduction`, and nothing sets `NODE_ENV` in the Worker. The pinned library, constructed with these options and no `NODE_ENV`, reported `enabled: false`, and the built Worker under local workerd answered a client's fourth sign-in within ten seconds 401 rather than 429 (measured on #697).

- **The same split as the cookie, for the same reason.** On in every built server, `pnpm preview` included, and in the unit suite; off under `nuxt dev`. The old objection to `true` still holds for the dev server: every header-less caller there is one loopback client, and the integration and local-auth suites, like anyone signing in by hand, would share one three-attempt bucket. The unit suite takes production's limiter without that flake because each throwaway instance has its own database, so its buckets are per test.
- **Counted in D1 (`storage: 'database'`), not memory.** The default store is a module-level map, which on Workers is per isolate: a client whose requests land on several isolates gets each one's allowance, and an evicted isolate forgets. D1 has one primary, so a client has one count for the installation. The cost is a `rateLimit` table (migration `0001_since_v1_5_0`) and a read and a conditional write on every request to Better Auth's HTTP handler: sign-in, sign-out and the browser app's `get-session`. The server-side `getSession` every `/api/**` request makes does not pass through the limiter, so ordinary API traffic pays nothing. For a small team that is cheap.
- **The limits are the library's**: sign-in three per client per 10 seconds, reset requests three per 60, everything else 100 per 10. The options do not restate them; the tests below assume the sign-in rule and fail if a bump changes it.
- **Rejected**: the memory store (above); KV `secondaryStorage`, which is eventually consistent and caps writes to one key at about one per second (ADR-0010's reason against KV sessions); the Workers Rate Limiting binding as `customStorage`, which counts per location and fixes one limit and period per binding, so each of the library's rules would need its own. Revisit the binding if the D1 queries show up in cost or latency.
- **Observed**: `pnpm worker:smoke` sends three wrong-password sign-ins from one generated `cf-connecting-ip`, each with a different `x-forwarded-for`, and requires a 429 with `X-Retry-After` on the fourth. A sign-in from a second generated address must then succeed, and the probes after it, which send no client header, must still sign in. `test/unit/server/utils/authRateLimit.test.ts` pins the same in process, and that the count is shared through one database and not across two. `test/integration/auth.test.ts` pins that the dev server does not limit.
- **Residual**: a built Worker reached with no `cf-connecting-ip` puts every such caller in one bucket. A deployment always has the header, because Cloudflare sets it. Locally that is `pnpm preview`, where a fourth sign-in within ten seconds is refused.

### Consequences

- A Better Auth bump has four tripwires: `authSecretValidation.test.ts`, `authClientIp.test.ts`, `authSessionCookie.test.ts` and `authRateLimit.test.ts`. Re-run the census (same grep) when an audited package moves majorly; the table is version-pinned, not evergreen.
- Sessions record the Cloudflare-vouched client IP, not whatever `x-forwarded-for` said, and the limiter's key survives a caller sending their own forwarding header.
- Anyone noticing the loopback collapse should land here before building a workaround.

## ADR-0014: Animation Effects are rebuilt in-house on three.js

Accepted · 2026-08-23, amended under #621 · [#473](https://github.com/KeeprDigital/stream-keepr/issues/473)

### Decision

Animation Effects are built in-house behind a typed, **host-agnostic** contract (`create/setParams/resize/render(t)/dispose`) with per-effect configuration, in `app/utils/animation-effects/`. The nine effects of the vendored, `@ts-nocheck` Vanta.js fork were ported under their existing names and the fork is gone; the vocabulary is `ANIMATION_EFFECT_VALUES` in `shared/animationEffects.ts`. Rendering stays on three.js: five of the original nine are mesh-based (waves, rings, dots, net, globe) and three.js was already a dependency. Shader-only effects use a fullscreen `ShaderMaterial` base; a Canvas2D backend remains possible under the same contract. Effects animate autonomously from elapsed time — the fork's synthetic mouse drift, needed to move on a headless browser source, is retired.

Three hosts use the renderer: the Feature Match Overlay Frame, an Animation Effect Background Layer (in the Background Screen's stack, ADR-0016, and every plain overlay mode's), and the Broadcast Graphics Background, so the renderer must not assume any of them.

### Consequences

- Effect names are a closed vocabulary pinned by the Feature Match Layout format version, so Template Packages and stored configs keep resolving. Per-effect config changed what a `frame.animation` capability payload carries without a format-version bump — no payload half-parses under the wrong shape: a new-shape payload fails an older installation's strict schema; a pre-rebuild bag (recognised by its `mouseDrift*` fields) resets to no animation; and a package declaring an effect this installation does not ship is refused at capability preflight. A bump would also have refused older packages carrying no animation at all; the reasoning sits beside `FEATURE_MATCH_LAYOUT_FORMAT_VERSION`.
- Saved frame-animation settings from before the rebuild reset rather than migrate (small install base).
- Since #831 a layout's `frame.animation` holds only whether the effect shows and at what opacity. The effect and its params are the Theme's `feature-match-overlay.frame-animation-effect` Mode Token, so a stored or packaged effect is dropped when read and a layout declares no effect capability. The effect identities stay recognised.

### Rejected alternatives

- **Extend the Vanta fork** — untyped, mouse-driven motion, and a flat config whose parameter ranges already diverged across three copies (Zod, runtime clamp, editor).
- **A hand-rolled WebGL2 fragment harness** — cannot host the mesh-based effects, forcing a second GL stack beside three.js.
- **An offline WebCodecs → looping-video pipeline** — effects render live in the OBS browser source with no replay, so loop-seamlessness and determinism machinery buys nothing.

## ADR-0015: Live overlay show/hide rides feature-match session state

Accepted · 2026-08-24, amended under #621 · [#486](https://github.com/KeeprDigital/stream-keepr/issues/486) (decided under spec #485 / #479, #480, #481)

### Decision

Revealing or hiding a player's sideboard on the Feature Match Overlay is **live match data**: a per-player `sideboardRevealed` boolean in `FeatureMatchState`, set by a `SetSideboardRevealed` session command, read by the deck-list Graphic Item through `GraphicsFeatureMatchContext` exactly as `player-life` reads life totals.

### Why

An operator needs a sub-second toggle from the control surface between games. Writing the item's `visible` through graphics config is compositor-only UI, ~600 ms of stacked debounce plus announce-then-refetch, and would turn an authoring field into an operator gesture. The live flag preserves the Graphic Item invariant that items are not taken on or off air independently of their composition: the item stays on air and a hidden sideboard renders nothing, like an absent life total or empty sideboard. The Feature Match Overlay's Host Contract declares no Graphic Inputs, so Broadcast Graphics Live Control was not a carrier.

### Consequences

- The authored `visible` field ANDs with the live flag; the flag cannot resurrect an item its author hid.
- Show/hide motion reuses the item's authored `enter`/`exit` Graphic Animation Recipes; the flag edge is a small, reusable per-item phase trigger in the overlay host.
- That trigger is timed host-locally, the one exception to every output projecting a phase from one authoritative effective start time: each output starts the recipe on its own clock when it observes the edge, so outputs agree within realtime skew, and one disconnected across the flip plays it late on Reconnect Resync. The recipes are sub-second and the Host Contract carries no animation timing (#480), so this was accepted rather than designed around; changing it is product work.
- A host without the Feature Match context (Broadcast Graphics) treats the item as revealed; visibility there stays an authoring concern.

### Rejected alternatives

- **Graphics config `visible`** — see _Why_.
- **Broadcast Graphics Live Control, or a new bespoke live-control channel** — the overlay's Host Contract deliberately declares no Graphic Inputs, and session state already carries the match data the item reads.

## ADR-0016: One polymorphic Background Screen replaces Idle

Accepted · 2026-08-24 · [#473](https://github.com/KeeprDigital/stream-keepr/issues/473)

### Decision

The Idle Screen Mode, which carried one optional video background, is renamed **`background`** and configured as an ordered layer stack: `layers: BackgroundLayer[]`, painter's order (first is bottom), operator-reorderable, with five layer types — `color`, `gradient`, `image`, `video`, `animation` — each owning its own enabled state and opacity.

### Why

What a show wants behind everything else is a composition — a colour wash over an Animation Effect, a plate under a gradient — not a choice of exactly one background kind.

### Consequences

- The mode key renamed end to end: `SCREEN_MODE_VALUES`, registries, component directories, the D1 `screens.current_mode` default, and stored rows (a pre-ship data migration, squashed by ADR-0019). OBS URLs address Screens by slug, so nothing external broke.
- The old `mediaBackground` configuration reset rather than mapping onto a video layer (small install base, as ADR-0014). New Background Screens start empty: black until configured. Since #825 an empty stack, the Background Screen's or a plain mode's, paints the Theme's `background` Foundation Token instead, itself a Background Layer stack; the Default Theme's is empty, so the black stays. A Theme's media layers take a Remote Media URL only until a Theme can own a Graphic Asset Reference (#828).
- **At most one animation layer per Screen**, enforced on the `layers` field in the schema: each is its own WebGL context and an OBS browser source is memory-tight. Liftable.
- Opacity belongs to the layer, never to the stack or the renderer behind it.
- Image and video layers take a Screen Media Source — a Graphics Asset Library reference or a Remote Media URL — whose reach ADR-0021 sets. Asset-sourced layers join Graphic Asset Reference indexing under the `layers.` owner-slot namespace; a plain overlay mode's own stack indexes under `<mode>.backgroundLayers.` (#580).
- Which modes carry their own stack is declared once, on the Screen Mode Definition (`backgroundLayers: true`). The config field and its validation, reset preservation, the editor card, the painting, and reference indexing all derive from that declaration. Every plain overlay mode declares it, Most Played Cards included.

### Rejected alternatives

- **Per-type Screen Modes, or `animation` joining a background type union** — exactly one kind shows at a time, so a translucent colour over an animation is unreachable, and every new kind is a new mode or union arm with its own editor.

## ADR-0017: The local auth bypass is one launcher-owned name

Accepted · 2026-08-25 · [#519](https://github.com/KeeprDigital/stream-keepr/issues/519). Replaces the former ADR-0013; launcher list extended by ADR-0018.

### Decision

**`STREAM_KEEPR_LOCAL_AUTH_BYPASS=true` activates the Local Developer Session, and nothing else does.** It is set only on the command line of the `package.json` scripts ending in `:bypass` (`dev:bypass`, `dev:local:bypass`, `preview:bypass`); `.env` does not carry it and `.env.example` does not name it. It is deliberately not `NUXT_`-prefixed: no `runtimeConfig` key answers to it, and the prefix would advertise membership of the family `.env` holds — the one file it must never be in.

- **No build-time refusal.** A build has no opinion about local authentication.
- **The generated-configuration scan stays**: `pnpm worker:dry-run` (`build/localAuthDeployment.ts`) refuses generated Wrangler configuration containing the name anywhere, including named environment branches. It reads deployment output, not the environment a command ran in, so it cannot refuse a build, a suite or a bypassed launcher.

### Why

Activation used to take two values: `NUXT_LOCAL_AUTH_BYPASS` in `.env` plus `STREAM_KEEPR_LOCAL_RUNTIME` from supported launchers, so that a leaked, copied or bulk-uploaded `.env` was inert alone. It cost more than it protected: the build refused any non-dev build seeing the armed `.env` name, so a developer using the bypass could not run `pnpm build` and therefore not `pnpm verify`; the refusal had already needed a carve-out for `nuxt prepare` (#504); `pnpm preview` blanked the name to get past it; and two names kept implying one had to be set for a build or suite to pass.

1. **One name in no file is safer than the pair.** The second value existed to keep a file's value inert; a value never written to a file has nothing to carry between worktrees, into a secret store, or into a commit. Structural, not a policy to remember.
2. **The build refusal guarded nothing the artifact could carry.** Measured: the generated `.output/server/wrangler.json` declares no `vars`; the bundle reads the name from the Worker environment at request time; and `pnpm deploy` runs `pnpm build`, which wipes `.output`, before uploading, so nothing a preview stages survives into a deploy. Every smoke run re-measures it: the production artifact answers 401 by default (the `api-boundary` probe) and admits the Local Developer Session only when the name is in its environment.
3. **Its cost fell entirely on correct use** — it never fired on an attack or accident, only on developers running the mandated pre-push gate.

### Residual

Setting the name on a deployed Worker activates the bypass, and no runtime signal guards against it. Accepted as capability equivalence, not a likelihood bet: editing Worker vars or secrets needs the same Workers Scripts edit permission as deploying code, and either ships a new Worker version, so anyone able to stage this can already deploy an arbitrary Worker. The dry-run scan is the defence against the _accidental_ case and must not be weakened on the strength of this.

If Cloudflare access is ever split so that var/secret editing no longer implies deploy rights, or such a role goes to anyone untrusted with deploys, this ground collapses and the decision must be revisited.

### Rejected alternatives

- **A build-time constant disabling the bypass in production builds** — `pnpm worker:smoke` authenticates its probes by setting the name on the production `.output/` bundle under local workerd; hard-disabling it would break those probes or push smoke onto a special build, surrendering the "test the exact upload artifact" guarantee (the #302 class).
- **Refusing the bypass when a production-only binding is present** — contradicts the principle in `shared/utils/localDeveloperAuth.ts` that environment shape is never inferred from bindings, and the same access that sets the name can remove the sentinel.
- **Keeping the two-value scheme** — see _Why_.

## ADR-0018: A LAN bypassed launcher is an accepted local exposure

Accepted · 2026-09-23

### Decision

**`pnpm dev:local:bypass` exists, and is `dev:local` (bound to `0.0.0.0`) plus the bypass assignment.** A `:bypass` suffix is the single mark of a launcher that arms the bypass and never changes where a launcher binds; this is the only bypassed launcher that leaves loopback. Everything in ADR-0017 holds.

### Why

Better Auth admits only the hostnames in `AUTH_ALLOWED_HOSTS` — the production domain and loopback — so a device reaching the dev server by LAN address cannot sign in, and without this launcher LAN testing had no route to operator pages (only Screen Outputs, which carry a capability, worked).

### Consequences

- While it runs, every machine that can reach this one has the Local Developer User's access. The exposure is bounded by the developer's network and the process lifetime; nothing ships, and deployed installations are unaffected.
- The README warns at the launcher's row rather than banning it.
- `test/unit/scripts/workerSmoke.test.ts` pins the launcher to its twin's `--host 0.0.0.0` and refuses the name in every unsuffixed script.

### Rejected alternatives

- **Add LAN hostnames to `AUTH_ALLOWED_HOSTS` and sign in for real** — a LAN address or `.local` name is per-machine, so it becomes a production-allowlist wildcard or a per-developer edit to committed code, and cross-host sign-in over plain http is its own cookie problem — all to buy a boundary on a network the developer already trusts.
- **Forward `--host` through `dev:bypass`** — fewer scripts, but LAN exposure becomes an unnamed flag instead of a launcher the README and test can point at.

## ADR-0019: The migration history is squashed into one baseline before ship

Accepted · 2026-10-13, amended under #621

### Decision

**The 32 migrations (`0000`–`0031`) are replaced by one `0000_baseline.sql`**, generated by drizzle-kit from the current schema plus a hand-written tail: the `graphics_capacity_settings` seed row and the two `screens` Deck-source triggers, which drizzle-kit cannot express. Production's D1 is dropped and recreated (the pre-ship wipe spec #60 already settled) before the next deploy applies it.

### Why

Nothing is live and no database holds data worth keeping, so the history's backfills and data rewrites (0007, 0024, 0025, 0028, 0030) protect nothing, and their per-migration tests only exercised them. Production's `_hub_migrations` records the old names; squashing after ship would mean hand-editing that table, so the window closes at first ship for every migration a deployed database has applied (amended by ADR-0071: migrations none has applied may still be squashed).

### Consequences

- **Production must be wiped before this deploys**: against the old `_hub_migrations`, `0000_baseline` reads as unapplied and fails on existing tables. Every local D1 (`.wrangler/state`) still holding the old history needs the same reset. The wipe is a one-time transition: a database that has applied `0000_baseline` is past it and takes later migrations normally (README § Database).
- The per-migration suites and the #310 journal-replay test are gone; `baselineMigration.sqlite.test.ts` pins the hand-written tail and the constraints they used to prove. Future data migrations get their own held-back test (README § Database).
- The baseline drops `proposed_name`'s `DEFAULT ''` (a backfill device in 0002, not in the schema).

### Rejected alternatives

- **Keep the history** — costs little now, but every replay carries backfills for data that never existed, and squashing only gets harder once production holds real rows.

## ADR-0020: Chromium is the only supported engine for transparent video

Accepted · 2026-10-15 · #570

### Decision

**Screen Outputs and authoring are supported on Chromium only.** The video target-compatibility mechanism is removed. That covered:

- the user-agent classification;
- the capability session's `unplayableRevisions` forecast;
- the 409 `vp9-alpha-chromium-required` on Screen Output delivery;
- the reference index's `chromium-transparency` ⇒ Chromium-target clauses;
- the "Will not play on…" picker labels;
- the user agent in Screen Output presence.

A transparent (VP9-alpha) revision is published and delivered like any other. In a browser that can't keep its alpha, it renders flattened; nothing detects or refuses that browser.

### Why

Every output that matters is Chromium: broadcast software captures a browser source through an embedded Chromium, and that is what makes VP9 alpha usable at all. The mechanism protected browsers that are not the product's rendering target. It cost about 700 lines across server, shared and client code, about 25 test files, and a deploy-day gate (`safari-vp9-alpha`) that needed Safari remote automation set up on the operator's machine. The silent-video validator still proves, in headless Chromium, that a transparent revision really renders transparent before it is accepted.

### Consequences

- **Stored documents and v1 Template Packages are not migrated.** `videoCompatibility` on Media Graphic Items, media Graphic Input values and Background Layer sources is accepted and dropped on read, so nothing stored or exported before this change stops loading, and no package version bump is needed. `technical_facts.targetCompatibility` stays on revisions as a recorded fact.
- **The validator's rejection is renamed** `vp9-alpha-transparency-unproven`. Reports stored before keep the old code.
- **The picker no longer refuses a transparent revision lacking the validator's `chromiumTransparencyPlayback` proof.** That is safe because every path that accepts an alpha revision (ingestion, repair, package install) runs the validator and stamps the proof, so an unproven alpha revision cannot be reached.
- **Stable codes are retired, not removed.** The preflight warning `graphic-asset-compatibility-restricted` and the acceptance evidence codes `restricted-video-session-refused`, `restricted-video-refusal-unforecast`, `safari-vp9-alpha-not-blocked` and `safari-vp9-alpha-transparency-rendered` are no longer raised; they stay listed because those code sets are append-only.
- Deploy day runs six acceptance gates.
- Control surfaces are not blocked in other browsers, and keep the `-webkit-` CSS iPad needs. The Feature Match Overlay keeps its `-webkit-mask` prefixes, because the Chromium versions embedded in broadcast software are unconfirmed.

### Rejected alternatives

- **Keep the block, drop only the Safari gate** — cheaper. But it kept 700 lines guarding a non-target browser, and the rest of the suite would still have tested the block without ever proving a real Safari needed it.
- **Detect non-Chromium browsers and warn** — keeps the user-agent detection this removes, to tell an operator something they can't act on mid-show.
- **Migrate stored documents to remove the key** — five document tables and every exported package, for a key that is harmless once ignored.

## ADR-0021: A Screen Media Source is for a Screen's own media; graphics content stays library-only

Accepted · 2026-10-15, amended under #582 · [#484](https://github.com/KeeprDigital/stream-keepr/issues/484)

### Decision

**A Screen Media Source — one exact Graphic Asset Revision or a Remote Media URL — is offered only where a Screen supplies its own media:** image and video Background Layers (on the Background Screen and every plain overlay mode) and the Feature Match Overlay Frame's image and video. Media Graphic Items, media Graphic Input defaults, and Broadcast Graphics Live Session media values stay Graphics Asset Library references only. Fonts are out of scope.

In code it is `ScreenMediaSource` (`{ kind: 'asset', assetId, revisionId } | { kind: 'url', url }`), never `MediaSource`, which would shadow the browser global. The Frame takes it as-is: `backgroundImage` becomes a `ScreenMediaSource`, and `mediaBackground` becomes `{ enabled, source, fit, opacity, playbackRate, loop }` with no `type`, its library arm limited to silent video. One shared picker component serves every host.

A Remote Media URL is HTTPS or root-relative, and the empty string means unset. A root-relative path must name media the application serves: it is taken only under an allowlist of app-served media prefixes, today `/video/` alone (`APP_SERVED_MEDIA_PATH_PREFIXES`, `shared/utils/remoteMediaUrl.ts`). Every other same-origin path is refused, as is any path that could leave the prefix once resolved or percent-decoded: a dot segment however spelled or encoded, a backslash, whitespace or a control character, or a second encoding layer. An HTTPS URL must carry its `//` authority, because `https:/api/…` resolves against the Screen's own origin. The schema and the editor share the rule and its wording.

### Why

Background Layers are where an operator drops in whatever a show needs, including media hosted elsewhere, so they need both sources. Graphic Items and Inputs are graphics content: templates, packages, and live values are built on every persisted graphics reference pinning an exact revision and on approved remote ingestion never creating a remote dependency (CONTEXT.md invariants). A URL there would make every such Template unexportable. The ticket's "everywhere" went no further once that cost was clear.

Plain `http://` is refused because an HTTPS-served Screen blocks it as mixed content, which would show a blank output with no error.

A root-relative path was first accepted wherever it pointed, so an author could paste a library content route (`/api/graphics-assets/…/content`) as a Remote Media URL. It previews, because Preview fetches with the author's session, and is blank on air, because a Screen Output holds only its Screen Output Asset Capability. It also bypasses the exact-revision reference, so the revision counts as unused and can be retired under a live Screen (#582). An allowlist rather than a `/api/` denylist means a new route cannot reopen that gap. `/video/` is the one directory under `public/` holding Screen media; `/fonts/` (fonts are out of scope), `/_acceptance/` (environment probe pages) and `/favicon.ico` are not backgrounds.

### Consequences

- **No old shape is accepted.** Stored Frames holding a bare `{ assetId, revisionId }` `backgroundImage` or a `mediaBackground.url` fail the schema, as do v1 `sklayout` payloads in that shape. `FEATURE_MATCH_LAYOUT_FORMAT_VERSION` and the package schema version stay 1. That is safe because nothing has shipped and ADR-0019 wipes production; local D1s holding such Frames need a reset.
- **A Feature Match Layout with an HTTPS Remote Media URL still cannot be exported or installed** (`remote-resource-dependency`). The issue names the slot and points to the library's approved HTTPS copy. A root-relative path is not refused: it travels as data and resolves against the receiving installation, so a file that installation does not serve renders blank. Accepted, as that already held for the Frame video and the failure is a blank, not lost data. Asset-sourced Frame media exports through the existing reference walker.
- **The allowlist reaches every Screen Media Source host through the one schema:** Background Layers on every mode, the Frame's image and video, Feature Match Layout Template writes, and `.sklayout` installs, which refuse a package naming any other root-relative path and name the field. Stored configurations are read without the schema, so a stored path outside the allowlist still renders as before, and the next write that re-sends its stack or layout is refused until the author changes it; the editor shows the refusal on the field. An installed layout holding one drops out of the library, as any unreadable installed document does. Nothing is migrated: nothing has shipped (ADR-0019).
- Asset-sourced Frame media keeps its place in Graphic Asset Reference indexing (`layout.frame.*`); URL sources fabricate no reference. Plain-mode Background Layers are indexed too, each under its own `<mode>.backgroundLayers.` namespace, because every plain mode names its stack alike (#580).

### Rejected alternatives

- **URL everywhere, as #484 first asked** — breaks the exact-revision and no-hotlink invariants for graphics content, and makes Templates unexportable.
- **Let a URL travel in a Template Package as data** — a package would then depend on a remote host the receiver never vetted, which is what `remote-resource-dependency` exists to refuse.
- **Turn the Frame's media into a Background Layer stack** — graphics hosts own their backgrounds (ADR-0016); that is its own decision.
- **Normalise old Frame shapes on read** — costs little, but nothing in the old shape has shipped.
- **Refuse only `/api/` root-relative paths** (#582) — every route added later would need remembering, and other same-origin paths are not media either.
- **Refuse root-relative paths entirely** (#582) — bundled media would have to become library assets or a named built-in, a bigger change for no extra safety once the allowlist holds.
- **Only warn in the editor when a URL looks like a library path** (#582) — stored values and imported packages would pass unchecked.

## ADR-0022: A Screen Output reads what its Screen publishes, through its Screen

Accepted · 2026-10-17 · [#604](https://github.com/KeeprDigital/stream-keepr/issues/604) · Amended 2026-10-21 ([#707](https://github.com/KeeprDigital/stream-keepr/issues/707)): a Card's expiry is a clock projection that no read, client or timer writes · Amended 2026-10-27 ([#820](https://github.com/KeeprDigital/stream-keepr/issues/820)): the Event context carries the Event's Theme · Amended 2026-11-03 ([#908](https://github.com/KeeprDigital/stream-keepr/issues/908)): a Metagame read counts Conversion Rate against the Event's Conversion Target (ADR-0061)

### Decision

**Every read a rendering of a Screen makes goes through that Screen**, under `/api/screen-output/events/:id/screens/:screenId/**`, and is admitted by its Screen Output Asset Capability or an operator Session (ADR-0010's dual credential). The family is: `event` (the Event context), `card`, `broadcast-graphics/live-session`, `player-history`, `standings`, `metagame`, `top-cards`, `pairings` (#751), `top-cut` (#752), `head-to-head` (#760), `archetype-spotlight` (#761), `round-clock` (#916), `feature-match-slots/:slotId`, `players/:playerId/decks`, and the Screen itself by id (for re-reading it after `screen:updated`), beside the existing slug lookup, `broadcast-deck-list` and asset delivery. Each new read is admitted by `requireScreenOutputRead`, and refuses with its one non-enumerating 404.

**A capability reaches a mode's data only while its Screen is in that mode** (`requireScreenOutputModeRead`): a Screen publishes what it is showing, not every mode it holds configuration for.

**The server derives the resource from the Screen's saved configuration.** No id in the URL names what to read where the configuration already does: Player History reads its configured Player, Standings its Round and watchlist, Pairings its Round's Matches, Top Cut Bracket the bracket of its Phase, Head-to-Head the two Players its Feature Match Slot seats now or the two it picks (#760), Metagame and Most Played Cards the breakdown their fields describe, Round Clock its Round, or the Current Round with none picked (#916), Archetype Spotlight the archetype detail its Archetype and scope describe, each counting Conversion Rate against the Event's Conversion Target (ADR-0061) (one shared query builder, `shared/utils/metagameQuery.ts`, serves both sides), Talent the Talents it picks (#782). Two reads take a path id, because a rendering legitimately asks for something the configuration names only indirectly:

- `feature-match-slots/:slotId` — a capability reaches only the Slot the current mode shows; a Session reaches any, because the Feature Match Overlay's editor preview renders a Slot not yet saved.
- `players/:playerId/decks` — a capability reaches only the Deck List mode's selected Player or the shown Slot's two Players, so it cannot read the Event's decklists ahead of their broadcast.

**The Event context is an allowlist** (`SCREEN_OUTPUT_EVENT_FIELDS`): name, game, orientation, display formatting, Theme selection, Feature Match defaults and feature flags. Beside those fields it carries the selected Theme's stored tokens and revision (`theme`, null for the Default Theme; #820), so Reconnect Resync re-reads the Theme with the rest of the context. A rendering holds it as `eventStore.outputEvent`; components shared with control pages read `eventStore.displayEvent`.

**A rendering never changes live state by reading it.** A Slot with no Feature Match Session answers `activeSession: null` instead of the output starting one, and an expired Card is hidden locally instead of `DELETE`d.

**A Card's expiry is a clock projection, not a state transition** (as ADR-0009 makes the current page). A timed Card is expired once server time reaches its `timeoutStartTimestamp + timeoutDuration`, and every holder derives that from the Card itself on the shared clock: `getScreenCard` answers `null` for it, and the operator Card page and every rendering hide it at that instant. Nothing writes as the timeout runs out:

- **No read writes.** The operator and Screen Output Card reads answer the projection and leave the stored Card, its revision and its KV copy as they are.
- **No client clears on expiry.** The operator Card page hides an expired Card as a rendering does. Its `DELETE` is the operator's explicit Clear only, which still clears, advances the revision and announces `card:cleared`.
- **No timer exists, and none is needed.** The stored expired Card is inert. It stays until the next save, Clear, or Screen or Event deletion replaces or removes it, so a show whose every client disconnected before expiry needs nothing to run.
- **Only the Card read carries the Card.** A Screen read (the operator list, the Screen by id and by slug) does not ship `activeCard` or `activeCardVersion`, so no surface shows the stored value past its expiry. The Card read answers the Card with its Card revision, which orders it against the Card's writes and announcements (ADR-0042).
- **Nothing announces expiry.** A holder schedules its hiding from the `timeoutData` that `card:updated` and the Card read already carry. `card:timeout` and `card:timeout:cancel` add nothing to those, and are retired.

**Every rendering reads this way, whatever it holds.** A Program monitor or preview with a Session takes the same paths as a capability-only output. No client chooses a path by credential.

### Why

The Event middleware loaded the private Event for the output page, got a 401, and sent program to `/`, then to sign-in. That was the first of many private reads: every mode's data, the Live Session snapshot and the Screen-by-id reload behind `screen:updated` were all session-only. The last swallowed its failure, so an output also silently missed every later mode change.

Deriving from configuration keeps the capability's reach equal to what the Screen publishes, the same rule ADR-0010 and the Broadcast Deck List read already apply. A mismatch between a client's held configuration and the saved one self-corrects: the save announces `screen:updated`, the rendering re-reads its Screen, and its mode re-reads.

This section first named a server-side timeout as expiry's owner. None exists: `cardTimeoutService` schedules nothing and only publishes `card:timeout` and `card:timeout:cancel` (#707). Two client-triggered writers cleared the Card instead. Every operator Card page holding the Screen sent an unguarded `DELETE` when its timer fired. A stale one arriving after another operator's replacement erased the replacement and announced `card:cleared`. Every Card read past expiry, Screen Output reads included, also cleared the row, guarded by the revision and unannounced. Clearing an already-expired Card adds nothing anyone can see, because every holder hides it by the clock and only the read guard reads the revision. The only visible effect of either writer was the stale-`DELETE` defect. So expiry needs no owner. Treating it as a projection keeps reads observational, leaves `DELETE` to operator intent, and removes the race.

### Consequences

- The ordinary `/api/events/**` reads stay private. This widens the capability surface, not the Event boundary.
- An announced active Screen is re-read by id through the Screen Output path, with the credential it was first read with — by id because a slug can be renamed under an output on program.
- Reconnect Resync re-reads the same way: the held Screen by id and the Event context, both through the Screen with the credential the rendering loaded with (#705). A rendering's load is the Screen lookup, the Event context and — for a Screen Output — its realtime session; one that holds its Screen without the rest has not finished loading, so its next recovery resumes the load from that Screen rather than only re-reading it. A load whose Event context read failed says so ("Event details unavailable"), never "Screen not found", and retries itself every 15 s, because nothing else retries it while the connection stays up (#727). The Event context is the display session's own re-read, not Event Data Resync's Event dataset (ADR-0028): that dataset is the operator's private Event, which a rendering never holds.
- Store-wide reader hooks a rendering installs (`readActiveCardAsScreenOutput`, `readSessionsAsScreenOutput`, `readSessionAsScreenOutput`) are uninstalled when the rendering is disposed, so a control page never inherits them.
- The Feature Match Overlay sideboard follows `player:updated` and `playerDeck:cardsResolved` on the Event channel directly, since an output holds no roster for either message to update (ADR-0031). Deck List and Standings hold their reads in Screen Mode Data Freshness, which hears their Event Data messages on the Event channel the same way (#603).
- A rendering holds the records it read in the ordinary stores (`playerStore.holdPlayer`, `featureMatchStore.holdFeatureMatch`), so `player:updated` and `featureMatch:updated` keep them live without the private roster or Slot list. Standings does not: an operator's populated roster would stand in for its read.
- Melee sync refreshes, which reload whole collections privately, are skipped on a rendering. What a rendering re-reads after Event Data changes is the Screen Mode data freshness work's (#601–#603, #610).
- Writes from a rendering are out of scope: a Feature Match control Screen's commands and page persistence still need a Session.
- The Broadcast Graphics Live Session read still ensures a session server-side, as the private read always has.
- An expired Card's stored value and its KV copy stay until the next save, Clear, or Screen or Event deletion. That is one bounded Card per Screen. Reclaiming it buys nothing a holder can observe.
- A Card read that loaded the row before a concurrent replacement answers what it loaded. Ordering that answer against the newer `card:updated` belongs to the Card's own read freshness ([#704](https://github.com/KeeprDigital/stream-keepr/issues/704)), not to expiry. Once no client clears on expiry, a superseded read that arms a timer can only hide a newer Card locally, never clear it in storage. #704's read Flight closes that too: a superseded read lands nothing and arms no timer. A read answering a revision older than the one held lands nothing either (ADR-0042).
- `test/unit/server/api/cardExpiry.sqlite.test.ts` pins #707's acceptance scenarios over the real Card and Screen routes ([#725](https://github.com/KeeprDigital/stream-keepr/issues/725)).

### Rejected alternatives

- **Admit the capability on the existing `/api/events/**` reads** — the capability would reach its whole Event, decklists included, and every new private route would need a decision about it.
- **One aggregate "mode data" read per Screen** — each mode's client would be rebuilt around a new payload, and the Live Session and Feature Match Session would lose the snapshot shapes their followers already apply.
- **Path ids validated against the configuration everywhere** — repeats every query's validation on the server for no reach the derived form lacks.
- **Guarded expiry cleanup on reads** (what main does at #707) — a Screen Output's capability read becomes a D1 write, which every rendering that boots or resyncs after expiry attempts again. The write is unannounced, so it changes nothing a holder sees. The operator's expiry `DELETE` still needs its own guard, and a client holds no revision to guard it with.
- **A server-owned expiry timer** (a Durable Object alarm or a sweep that clears and announces) — it adds a scheduler, its failure modes and a redundant `card:cleared` fan-out, all to reclaim a value nothing reads.

## ADR-0023: A Realtime Subscription is held until disposed, and its Event's recovery re-attempts while one waits

Accepted · 2026-10-18 · #609

### Decision

**The realtime transport (`app/plugins/realtime.client.ts`) never forgets a Realtime Subscription on failure.** A room handler, channel handler, presence watch or presence entry that cannot attach stays pending. It might be waiting on a token for its Event, or its channel might have refused the attach. Its Event's recovery attaches it from the transport's own records, and the connection coming back retries it too. Only the consumer's disposal ends it.

**One recovery per Event: mint if no token covers it, then attach everything waiting.** The quick retries (250 ms to 4 s) run first. The fault (`tokenError`) is published when they are spent. Then the recovery backs off (5, 10, 20 s) and settles at one attempt every 30 s, with no attempt limit. It succeeds only once everything waiting has attached, so the fault stands until then. A token in hand is not yet a show receiving. It stops when a recovery for another Event supersedes it, or when the last waiting subscription is disposed. Disposal clears the fault at once, since nothing is failing for anyone any more. A recovery that stops without landing points Ably's own re-mints (on reconnect, before expiry) back at the Event the token in hand covers.

**A refused attach keeps its listener.** Ably re-attaches a suspended channel by itself, and the listener must still be there when it does. A retry takes the listener off before subscribing again, so nothing is delivered twice. A `failed` channel is attached explicitly first, because ably@2.29 refuses a subscribe on one. A refusal on a covered Event starts a recovery if none is running, because nothing else retries it while the connection stays up.

**`enterPresence` holds its entry instead of failing.** It resolves once entered or once held, never waiting out an outage, because a Screen Output stops loading only when it returns. A held entry enters with its latest data once its Event recovers. `leavePresence` withdraws it either way.

### Why

The fix for #307 made a failed mint retry and report, but exhaustion still unsubscribed every waiting subscription. A later subscribe could restore coverage and clear the fault, yet the page's own handlers were gone. With no later subscribe, nothing even re-attempted. Coverage came back with nothing listening, and only a remount recovered. Presence was the same: a Screen Output whose entry failed was never counted again. #590 and #601 work above the transport and cannot restore what it has forgotten.

### Consequences

- Issue #609 asks for retries that are "bounded/backed off". Here that means bounded in rate, not in count: an attempt limit would leave a restored service with nothing listening.
- A page left open through a long outage makes one attempt every 30 s for as long as something waits. That cost buys a show that recovers without anyone touching the page.
- A subscribe on the Event the token still covers no longer clears the fault while a recovery for another Event is still running.
- A refused attach on a covered Event now publishes the fault once its quick retries are spent. Before, it was only a console warning.
- The token covers one Event at a time. A subscription left undisposed on an Event the client has moved away from stays pending. It attaches only if that Event is recovered again.
- Reconnect Resync no longer re-reads on the connection coming back, because channels reattach only after it and `attachPending` runs at that same moment: a read answered first missed whatever was published before the channel listened again (#641). The transport signals each channel attached again having lost continuity (`onContinuityLost`: Ably's attach with `resumed: false`, or a first attach the connection dropped before), and the resync re-reads off that for the Event channel its consumer listens on. A channel lost while the connection stays up resyncs too; a resumed reattach does not. A consumer listening on no Event yet (a Screen Output whose load has not finished, #705) still re-reads on the connection coming back, because that is its only retry.
- **A rendering's first load re-reads once its Event channel first attaches, rather than attaching before it reads** (#727). A Program monitor and a preview do too; only their presence differs. A rendering's Event channel is named by the Event context, so it attaches only after the initial reads have answered, and a first attach on an unbroken connection reports no continuity loss: a Screen or Event change published in between reached neither the reads nor any listener. The transport says when a channel not yet attached attaches (`onceAttached`), and the display session, waiting from before its first read, re-reads its Screen and Event context through the Screen off that attach with the credential it loaded with, holding what is on program. A load whose channel is already attached (a Screen change within one Event) waits on nothing, since the channel was listening before its reads went out. The cost is one more Screen and Event context read per load. Each Screen Mode's own initial read is Screen Mode Data Freshness's, not this re-read's.
- **Every Screen Mode that reads Event data re-reads once its Event channel first attaches too, and a load hears a continuity loss while it reads** (#733). A mode reads as it mounts, which on a first load is before that channel attaches, so the same window stood open for the mode's own data. Reconnect Resync takes an `onFirstAttach` handler beside its resync, told once when the channel it starts listening on first attaches and never when that channel was attached already. Screen Mode Data Freshness (so Standings, Metagame, Most Played Cards, Player History, Deck List, Card Spotlight, Feature Match Controls and the Feature Match Overlay's Slot), the Feature Match Overlay's sideboard read and the Broadcast Graphics Live Session sync pass it. Freshness treats it like a message heard mid-read, asking for one follow-up rather than superseding the read in flight, but lets a load's answer render first: an attach says only that something may have gone unheard, not that the answer is behind. The display session listens on its load's Event channel from before the first read for both the first attach and a continuity loss, because Reconnect Resync follows only a finished load's Event: a Screen change within one Event loads on a channel already attached, and a loss there mid-load was heard by nothing. Either one heard mid-load asks for one recovery once the load finishes, rather than superseding it; a Screen change supersedes the load and what it asked for. Reasons that arrive together, such as an attach that is both a first attach and a loss, recover once. The cost is one more read per mode on a first load whose channel attaches after the mode read, which is the usual case for a Screen Output.

### Rejected alternatives

- **A bounded number of recovery attempts.** It brings back the failure this removes: after the last attempt, a restored service finds nothing listening.
- **Re-register from above the transport** (#590, #601). That would need every consumer to know about token outages and remount, and the transport is the layer that knows a subscription exists.
- **`enterPresence` waiting for the token.** It would hold a Screen Output's load for the length of the outage.
- **A Screen Output attaching its Event channel before its first read** (#727). The load would wait on the attach, holding program blank for as long as a token outage lasts, for the same reason `enterPresence` does not wait.

## ADR-0024: An Event-scoped write's continuation belongs to its Event Lifetime, not its Event id

The client resets every Event-scoped store when the operator leaves an Event, then loads the next one. A write answered after that used to land in whatever the stores held by then. A save of Event A merged A's response, id and all, into Event B. A failed delete put A's row back into B's list. An Archetype edit reloaded A's Feature Match Slots into B's store (#606).

### Decision

**Each Event-scoped store begins a new Event Lifetime on reset, as a Flight from its own Guarded Sequence.** A write captures the current Flight before it awaits. Its continuation runs only while that Flight is current. That covers merging the answer, the optimistic rollback, the error and loading refs, and anything it starts afterwards: priming a Feature Match Session, reloading Slots, invalidating the Metagame. `useAsyncAction` takes the Flight as `flight`. While that Flight is stale, `useAsyncAction` leaves `errorRef` and `loadingRef` alone and does not call `onError`. The Event Data lifecycle module exposes `currentLifetime()` for the stores built on it, and so do the Feature Match Slot and Assignment stores, for the Slot Promotion workflow that writes into both.

This covers the Event store (Event and Talent writes), every Event Data collection, Player List members, Feature Match Slots, Assignments and Slot Promotions, Archetypes, Screens, Deck reviews, Broadcast Deck List creates, Melee operations and the Card store's saves and Clears (#726).

A stale continuation still returns its answer, or raises its failure, to the caller that started the write. The write did happen, and the operator is told so. Only cross-Event state is still updated: the Events list learns a late save or create, because no Event Lifetime owns it. A late Event delete still clears the loaded Event when its id matches, in any lifetime, because that Event no longer exists.

### Why

An Event id cannot tell two lifetimes of the same Event apart. After A → B → A, the second A was loaded fresh. It may already hold what the late answer describes, or something newer. Merging the answer can duplicate a row or bring back an older value, and a rollback can put back a row the reload already has. Flight identity tells the lifetimes apart. The id does not.

### Consequences

- A create answered after the operator returned to the same Event is not added to that Event's collection. The self-origin guard skips this client's own realtime notification, so the row appears after the next load or reconnect resync, not immediately. That is accepted. The alternative is merging answers that the fresh load may already have overtaken.
- Each store's own `$reset` is its lifetime boundary, as it was already the boundary for loads. `resetAllEventStores()` resets them all together. A store that switches Events without a reset (the Assignment and Broadcast Deck List stores, through `ensureEvent`) begins a new lifetime there too.
- A Melee operation from an earlier lifetime no longer answers one started since. The in-flight coalescing is cleared on reset.
- The write itself is not a continuation. One still queued, or retrying a lost race, when its lifetime ends is still sent for its own Event and Screen, at the revision that lifetime last knew (ADR-0041); only its effects on the stores are gated.
- Ordering _within_ one lifetime is unchanged. This decision does not replace live aggregates' sequence and epoch rules (#590, #591). A Slot Promotion result is dropped when its lifetime ended, and otherwise still meets those rules.
- The Card store holds one Screen's Card, so a Screen selection is a boundary too: selecting a Screen, even the one already selected, begins a new Flight within the lifetime, and a save or Clear answered after it touches nothing. Its Card reads were already Flights that a selection, a reset and anything newer supersede (#704). A Clear changes nothing it holds until its `DELETE` succeeds, so a failed one has nothing to roll back: what the store accepted meanwhile stands (#726). Within a selection, the Card's writes, reads and announcements are ordered by its Card revision (ADR-0042).

### Rejected alternatives

- **Compare the current Event id after each await** — what the code did. It is blind to A → B → A.
- **One application-wide Event Lifetime superseded in `resetAllEventStores()`** — one place to look. But a store reset on its own would then keep its old lifetime, and the Event Data lifecycle module would have to import the module that imports it.

## ADR-0025: Animation Effect params are named for what they control, and spatial ones share one direction and neutral value

Accepted · 2026-10-15 · [#503](https://github.com/KeeprDigital/stream-keepr/issues/503) · extended 2026-10-21 · [#583](https://github.com/KeeprDigital/stream-keepr/issues/583)

### Decision

**One operator-facing concept gets one param name.** Spatial knobs in the Animation Effect catalogue split by what the operator sees:

- **`scale`** sizes a repeating field's features (cells, facets, threads, fog, waves), so their count changes inversely. Its label is "<Feature> scale".
- **`size`** sizes discrete elements whose count is fixed or set by another param (`density`, `points`). Its label is "<Element> size".
- **`spacing`** sets the gap between elements without resizing them.

A larger value always draws larger on screen, and a `scale` of 1 is the effect's designed look. The existing effects are retrofitted:

- `zoom` becomes `scale` on caustics, fog, inkmap, and waves.
- `size` becomes `scale` on cells and shards.
- Weave's `scale` is inverted.
- Halo's "Size" becomes "Halo size".

Each new range is the old range mapped through the change, so the extremes the proof scenarios already passed are the ones offered. The rule is stated beside the catalogue in `shared/animationEffects.ts`, and a catalogue unit test refuses `zoom` and any qualified variant (`cellSize`, `waveScale`).

**Every other param is named the same way: for what the operator sees change, under the shared name when the concept is shared** (#583):

- **`speed`** is the effect's whole motion rate and is never qualified. A rate for one motion inside an effect that also has `speed` is `<motion>Speed`.
- **`intensity`** is brightness or glow strength, and nothing else.
- **`centerX`/`centerY`** move the pattern's centre.
- **A colour is `<role>Color`**, named for what it paints and labelled "<Role> color". `backgroundColor` is the colour behind everything; a tonal ramp uses `highlightColor`/`lowlightColor`.
- **A toggle is `show<Thing>`**, naming the thing its label shows.
- **No shader quantities**: no `*Factor` multipliers, numbered keys, or bare `color`.

The ported fork names that broke it are renamed, each new key keeping the old range and default:

- cells: `color1`, `color2` → `lowlightColor`, `highlightColor`.
- dots: `color`, `color2` ("Accent color") → `dotColor`, `lineColor` ("Line color").
- fog: `blurFactor`, `baseColor` → `softness`, `backgroundColor`.
- globe: `color`, `color2`, `maxDistance`, `showDots` → `lineColor`, `accentColor`, `connectionDistance`, `showPoints`.
- halo: `amplitudeFactor` ("Intensity"), `baseColor`, `xOffset`/`yOffset` → `petalDepth` ("Petal depth"), `tintColor`, `centerX`/`centerY`.
- net: `color`, `maxDistance`, `showDots` → `lineColor`, `connectionDistance`, `showPoints`.
- ripple: `amplitudeFactor` ("Intensity"), `ringFactor` ("Ripple scale"), `rotationFactor` ("Rotation"), `color1`, `color2` → `size` ("Ring size"), `swingSpeed` ("Swing speed"), `drift` ("Ring drift"), `highlightColor`, `lowlightColor`.
- waves: `color`, `waveSpeed` → `waveColor`, `speed`.
- ridgelines (not a port, but its key disagreed with its own label): `fillColor` ("Ridge color") → `ridgeColor`.

A catalogue unit test refuses `*Factor`, digits, offsets, a colour key that is not `<role>Color` or whose label is not "<Role> color" for that role, a `<motion>Speed` beside no `speed`, and a toggle that is not `show<Thing>` naming the thing its label does. Whether a label describes what the knob does stays a reviewer's check against the shader.

### Why

The catalogue had three names for one concept (`size`, `scale`, `zoom`) and two directions under one label. Caustics', fog's, and inkmap's "Zoom" drew smaller features as the value rose, while waves' "Zoom" drew larger ones. #503 first proposed applying a standard only to future effects, because renaming shipped params resets stored configs (ADR-0014). Nothing has shipped (ADR-0019), so a retrofit costs no real data now. After first ship, every rename would cost a reset.

### Consequences

- **Stored params and Template Packages naming the old keys stop parsing**: the strict schemas refuse them and the renderer falls back to defaults. That is acceptable before ship only. No format-version bump, for the reason ADR-0014 gives.
- Ripple's `ringFactor` ("Ripple scale") was a motion knob, not a spatial one, so #503 left it alone; #583 made it `swingSpeed`: it sets how fast each ring's lights swing back and forth round it.
- Halo's and ripple's `amplitudeFactor` were both labelled "Intensity" but neither changes brightness: halo's deepens the petals of its flower edge, ripple's sets each ring's radius. So ripple's becomes `size` under the spatial standard (its twenty rings are fixed), and halo's becomes `petalDepth`.
- Shader uniforms carry the catalogue's names, so a reader follows one name from the editor to the GLSL.
- The #583 renames carry no stored-config migration, for the same reason as #503's: the first consequence above accepts the reset before ship, ADR-0014 needs no format-version bump for it, nothing is live (ADR-0019), and no shipped preset, seed, or proof scenario keeps an old key. After first ship, a rename like these needs a migration or a reset accepted in its own ADR.
- Cells' and waves' ranges are renormalised so 1 reproduces their old defaults (size 3, zoom 0.85), which leaves their bounds at uneven values (cells 0.1–1.65).

### Rejected alternatives

- **Standard for future effects only** — leaves the direction conflict on air permanently, to save a rename that costs nothing before ship.
- **`zoom` for sample-domain scale, `size` for element scale** (#503's example) — splits on shader maths rather than what the operator sees, and "zoom" suggests a camera that only waves has.
- **One name for every spatial knob** — ember needs both a density and a size, so "how big" and "how many" must stay distinct.
- **Pixel-level direction tests** — the renderer harness could prove direction, but the cost outweighs a rule a reviewer checks against the docblock.
- **`amplitudeFactor` → `intensity` everywhere** (#583's first example) — puts a second meaning under `intensity`, which caustics, ember, and shards use for brightness.
- **Keep the fork's names on the ported effects** — every one would need renaming after ship at the cost of a reset; before ship it costs nothing.

## ADR-0026: A live aggregate's epochs are ordered by its id

Accepted · 2026-10-19 · [#591](https://github.com/KeeprDigital/stream-keepr/issues/591)

### Decision

The Live State Follower orders epochs by aggregate id. Feature Match Sessions and Broadcast Graphics Live Sessions both take `AUTOINCREMENT` ids, which SQLite never reuses, so a later epoch always has a larger id. Anything from an older epoch than the one held is refused or dropped. A command result from a newer epoch is held, and so is a notification from one that carries its whole snapshot; a notification from a newer epoch that carries only a difference reloads.

A command result's outcome is explicit (`accepted`, and what is `held` now). A feature that merges an answer into rendered state merges what is held, so a refused late answer settles from the newer state instead of its own.

### Why

Issue #590 refused a command result from any different epoch, as Broadcast Graphics had. A Feature Match Slot Promotion answers with a Slot whose Session can be newer than the held one, and the Slot it clears gets one too. Refusing those would leave the promoting client on an ended Session. Falling back to holding them unconditionally would drop the guard #577 had to make up for server-side.

### Consequences

- Broadcast Graphics now drops a notification from an older Live Session instead of reloading, and would hold a command result from a newer one.
- A Slot whose Session is from an older epoch than the one held was read before a newer promotion or clearing of that Slot. The whole Slot is left behind, not only its Session, and a promotion answer whose Slot is left behind does not apply its Assignment either.
- A Slot settings answer and a Slot list load meet the same rule. The Event Data lifecycle takes an opt-in per-item `admit`, which the Feature Match store answers by offering the Slot's Session. A loaded Slot left behind keeps the held one in its place, and the rest of the load still applies. A settings answer left behind answers its caller with the held Slot (#635).
- A Slot with no Session is behind any Session held for that Slot, and is left behind whole the same way. No Feature Match path ends a Slot's Session without opening its successor in the same commit: every one replaces it through Sequenced Live State (ADR-0029), and none only closes it. So a Slot read without one was read before its first Session opened: between the Slot's insert and that open, on create or Slot count sync. While no Session is held for the Slot, it applies (#658).
- A path that ends a Slot's Session and leaves it with none would be refused by every follower holding that Session. Adding one needs an ordering signal other than the Session, and this decision has to be reopened first.
- A snapshot carried by another resource's read (a Slot's Session) is held through `acceptRead`, which supersedes no load: it was read at some moment, so a load in flight may answer newer. A load answering something behind what is held leaves it.
- An aggregate id from a table without `AUTOINCREMENT` cannot be followed: rowid reuse after deleting the newest row would order a new epoch before an ended one.

### Rejected alternatives

- **The adapter decides epoch order** — every feature would write the same comparison again, which is what the follower exists to prevent.
- **A newer-epoch command result goes through `acceptSnapshot`** — that skips every guard, so a late answer could not be told from a fresh one.

## ADR-0027: The Key Output keys every glow at its own opacity

Accepted · 2026-10-17 · [#599](https://github.com/KeeprDigital/stream-keepr/issues/599) · Amended 2026-11-04: a colour's own alpha is keyed, and graphics colour pickers write it · [#967](https://github.com/KeeprDigital/stream-keepr/issues/967)

### Decision

**A glow is composed opacity, so the Key Output paints it like any other paint: white at the glow's own opacity.** That holds for every glow host — a Graphic Item's Graphic Surface Style, a Source Item's framing, and the Feature Match Overlay Frame's border. One module, `app/modules/screen/outputPaint.ts`, owns the Fill-versus-Key paint rules both render models use: a colour at an opacity and a glow on each output. Since #831 the Frame and Source Items take their glow from a surface Mode Token, so the flat hosts' glow defaults are gone. The Frame's paint is decided in the pure Feature Match Overlay render model, not its display. `pnpm accept key-matte` rasterises each host in Chromium and requires the Key matte to equal the Overlay alpha.

### Why

Graphic Item glow already reached the Key Output, but Source Item and Frame glow were withheld from it, so the Fill Output showed a glow the Key matte cut away: on air, a glow keyed against black. A glow is a drop shadow composited source-over, so white at its opacity accumulates into the matte by the same identity as every other element.

### Consequences

- A half-opaque glow is grey in the matte.
- A Frame border with no colour paints nothing in the Key Output either, as in the Fill Output.
- A colour that carries its own alpha (`rgba()`, eight-digit hex, `transparent`) keys at that alpha times the authored opacity (ADR-0049), so the matte matches a translucent colour the picker writes (#967).
- The Frame has no raw CSS gradient since #831. Its fill is its `frame-surface` Mode Token's Graphic Fill, which the Key Output keys at each colour's own alpha. It keys the Frame through opaque white only while the Frame paints media or an Animation Effect, whose colours it has none of.

### Rejected alternatives

- **Keep withholding host glow from the Key Output** — the Fill/Key mismatch is the defect.
- **Key every glow opaque white** — overstates a partial glow, so the matte would no longer match the Fill Output.

## ADR-0028: Reconnect Resync re-reads the Event Data its consumers name, and a revisit re-reads what was missed

Accepted · 2026-10-20 · [#610](https://github.com/KeeprDigital/stream-keepr/issues/610)

### Decision

**A consumer names the Event Data it reads, and Reconnect Resync re-reads exactly that.** Event Data Resync (`app/modules/event-data/resync.ts`) counts consumers per dataset: the Event, Players, Phases, Rounds, Matches, Feature Match Slots, Archetypes, Player Lists, Player Decks, Screens, and the selected Screen's Card. A page consumes each `useEventPageLoading` entry while it is mounted, and names what it loads outside them. The default layout consumes the Event and Screens, and Live Control consumes the Event Data it resolves Graphic Input Bindings from. The Realtime Event Session runs the resync beside the Feature Match Assignment and Broadcast Deck List reloads. It does so once the Event channel is attached again having lost continuity (#641), and when its subscriptions stop waiting on a token (ADR-0023). A token wait missed what was published meanwhile too, and a first attach over an unbroken connection reports no continuity loss. Each dataset is re-read once, however many consumers share it, in place and only if its store already holds it. Its scope is kept: a Round's Matches stay a Round's Matches. A re-read that fails or does not land leaves its dataset behind.

**What nobody consumed at the resync is behind.** A store outlives the page that loaded it, and `useEventPageLoading` skips a loaded store. So the next consumer to name a behind dataset re-reads it instead of trusting it. `resetAllEventStores()` forgets what is behind, because the reset ends the Event Lifetime and nothing it held survives.

**The Card Spotlight mode reads through Screen Mode Data Freshness.** The Card store still follows the Card's own messages. The module re-reads it on reconnection, and on the slow cadence while realtime is degraded. Only a change of Screen deselects the old one. A re-read leaves the Card on air until it answers.

### Why

The Realtime Event Session re-read only Assignments and Broadcast Deck Lists on reconnect. An Event Data collection already held stayed as it was when the socket dropped, and so did a Card on program. The Card Spotlight mode loaded on mount and on a Screen change only, so a Card changed or cleared during the outage stayed on air. Live Control computed latest bound values from stale stores. Re-reading only what is consumed keeps a resync's cost to what is on screen.

### Consequences

- An operator's resync re-reads every consumed collection at once. That is a burst of list reads per open page, once per reconnection.
- Each mode's Settings panel consumes the Event Data its pickers load. A store loaded by a component that does not consume it is not re-read on reconnect. It is behind, and its next consumer re-reads it.
- A consumer that also reads what no store holds passes its own re-read, which runs on every resync until the consumer is disposed. The metagame pages pass their summary and section fetch. That re-read is never behind, since it dies with its page. A metagame page can fetch twice on one resync, once for its own re-read and once more when the Player re-read bumps the roster version.
- A Feature Match Slot re-read offers its Session to the Live State Follower, which holds it when it is newer. So a Session missed in the outage reaches Live Control's bound values through the Slots.
- The Card Spotlight mode, through Screen Mode Data Freshness, also re-reads on the degraded cadence while disconnected.
- A Card read answers whether it landed. A read of no Card has landed. A failed read has not, so the operator's stays behind and a Screen Output's is retried on the slow cadence. A read something newer superseded has not either, as a superseded collection load has not; the newer state is already held (#726). Nor has a read answering a Card revision older than the one held (ADR-0042).
- The Feature Match and Feature Match Overlay modes read their Slot through Screen Mode Data Freshness as well (#592). Their Reconnect Resync re-reads the whole Slot through the Screen and offers its Session to the Live State Follower, rather than reloading the Session alone. So a promotion missed in the outage is found as well as a score. A gap in the Session's notifications still reloads through the follower's load, by the same Screen read.

### Rejected alternatives

- **Re-read every loaded store on reconnect.** It is simpler, but it pays for data no mounted surface shows. It also cannot tell a consumed dataset from one that is just held.
- **Have `useEventPageLoading` always reload on mount.** That fixes a revisit, but every page navigation would re-read lists that live-follow already keeps current.

## ADR-0029: Sequenced Live State opens and closes epochs, and announces only what a commit changed

Accepted · 2026-10-20 · [#593](https://github.com/KeeprDigital/stream-keepr/issues/593)

### Decision

**Every epoch of a live aggregate opens and closes through Sequenced Live State.** `createSequencedLiveEpochs` (`server/modules/live-state/epochs.ts`) builds a transition: the feature's close statements, a statement forgetting the ended epochs' Command Receipts, and the feature's open statements, in that order. The caller commits them alone or inside a larger batch, then settles the transition. The feature supplies only which epochs a scope holds and how one is closed, opened and announced. Feature Match Sessions (the sessions route, Slot create, update and sync, the command fallback, Slot Promotion, the Melee reset) and Broadcast Graphics Live Sessions (reset, mode change, Screen delete, first load) all use it.

**Whether to announce is decided from the commit.** The scope's active epochs are read when the transition is built and again when it settles. Only a difference is announced. A transition whose conditions skipped a Slot or Screen announces nothing for it. A new Feature Match Session is announced as its own `SessionStarted`, carrying its whole snapshot, and Graphic Input Bindings re-resolve once per transition. A Slot Promotion publishes its Sessions' `SessionStarted` among its own messages instead (ADR-0033). A Broadcast Graphics epoch change is announced as `epochEnded`. An end on the way to a Screen's deletion and the epoch a first load opens opt out.

### Why

The close, open and receipt-forgetting sequence was written by hand in three places. Only the sessions route announced a new Feature Match Session. Every other opener relied on a later Feature Match message happening to carry it, which five race fixes traced back to. Receipts are keyed by aggregate id and epochs never reuse one (ADR-0026). So a receipt from an ended epoch cannot answer a command in its successor, and forgetting it in the same commit keeps the store bounded.

### Consequences

- Command Receipts from an ended epoch are gone in the commit that ends it. That is pinned against SQLite in `test/unit/server/modules/liveStateEpochs.sqlite.test.ts`.
- A Screen leaving Broadcast Graphics mode with no active epoch no longer publishes `epochEnded` with a null session.
- A Slot write that opens a Session now re-resolves bindings twice: once for the Session and once for the Slot's own `featureMatch:updated`. A Slot Promotion re-resolves once (ADR-0033).
- Every Feature Match Session transition selects its Slots through one JSON-array subquery. So a whole Event's Slots open in a handful of statements, and the Melee reset is no longer its own variant.
- ADR-0004 is unaffected: a command's notification still carries the difference.
- A promotion that commits but loses to a later one before its outcome is decided announces nothing (#576). That includes the new Sessions of the Slots it cleared. Peers show those Slots' previous Sessions until the next resync or Slot message. This was accepted because it needs two operators promoting the same Match within moments, and it corrects itself.

### Rejected alternatives

- **Announce a lost promotion's cleared Slots' Sessions.** Peers would see part of a promotion its operator was told failed.
- **Announce what the caller asked for.** A Melee reset that skipped a manually rebound Slot would announce a Session that never opened.
- **Announce ended Feature Match Sessions too.** Their successor's `SessionStarted` already moves every follower past them.

## ADR-0030: A Graphics Authoring Lease is decided by the Screen write module and fenced at the commit

Accepted · 2026-10-20 · [#607](https://github.com/KeeprDigital/stream-keepr/issues/607) · Amended 2026-11-03: the Feature Match Layout is leased and fenced too · [#738](https://github.com/KeeprDigital/stream-keepr/issues/738)

### Decision

**The Screen write module decides which writes edit a Screen's graphics Edit workspace.** Every Screen write that can reach it passes through `screenWriteModule()`, and each such update operation takes the asking browser Session as a required `authoringSessionId`. A route only says who is asking. The protected fields are the Broadcast Graphics stack and the Feature Match Layout, which is a Feature Match Overlay's `layout` and the `presetId` it started from. One lease covers both, because they are one Screen's one Edit workspace (#738); there is no per-mode lease. The mode configuration write protects the stack on every Broadcast Graphics write, and the layout on every Feature Match Overlay write that carries `layout` or `presetId`. The generic Screen write protects either when it would change it. A Feature Match Overlay's Feature Match Slot (`featureMatchId`) is what the Screen points at, so it is never leased. The canvas is the Event's Event Canvas (ADR-0051), an Event Presentation Settings write that takes no lease, so no Screen field is a canvas the lease guards. A Screen holds no look of its own (ADR-0051), and the Screen Theme Override write is not lease-gated.

**The generic Screen write is gated by change, not by presence.** It replaces `modeConfigs` whole, and the Edit Screen dialog sends it back as it read it. A rename that carries the protected fields back unchanged stays open to every Session. The comparison ignores object key order.

**The lease is checked again inside the statement that commits.** A write is admitted up front, then commits only while no other Session holds a live lease on the artifact. That condition sits in the same `WHERE` clause as the `stateVersion` guard. It is one Drizzle expression, `graphicsAuthoringLeaseFenceCondition`, and the raw D1 mode configuration write renders the same expression. A write the fence refuses answers the lease's own 409, which the client does not retry as a race.

**Live Control stays outside the lease.** Live Session commands, live state reset, Screen commands, Card writes, Screen mode changes, and choosing a Feature Match Overlay's Feature Match Slot are not admitted by it.

**Both Screen editors take the lease on opening their Edit workspace.** The Broadcast Graphics editor asks while its Edit workspace is open. The Feature Match Overlay editor is all Edit workspace, so it asks as soon as it opens. Without the lease each editor is read-only and offers a take-over. The Feature Match Overlay editor's one write funnel writes nothing, and losing the lease clears its undo history.

### Why

The lease was only checked at two routes. The generic Screen write reached the same stack, and then the Screen's own canvas, with no lease check at all, so a second Session's write succeeded with a current `stateVersion`. A check at the door also left a window. A takeover between admission and commit let the displaced author's save land over the new holder.

### Consequences

- A route that edits the workspace cannot forget the lease. Leaving out `authoringSessionId` is a compile error.
- The fence uses the server's clock at commit. A lease that lapses between admission and commit admits the write, which matches the lease's own rule.
- Two takeovers in the same instant still both report success (see the lease module); the fence orders whichever holder the table records.
- Broadcast Graphic Template and Feature Match Layout Template placement are both admitted inside the mode configuration write, after the template is read, and fenced at its commit. A non-holder placing a missing template now gets its 404 before the lease's 409. Nothing is written either way. Feature Match Layout placement lost its separate check at the route (#738).
- A display reset of a Feature Match Overlay Screen writes its preset's `presetId` and `layout`, so it is lease-gated. The Screen page disables Reset for a Session observing another's lease, and the server refuses it anyway. A Broadcast Graphics reset never touches the stack, which is an authored stack, and is gated as before.
- Nothing else writes a Feature Match Layout. A Theme or Screen Theme Override write changes look, never a Screen's mode configuration, so neither is refused (ADR-0049). Creating a Screen is not an update, and saving a layout as a Feature Match Layout Template only reads it. The Feature Match Layout Template library's own writes are library writes, not Screen writes. The editor offers them only to the Screen's holder, as the Broadcast Graphics editor does with its library.
- A Feature Match Overlay layout save that was pending when its author lost the lease is refused at the fence with the lease's 409. The editor drops its unsaved layout and clears its undo history, so the new holder's changes show and cannot be undone over.
- The Broadcast Graphics editor drops its unsaved stack, Graphic Channels and Broadcast Graphics Background once another Session holds the lease, for the same reason (#1026). It keeps them while the lease is merely not held, as after its Edit workspace closes, because the fence refuses nothing then and a pending save still lands.
- The Feature Match Overlay canvas size is not leased, though #738 decided it should be in Feature Match Overlay mode (E2). Since ADR-0051 there is no per-Screen canvas, and the Event Canvas stays unleased in every mode, so nothing is leased for it. That decision applies again only if a per-Screen canvas comes back.
- Deleting a Screen is not lease-gated. It removes the Screen rather than editing its workspace, and its lease lapses at the holder's next missed heartbeat.
- Deleting a Player writes its Screens outside the Screen write module (ADR-0032). It clears only a Deck Source, which no lease protects.
- Deleting a Phase, Round or Archetype writes its Screens outside the Screen write module too (ADR-0060). It only unsets Event References, which no lease protects.

### Rejected alternatives

- **Refuse the protected fields on the generic Screen write outright.** That would break the Edit Screen dialog, which sends `modeConfigs` back on every rename.
- **Keep the admission check alone and state the race.** The fence costs one `NOT EXISTS` on a uniquely indexed row, and it closes the race outright.

## ADR-0031: A resolved Unresolved Deck Card announces the Deck Lists it rewrote, and re-projects nothing

Accepted · 2026-10-20 · [#648](https://github.com/KeeprDigital/stream-keepr/issues/648)

### Decision

**Resolving an Unresolved Deck Card publishes `playerDeck:cardsResolved`** once its batch commits. The message names every Deck List the resolution rewrote and their Players (`deckIds`, `playerIds`), because one resolution rewrites every Deck List in the Event holding that name, not only the one the operator opened. It publishes plainly: no Graphic Input Binding reads a Deck List's cards.

**No Player revision moves and no Archetype projection re-runs.** The projection reads only a deck's Archetype, review, name and colours, none of which a card changes. Key-card matching is a suggestion in the Archetype assignment UI, not part of the projection.

**Screen Outputs re-read through what they already follow.** The Metagame and Most Played Cards breakdowns re-read on every resolution. The Deck List mode re-reads when the message names its selected Player, and the Feature Match Overlay sideboard when it names either side's Player.

**Operator browsers drop what they cached.** An operator browser drops those Players' cached Deck Lists and invalidates its Metagame pages. The resolving browser does the same itself, since it skips its own message. A read in flight when its Player's entry is dropped is not cached when it lands.

**Reconnect Resync drops the whole Player deck cache.** Contradicts Reconnect Resync's "a resync re-reads and never clears" (CONTEXT.md, ADR-0028) — worth it because the deck cache is a read-through cache, not held Event Data: it renders nothing of its own, and every reader fetches through it. It is keyed by Player revision, which a missed resolution never moves, so nothing else would ever re-read it. Melee sync refreshes already drop it the same way.

### Why

The resolution published nothing. Only the resolving browser cleared its own deck cache. Every other browser and every Screen Output kept the old Deck Lists until some unrelated change made them read again.

### Consequences

- A degraded Deck or sideboard rebuild is compared by what it was built from, not by Player revision. Otherwise a rewritten Deck List could be kept off program as "unchanged" while Scryfall is still failing.
- A surface that already holds a deck read from the cache keeps it until it reads again: Feature Match deck counters and tokens, an open Player deck modal, a Card Spotlight Screen's Deck List source. Only its next read is fresh. A resolved card that adds a deck counter type reaches the Feature Match counters only then.
- Other operators' Unresolved Deck Card lists on the Melee sync page do not follow the message. A second resolution of the same group gets a 404 and reloads the list.
- A Companion resolution names every matching Deck List, including one whose manual Companion it left alone. That one re-reads for nothing.

### Rejected alternatives

- **Reuse `melee:decklistsSynced`.** This is an operator edit, not a sync, and the operator handler for that message reloads whole collections.
- **Roll each affected Player's `updatedAt` and publish `player:updated`.** That reuses the revision-keyed paths, but it sends one message per Player, possibly hundreds for a common misspelling. It also reports a Player change that did not happen.
- **Name the deck cache as an Event Data Resync dataset.** Its readers do not consume it while mounted. They fetch through it on demand, so nothing would name it at a resync.

## ADR-0032: Deleting a Player releases every Deck Source that selects them

Accepted · 2026-10-20 · [#651](https://github.com/KeeprDigital/stream-keepr/issues/651)

### Decision

**A Player selected as a Deck Source can be deleted, and the delete clears that Deck Source to no Player in the same write.** `buildClearDeckSourcePlayersQuery` rewrites each Screen in the Event whose Deck Source names a deleted Player, and bumps its `stateVersion`. It runs in the same batch as the delete, ahead of it. Both paths that delete Players use it: deleting one Player, and the Melee data reset, which deletes every imported Player.

**Each cleared Screen is announced with `screen:updated`, ahead of the delete's own announcement and without an origin.** The deleting client never received those Screens back, so it must not skip the announcement as its own echo. A Deck List Screen Output then follows its Screen to no Player, blanks through the staged swap, and stops reading the Player. A `melee:dataReset` that arrives before the Screen reload lands can still cost one failed read, and its retry stops once the reload lands.

**Contradicts ADR-0030, which says every Screen write passes through `screenWriteModule()`.** The clear is part of the Player delete's write, and it has to commit in the same batch as that delete. Routing it through the Screen write module would split it into a separate write per Screen.

### Why

The Screen guard triggers prove that a Deck Source's Player exists whenever a Screen's `mode_configs` is written. Nothing ran when the Player went away. A Screen left naming a deleted Player failed every later configuration write with `SCREEN_DECK_SOURCE_CONFLICT`, including edits to other modes, and its Deck Output kept the deleted deck on air while re-reading it every 15 s.

No Player is already a valid Deck Source, and a Screen with nothing selected is what an operator would get by deselecting first. A Broadcast Deck List is different: someone prepared it for display, so a selected list is protected from deletion. A Player is tournament data, and the Melee data reset deletes Players as a side effect of moving its configuration.

### Consequences

- An operator form that read the Screen before the delete gets a `stateVersion` conflict on its next save, as for any other concurrent Screen write. That includes a Graphics Authoring Lease holder, because the clear ignores the lease. The lease protects nothing the clear changes.
- A delete that finds no Player still clears a Deck Source naming that id, and announces it.
- Screens that already name a missing Player are not repaired by a migration. Such a Screen accepts a write that selects another Deck Source, and deleting that Player id again clears it.

### Rejected alternatives

- **Refuse to delete a selected Player, as a selected Broadcast Deck List is refused.** The Melee data reset would then have to refuse a configuration change too, or delete around the Screens. Either way, operators would have to hunt for Screens before changing Melee configuration.
- **An `AFTER DELETE` trigger on `players`.** It would cover every path without code, but the service could not say which Screens changed, and they still have to be announced.

## ADR-0033: A Feature Match Slot Promotion decides its outcome purely, then publishes once

Accepted · 2026-10-20 · [#594](https://github.com/KeeprDigital/stream-keepr/issues/594)

### Decision

**The outcome is a pure decision.** `decidePromotion` (`server/modules/feature-match-promotion/decision.ts`) takes what the promotion read before its batch and what it reads right after the commit. It answers `lost`, `failed`, or `standing`. Only a standing decision can build a publication. It takes later reads and answers `won` or `won-then-moved`, the messages to send, and the response. A lost promotion has no messages to publish, so "decide the outcome before publishing" (#577) holds by the module's shape.

**The publication is one change.** Every new Session's `SessionStarted`, the Assignment messages and every Slot's `featureMatch:updated` are published in that order. Graphic Input Bindings then re-resolve once, however many Slots were cleared. The promotion settles its Session transition with `announce: false` and publishes the Sessions among its own messages.

**The Reverse Sync runs between the decision and the publication's Slot reads.** It writes without announcing, and the Slots are read after it, so peers get the players' latest data. When the sync faults, the committed promotion is still published, and then the fault is answered.

**Contradicts ADR-0029's consequence that a Slot write opening a Session re-resolves bindings twice.** A promotion re-resolves once. It also goes against the epoch module's note that only an end nobody may be told about opts out of announcing. A promotion opts out because it announces the same Sessions itself, in the same order as before.

### Why

One function ran about ten steps in a fixed order. It published 3+N messages, and each message re-resolved bindings. Its unit test mocked seven modules. The race histories were proven only by an integration test that #577 had to run 401 times.

### Consequences

- Every outcome is unit-tested against the pure decision with no mocks (`featureMatchPromotionDecision.test.ts`). The fence, the publication and the refresh count are pinned against SQLite (`featureMatchPromotion.sqlite.test.ts`).
- The Sessions a commit opened are still read straight after the outcome is decided, before the Reverse Sync. So a `SessionStarted` still carries the Session as it opened, and the Slot messages carry it after the sync, as before.
- A promotion that stands but whose Slot is gone by the later reads, or whose later reads fail, publishes nothing and answers `500`. Before, it had already published its Sessions and Assignment. The Slot's deletion announces itself.
- A promotion moved off before the later reads still publishes the Assignment it committed. Its Slot messages and response show the move, as before (#575).
- The plan fence from #605 is unchanged. It still rides in the batch ahead of the Session transition.
- A Reverse Sync that has to open a missing Session announces it on its own, with its own refresh. That cannot happen to the Slots a promotion just opened Sessions for.

### Rejected alternatives

- **Decide and describe in one call from one set of reads.** Either the Reverse Sync runs before the decision, writing to the winner's Slots on a lost promotion where no one is told, or the publication carries data from before the sync.
- **Publish the Assignment before a fallible Reverse Sync, as before.** The single publication would split in two, with a refresh for each half.

## ADR-0034: Every graphics Template write requires each of its references to be selectable, fenced at the commit

Accepted · 2026-10-21 · [#614](https://github.com/KeeprDigital/stream-keepr/issues/614) · Amended 2026-10-28: the Graphic Style Set operations it also covered are gone · [#830](https://github.com/KeeprDigital/stream-keepr/issues/830) · Amended 2026-11-04 by ADR-0068: an Installed Graphics Template's references hold Retire back too · [#622](https://github.com/KeeprDigital/stream-keepr/issues/622)

### Decision

**A template has no retained-reference path.** Every write of a Broadcast Graphic Template or a Feature Match Layout Template requires each Graphic Asset Reference its stored document holds to name an existing revision, with available content, of an active Graphic Asset whose kind fits its item, input, or typography slot. That covers save, revision and rename. A write that keeps a reference it already held is held to the same rule as one that introduces it. Anything else is refused with `409`.

**The route asks first and names every refused slot.** `assertGraphicsTemplateReferencesSelectable` (`server/utils/graphicsTemplateReferences.ts`) asks the library once for the whole document and lists each slot with its reason: does not exist, content unavailable, retired, trashed, or the wrong kind.

**The store asks again in the statement that commits.** The template row's `INSERT` or `UPDATE` carries `REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE`, the rule the Screen write already uses, with no reference allowed to be retired. The reference-index insert reads the same bound array under the same rule. So a template commits only with every reference resolving, and then every reference is indexed. The rule now lives in `server/modules/graphic-asset-reference-resolution.ts`, shared by the Screen and both template stores. A commit the rule refuses answers its own `409`, told apart from a stale `revision` by the revision still standing.

**Retire is refused while a saved template references the asset.** Retiring a Graphic Asset is refused while any Broadcast Graphic Template, Feature Match Layout Template or Installed Graphics Template (since ADR-0068) references any of its revisions. It answers `in-use` with those templates' usage, as Trash answers a referenced asset, and the Library Workspace names them. The condition sits in the catalogue's retiring `UPDATE`, so a template saved concurrently either commits first and holds the asset back, or finds the asset retired and is refused. A Screen's reference does not hold Retire back: a Screen keeps an unchanged retired reference resolving, as before. This matches a selected Broadcast Deck List, which cannot be deleted. A Theme's reference, a Screen Theme Override's and a Talent's photo do hold it back (ADR-0050, ADR-0067).

**Content availability is checked at the route only.** It is the byte store's state, which no D1 statement can see.

### Why

Both template stores checked only that a revision existed. An image Media Graphic Item could pin a font, and retired or unavailable content was accepted. The check ran only at the route, and the index insert silently skipped a revision it could not find, so a template could be stored with a reference the index never recorded. No template documents with old references exist yet, so there is nothing to keep a retained-reference exemption for.

Without the Retire guard, the rule would turn retiring an asset into making every template that uses it unrevisable, a rename included.

### Consequences

- A template's references cannot become retired, trashed, pruned, or purged under it. Trash, Revision Pruning, and purge each prove no reference points at a revision, and Retire now proves no template does.
- Unavailable content can still appear under a saved template. It refuses that template's writes until Exact-Byte Repair restores the bytes.
- An Installed Graphics Template holds Retire back like an authored template (amended by ADR-0068). It is never revised, so this once made its assets unretirable for good; removing it now releases them. An asset retired before that amendment can still sit under one, leaving it unplaceable until restored.
- A template already holding a retired reference (written before this rule, or by a direct database change) is refused on every write until the reference is replaced in that write or the asset restored.
- A rename on a stale `revision` skips the route's check and gets the revision conflict, so an author is not told about a document they have not read. A revision carrying a new document is checked first, as before.
- A Template Package Installation writes Installed Graphics Templates through the library's own store, which already maps every reference to one exact local revision.

### Rejected alternatives

- **Exempt a reference the template already held, as a Screen does.** The maintainer chose no distinction (#614): there are no older template documents to protect, and the exemption is what let wrong-kind and retired references through.
- **Guard only the route.** A retirement between the route's question and the commit would land.
- **Let Retire proceed and leave the template unrevisable.** That was this ADR's first version. The maintainer chose to refuse Retire instead (#614).
- **Hold Retire back for Screens too.** It would change existing behaviour nothing here needs to change: a Screen keeps an unchanged retired reference resolving, so a retirement leaves it editable.

## ADR-0035: The app and the validator each carry a promotion marker, and the validator deploys on a build fingerprint

Accepted · 2026-10-21 · [#616](https://github.com/KeeprDigital/stream-keepr/issues/616)

### Decision

**Each component has its own promotion marker**, an annotated tag on `origin`: `production` for the app and `production-validator` for the validator. Its message records the component, a state, the commit, whether that checkout was dirty, who deployed it, and the validator's fingerprint. Every deploy marks its component `pending` before it changes anything remote, and `deployed` once it succeeded. Both deploy commands write the markers themselves: `pnpm run deploy` for the app, `pnpm deploy:validator` for the validator. So an emergency local deploy keeps them accurate too. A deploy whose pending marker cannot be written does not start.

**The validator deploys unless its marker records a confirmed deploy with the target's fingerprint.** The fingerprint is a sha256 of the bundle `wrangler deploy` would upload (the `validator:dry-run` bundle, source maps and README excluded), every file of the Container's Docker context, and `wrangler.jsonc`. A missing, unreadable or `pending` marker, an unknown fingerprint, and a checkout that cannot be bundled all mean deploy. The decision is the pure `decideValidatorDeploy` in `scripts/deploy-promotion.mjs`.

**The Deploy workflow runs the promotion from its own commit.** It checks the release out, and checks `scripts/deploy-promotion.mjs` out of the workflow's commit beside it. It then runs `promote`, which decides, deploys the validator between its markers, marks the app pending, runs the release's `pnpm run deploy`, and marks the app deployed. A release from before this decision can still be rolled back to, with markers. For releases after it, `pnpm run deploy` writes the app marker a second time, to the same states in the same order.

### Why

The one `production` tag stood for both components but moved only after the app succeeded. When the validator of B succeeded and the app of B failed, the tag still said A. Dispatching A then compared A to A and skipped A's validator, leaving A's app beside B's validator (#616). An emergency local deploy moved nothing, so the next comparison started from a wrong baseline. The detection diffed only `workers/silent-video-validator/`, but the Worker imports `@cloudflare/containers` from the root lockfile. A dependency-only change altered the deployed bundle and was skipped.

### Consequences

- The validator's decision, fingerprint, markers and workflow wiring are unit-tested without running git, wrangler or any remote command (`deployPromotion.test.ts`). Production and the marker remote are faked in memory, covering partial failure, rollback and emergency deploy histories. Only a real Deploy run proves the tag writes against GitHub and the deploys against Cloudflare. The real bundle's stability was measured by hand: it contains no absolute or temporary path, and two bundles into different directories hash the same.
- A marker write is a force-push with no compare-and-swap, so the last writer wins. The workflow's concurrency group serialises Deploy runs, but a local deploy during one is not prevented. An annotated tag also pushes the commit it points at, so a local deploy from unpushed commits puts them on `origin`. A local `tag.gpgSign` that cannot sign stops `pnpm run deploy` before its migration.
- The marker format is read by the workflow's commit and written by each release's copy of the script, so it is append-only: add fields, never rename one. The header line is what makes a message a marker.
- The first Deploy after this lands finds no `production-validator` marker, so it redeploys the validator once. The old lightweight `production` tag reads as unreadable until the first deploy replaces it. The environment's deployment-records fallback and the `deployments: read` permission are gone.
- A `pending` app marker after a failure is left until the next deploy confirms one. Rolling the app back from the dashboard or with `wrangler rollback` is not recorded.
- Deploying the validator around its command (bare `wrangler deploy`, a dashboard rollback) bypasses its marker. Recovery is `validator: always` or `pnpm deploy:validator`.
- The fingerprint does not cover the Docker engine or how wrangler builds the image. The Dockerfile pins its base image by digest and its packages to a Debian snapshot, so the context is the image's input. A wrangler upgrade that changes its bundle output redeploys the validator.

### Rejected alternatives

- **Widen the path diff to every input** (the validator folder, `package.json`, `pnpm-lock.yaml`, `shared/`). Release-please bumps `package.json` on every release, so the validator would redeploy every time. Narrowing it to the dependency entries is a list that goes stale silently when the Worker gains an import.
- **Record the fingerprint in Cloudflare** (`wrangler deploy --tag`) and read the deployed version back. That keeps a dashboard rollback accurate, but whether a Worker version's rollback also rolls its Container back is unverified. Reading it back needs the API in the decision, and none of that can be proven without deploying.
- **Move one marker after both components succeed.** It still cannot say "B's validator, A's app", which is the state a rollback must repair.

## ADR-0036: The merge queue verifies the exact revision that lands, and only such a revision is released

Accepted · 2026-10-21 · [#615](https://github.com/KeeprDigital/stream-keepr/issues/615) · Amended 2026-10-21: a merge group reuses a full, green PR run's verification of a byte-identical tree

### Decision

**Every change reaches `main` through GitHub's merge queue.** The queue squashes a PR onto `main` plus every PR queued ahead of it, and CI and the title check run on that combined commit (`merge_group`). `main` fast-forwards to that very commit only if both pass, and each queue entry must pass on its own (`ALLGREEN`). The revision that must pass before it can land is therefore the exact commit `main` moves to.

**A release is cut only from such a revision.** release-please tags the Release PR's merge commit, so the Release PR goes through the queue like any other change. Before release-please runs, `scripts/release-gate.mjs` refuses any merged Release PR still awaiting its tag whose merge commit has no successful `merge_group` run of CI. A release, and so a Deploy candidate, cannot come from a tree the queue did not test, even if a ruleset bypass or a merge while the queue was off put one on `main`.

**Both required checks report in the queue.** `CI passed` (ci.yml) and `Conventional Commit title` (pr-title.yml) run on `merge_group` as well as `pull_request`. A required check that never reports holds the group until the queue's timeout. In the queue, the title check reads the subject of every squash commit the group lands, which is exactly what release-please reads. CI's scope decision measures a merge group against the queue's base (`merge_group.base_sha`), not `HEAD^1`, and runs everything when it cannot measure (`scripts/ci-scope.mjs`). PR runs stay for feedback, and because the queue admits only a PR whose required checks passed.

**A merge group skips the gates only for a tree a full, green PR run already verified.** In practice that is a group of one PR whose `main` has not moved since its PR run. The guarantee is tree equality: the group's tree is byte-identical to the merge commit tree of a `pull_request` run of `ci.yml` in which every job ran and passed, none skipped by its scope. The tree includes `ci.yml` and every script it runs, so that run executed exactly the code the group's own run would. The PR run's `record` job leaves the evidence, an artifact holding an OIDC token GitHub signed for that job. In the queue, `scripts/ci-reuse.mjs` accepts it only if:

- the signature is GitHub's (`token.actions.githubusercontent.com` JWKS, RS256);
- the claims are this repository's (name and id), `event_name` `pull_request`, `workflow_ref` `ci.yml`, a GitHub-hosted runner, the uploading run's id, and `workflow_sha` equal to `sha`;
- the tree of the commit the token names (`sha`, the merge commit the run executed) is the group's;
- GitHub's run and jobs API shows that run completed with every job a success.

`CI passed` then reports success with the gates skipped, and the scope job's `verified-by` output names the run. Anything else runs everything: no record, an expired or oversized one, a bad signature or claim, another tree (a moved `main`, a multi-entry group), a skipped, failed or unfinished job, an API or network error. The title check still runs in the queue, and so does the release gate's check, which a reused run satisfies as a successful `merge_group` run for that exact commit.

### Why

CI ran only on PRs, and the ruleset did not require a PR to be up to date with `main`. Two PRs that each passed against the same old `main` could merge one after the other, and nothing ever tested the combined tree. A later release could ship it (#615). Squash-only merging does not change that.

Running the queue made most merges run full CI twice on the same tree, about ten minutes each: once on the PR, which the queue requires, and again on the group when `main` had not moved. Reusing the PR run halves that without weakening "the tree that lands passed CI". The record must not be self-attested, though. A `pull_request` run executes the PR's own workflow code, so one push could upload a fake artifact, write a commit status, or claim any tree, then push an honest `ci.yml` back. GitHub's record of a run names only the PR head, not the merge commit it tested. The OIDC token is the one fact about a run that its code cannot choose: GitHub signs which commit the run executed. A PR cannot get a token naming a commit whose tree is the group's unless it actually ran the group's code. What remains is what the queue already trusted: a PR that edits `ci.yml`, `ci-scope.mjs` or `ci-reuse.mjs` controls its own group's run, with or without reuse. Because reuse requires tree equality, that edit has to be in the diff that lands, so review is the control, as before.

### Consequences

- The ruleset is the enforcement: the merge queue rule and the two required checks on `main`. Agents do not change it; the maintainer applies it. The settings are listed in the PR that landed this. The maintainer kept one bypass actor, repository admins in pull-request mode ([#615](https://github.com/KeeprDigital/stream-keepr/issues/615#issuecomment-6307069465)): an admin can merge a PR around the queue, never push to `main` directly, and the release gate refuses to tag a Release PR that landed that way.
- Release PRs need a maintainer to approve their CI. release-please writes them with the default workflow token, and GitHub creates the `pull_request` runs that token triggers as `action_required` instead of starting them. A maintainer selects "Approve workflows to run", waits for green, then queues the PR alone. Queued behind another PR, the release would tag that change without its changelog line, and any push to `main` rewrites the Release PR and drops it from the queue. Before this, Release PRs never got the required checks and an admin merged them through the ruleset bypass, so that bypass is no longer needed. A GitHub App token for release-please would remove the approval step.
- The scope decision, the title check, the release gate and the workflows' wiring are unit-tested without GitHub (`ciScope.test.ts`, `conventionalTitle.test.ts`, `releaseGate.test.ts`, `ciWorkflows.test.ts`). The scope test runs the script against real shallow git checkouts. That GitHub delivers `merge_group` events, that `main` lands on the tested commit id, and that the queue's squash subjects are PR titles is proven only by an observed queued merge.
- The release gate runs from `main`'s workflow and blocks every release-please run while an unverified release is pending. It waits up to two minutes for a merge-group run still concluding, since the queue merges on the check a moment before the run finishes. Recovery is by hand (README.md § Releases).
- Every workflow file now counts as code for CI's scope, because each is held by wiring tests that only run when CI does. Editing `deploy.yml`, `pr-title.yml` or `release-please.yml` runs the gates, but not the Worker build.
- Docs-only changes still skip CI's code gates in the queue, and run only what those gates check of a document: the Markdown lint and the documentation link test (`pnpm verify:docs`, a step of the `checks` job, #1028). That is sound while nothing bypasses the queue, because the queue's base then passed its own run. If something did, the next Release PR's group still tests the whole tree before a release.
- A reused group run takes about a minute instead of ten. The first queued merge after this lands shows which path it took. A reused run has its gates skipped, and the scope job's log and `CI passed` name the PR run. A full run logs why each record was rejected. A PR run of a docs-only or tests-only change records nothing, because it skipped gates, so its group runs everything except what its own scope skips.
- The record is a real OIDC token in an artifact that anyone who can read this public repository's artifacts can download. It is short-lived and minted for the audience `stream-keepr:ci-verified-tree`, which no cloud provider or other relying party accepts, and this repository trusts GitHub's OIDC tokens nowhere else. Artifacts are kept 30 days; a PR queued later runs in full. A JWKS key rotation between the PR run and the group also only costs a full run. The token's expiry is ignored on purpose: it is read as GitHub's signed statement about a past run, never presented as a credential.
- Fork PRs get no token, so their groups always run in full.
- The decision is unit-tested against a locally generated signing key and fake GitHub reads (`ciReuse.test.ts`), and the record job's command line against a stand-in OIDC endpoint. That GitHub's `sha` claim is the PR's merge commit, and that the artifact and API reads work with the job's token, is proven only by an observed queued merge. If either is wrong, groups simply run in full.

### Rejected alternatives

- **Require PRs to be up to date with `main`** (strict status checks). It verifies the same combined tree, but each PR must be rebased and re-run by hand after every merge ahead of it, and a release still relies on nobody merging out of order.
- **Verify `main` or the release revision after merge, before publishing.** This catches a broken combination only after it is on `main`, and needs CI on `push` plus a release that waits for it. The queue proves the same revision before it lands.
- **Reuse on a record the PR run writes for itself**: an artifact, a check-run summary or a commit status naming the tree. The PR's own workflow code writes it, so any PR could claim a tree it never tested and then land honest code on top of that claim.
- **Reuse by PR head commit**: skipping when the PR head's PR run passed. That run tested the head merged into whatever `main` was then, not the group's tree.
- **Sigstore artifact attestations** (`actions/attest`, `gh attestation verify`). They are the same OIDC binding with more machinery: a transparency log, an `attestations: write` grant, and a CLI verification step. The bare token checks the same claims with `node:crypto` and nothing to install.
- **Skip the title check in the queue** by making it non-required there. Rulesets require the same checks for PRs and merge groups, and the queue's squash subjects are what release-please reads, so checking them is the stronger check.

## ADR-0037: A Screen Mode's config has one contract, and a default lives only in it

Accepted · 2026-10-21 · [#587](https://github.com/KeeprDigital/stream-keepr/issues/587), [#588](https://github.com/KeeprDigital/stream-keepr/issues/588), [#589](https://github.com/KeeprDigital/stream-keepr/issues/589) · Amended 2026-10-21: a contract field carries its editor control's metadata, and a stored value outside a bound reads clamped · [#498](https://github.com/KeeprDigital/stream-keepr/issues/498) · Amended 2026-10-22: a dropped field is a former field, which a stored config may still carry · [#752](https://github.com/KeeprDigital/stream-keepr/issues/752) · Amended 2026-10-22: the Metagame Scope is a shared sub-shape with one settings component · [#777](https://github.com/KeeprDigital/stream-keepr/issues/777) · Amended 2026-10-27: a former field may be a nested block's field · [#824](https://github.com/KeeprDigital/stream-keepr/issues/824) · Amended 2026-11-04: one component renders an editor field from its contract metadata · [#958](https://github.com/KeeprDigital/stream-keepr/issues/958) · Amended 2026-11-04 by ADR-0072: a Mode Token carries its Screen Settings Group the same way · [#968](https://github.com/KeeprDigital/stream-keepr/issues/968)

### Decision

**A Screen Mode's config is defined once, as a config contract on its Screen Mode Definition** (`config` in `shared/screenModes.ts`, built with `defineScreenModeConfigContract` in `shared/screenModeConfigs/`). The contract holds the mode's own fields as a zod shape and a complete `defaults` value. The config type is inferred from the shape (`ScreenModeConfigOf`, the schema's input, so a nested value a reader re-proves keeps its authored form), and `defaults` is typed by it, so a type that disagrees with its schema, or a default of the wrong type, is a compile error. `getDefaultConfigForMode` reads the contract's `defaults`.

**A default lives only in the contract's `defaults`.** A contract field may not carry a zod `.default()` or `.prefault()`; the type refuses one. A schema default was a second copy, and zod 4 applies it even through `.optional()`, so it leaked into every PATCH that left the field out.

**A field whose schema reaches server-only Graphic Asset ids is server-validated.** The Background Screen's `layers`, the Broadcast Graphics `graphics` stack and the Feature Match Overlay `layout` are declared in the contract as `serverValidatedField<T>()`, which fixes the field's type and default and refuses every value in the contract's own schema. The server supplies the field's schema when it derives the mode's forms, typed so that what it produces is a `T`, the check a `satisfies z.ZodType<T>` made before; a server-validated field left without a server schema fails to compile and refuses to boot. `T` is the hand-written `BackgroundLayer[]`, `BroadcastGraphicConfig[]` or `FeatureMatchLayoutConfig`, which the server schema is checked against. Everything else these modes carry, such as Broadcast Graphics channels and background, is an ordinary contract field.

**An authored stack is declared on the contract** (`authoredStacks`): a list field holding authored content with no recovery path, the Background Screen's `layers` and the Broadcast Graphics `graphics`. A display reset leaves it, and its PATCH form is only `.optional()`, so `null` cannot delete it and empty it. Every other field's `null` deletes the stored key, which then reads as the default.

**The write forms are derived on the server without special cases** (`configContractModeForms`). The complete schema is the contract's fields, with the server's schema for each server-validated one, plus `backgroundLayers` when the mode declares a Background Layer stack. Screen create and full update accept a fragment of it, because storage holds fragments. The PATCH form is every field `.nullable().optional()`, except each authored stack, with no wrapper peeled and no default stripped. The server's schema maps are built from one per-mode list of these forms.

**Every Screen Mode is on its contract.** Metagame moved first (#587), then the other plain overlay modes (#588), then Background, Feature Match, Feature Match Overlay and Broadcast Graphics, after which the old form was deleted: the hand-written mode config types, the separate defaults objects, and `createModeConfigPatchSchema` with its wrapper-peeling (#589). A contract module holds the mode's own sub-shapes and the defaults its readers complete a nested fragment from, such as Deck's board layouts and `resolveDeckBoards`; a sub-shape several modes repeat, such as a table column, the header, the Page Rotation fields, or the Metagame Scope with its archetype filter (#777), lives once in `subShapes.ts`. The Metagame Scope's settings fields are one component too (`ScreenMetagameScopeFields`), and every mode reading the Metagame carries the whole scope, so each offers the same scopes. Most Played Cards carried no `minPoints` until #904 gave it Minimum Points. Before then a Most Played Cards config scoped to `minPoints`, which only the API could store, failed its Screen Output read with a 400, since the read query asks for a minimum under that scope. It now reads with its stored minimum, or the default. `test/unit/server/schemas/screenModeConfigContracts.test.ts` parses every contract's defaults against its complete schema and both write paths, round-trips them through a PATCH, takes each field alone and `null`, and checks each authored stack refuses `null`.

**A contract field may carry its editor control's metadata, and its editor reads the control from the contract** (#498). A field edited by a scalar control (a number, toggle, select, colour or text input) is declared with `editorField(schema, meta)` in `shared/screenModeConfigs/fields.ts`, which puts the meta on the field through zod's `.meta()`: the label, a step, a control hint where the schema cannot say (a colour rather than text), and a display scale for a field edited in another unit (Page Rotation's milliseconds, edited in seconds). The bounds are not in the meta: they are the schema's own inclusive `.min()` and `.max()`, read back. The default is not in it either: it stays in `defaults`, and `FieldsWithoutDefaults` still refuses a `.default()` or `.prefault()` under an editor field. The contract derives `fields`, the editor-facing view of every editor field, through `screenModeConfigFields`, as `animationEffectParamFields` does for an Animation Effect's params, except that it reads no default from the schema. A sub-shape several modes repeat carries its meta once, in `subShapes.ts`; a nested block derives its own view, as Deck's board layout does (`DECK_BOARD_LAYOUT_FIELDS`). Rich controls stay bespoke and carry no editor meta: an authored stack, a server-validated field, an Event Reference picker (ADR-0038), a column list, and a preset choice. A Page Rotation field's label and bounds come from the contract, but its edit still goes through `useRotationConfigWrites` (ADR-0039). One component renders a field from that view (`ScreenConfigField`, #958): its control by kind, its label, bounds and step, a display-scaled field in displayed units emitting stored ones, an emptied optional field as the `null` that deletes it (ADR-0041), and a toggle's feature gate, under which it shows off and never writes. Each carries `data-config-field` with its key; a bespoke control takes the same layout (`ScreenSettingsField`). A Mode Token carries its editor meta on the token in the same way: the Screen Settings Group whose Look renders its Screen Theme Override (`settingsGroup`, ADR-0072).

**Where an editor and its contract disagreed, the editor's range was the product range, and the contract now holds it.** A stored value outside a tightened bound is clamped into range when read, never reset to the defaults and never refused: `contract.readStored` pulls each stored number outside its field's inclusive bounds to the nearest bound, nested blocks included, and leaves everything else to the reader as before. `resolveScreenModeConfig` applies it for every rendering and server reader, and `mapScreenToResponse` (`clampStoredModeConfigs`) for every Screen a client receives, so an editor that writes a value back, such as Deck's whole board block or the Edit Screen dialog's full write, sends one in range. Storage keeps what it held until a write replaces it. Writes outside the bounds are refused as before.

**A field a contract drops is declared a former field, and a stored one still loads and saves** (#752). Top Cut Bracket's placeholder `bracketSize` went when its bracket came to be derived from a Phase; Screens may still store it. `defineScreenModeConfigContract(shape, defaults, { formerFields })` names such fields, and they may not also be fields of the shape. `contract.readStored` drops them before clamping, so no reader or client sees one. The `stored` and `patch` write forms drop them before validating, so a client that read a Screen before the field went, and sends it back in a full write or a stale display reset, is accepted rather than refused on an unknown key. `mergeScreenModeConfig` drops them from what a PATCH stores, so the next write of the mode's config removes the field from storage. Every other unknown key is still refused. A field of a nested block is named by its path, as Deck's board blocks name theirs (`mainboard.cardGap`), and is dropped from that block alone (#824).

### Why

Each mode's config was written twice, as a type and as a schema, and its defaults sometimes in both. Only 4 of 11 schemas were compile-checked against their type, and the PATCH form was derived by peeling wrappers, which broke on Metagame's duplicated defaults. The old form also refused a full write of a stored fragment, so the Edit Screen dialog could not rename a Screen whose stored config lacked a required field.

The editors then hard-coded their controls' labels and bounds, and drifted from the contracts: Card's editor offered a scale of 0.5–2 where the contract accepted 0.1–5, and Deck's offered columns, card gap and stack overlap ranges its contract did not hold (#498). ADR-0037 forbade only a second copy of a default, so editor meta on a field breaks nothing it decided. Clamping rather than resetting keeps a production Screen's tuned config when its bound tightens; refusing the read would leave the Screen unrenderable over a value its operator could not see.

### Consequences

- Readers complete a stored fragment from the contract's defaults (`resolveScreenModeConfig`), as before. A full write no longer fills Metagame's `minPoints` and `archetypeLimit` into storage, so a later change to either default reaches every Screen that never set it.
- A full write accepts what storage holds: a PATCH-built fragment, or what a display reset leaves, which lacks the preserved keys. The Edit Screen dialog sends `modeConfigs` back as it read them, so a rename no longer fails on a fragment, in any mode. Field bounds and unknown keys are still refused.
- `ModeConfigsMap`, the `modeConfigs` column's type, types each stored mode config as a fragment, which is what storage holds, and the full write's output matches it without a cast. Typing it honestly found two readers that took a fragment for a complete config: the Broadcast Graphics Live Session read the stack from a fragment without `graphics`, and saving or exporting a Feature Match Layout read `layout` from a fragment without one. Both now complete the fragment from the defaults, so they read what the Screen renders.
- Deck's PATCH form is derived like every other mode's (#588), so it no longer turns a `playerId` shorthand into a Deck Source; a PATCH carrying `playerId` is refused as an unknown key. No client has sent it since #514. Like every contract field, `deckSource: null` deletes the stored key, and a full write may now omit it; either way it reads as the default Deck Source, no Player.
- On the old form a required field refused `null` in a PATCH, by accident of the derivation. On the contract, only an authored stack does, by declaration. Feature Match's display flags and the Feature Match Overlay's `presetId` and `layout` now take `null`, which reads as the default, as a display reset does.
- The Feature Match Overlay's config type is inferred from its contract's shape rather than from the contract, because its defaults come from the Feature Match Overlay Presets, which are typed by it.
- The contract carries only the mode's own fields. The Background Layer stack every plain overlay mode carries stays a server-side addition driven by the Screen Mode Definition's `backgroundLayers` declaration. A display reset leaves it, but its `null` still deletes it, as before: it is optional content behind a mode rather than the mode's own config, and refusing that `null` would change every plain overlay mode's PATCH, which is a separate decision. Worth reopening if an editor ever sends it.
- An editor offers exactly its contract's range, since the bound has one copy. `test/nuxt/components/Screen/Modes/settingsEditorFields.test.ts` runs over `SCREEN_MODES`: it mounts every mode's settings editor, drives each scalar control, and fails if the contract field it writes carries no editor meta, or if its label, bounds, step or select options differ from the contract's. A select must offer exactly its field's values, less any listed there as not offered: an enum value cannot be clamped to a nearest one, so a contract wider than its editor is left for a decision rather than tightened. It also fails if an editor field is never rendered. A mode whose editor has no scalar control is listed there with its reason. A field rendered by `ScreenConfigField` is found by its `data-config-field`, which must name an editor field of the contract and the field its control writes.
- The bounds #498 tightened are listed in its PR, each with the editor range it adopted. A Screen storing a value outside one renders and edits it as the nearest bound until its next write of that field, or of the block holding it, stores the clamped value.
- The clamp reads only inclusive number bounds. A string over its length cap, a list over its count cap, or a number under an exclusive bound such as `.positive()` reads as stored, as before, because no nearest allowed value exists to clamp to.
- `test/unit/server/schemas/formerModeConfigFields.test.ts` shows a Top Cut Bracket Screen storing `bracketSize`, and a Most Played Cards Screen storing the badge colours that became Mode Tokens (#823), reads without them, saves through a full write and a PATCH that still name them, and loses them on its next PATCH.

### Rejected alternatives

- **Put every default in the schema as `.default()` and derive `defaults` by parsing `{}`.** It needs default stripping on the PATCH path, which is the special case this removes, and a full write would freeze defaults into storage.
- **Keep the hand-written type and add `satisfies z.ZodType<…>` to each schema.** It catches a mismatch but keeps two copies and leaves defaults unchecked.
- **Move the asset-id schemas behind a shared seam, so the contract holds them.** The Broadcast Graphics stack's schema is most of `server/schemas/api/screen.ts`: the Shared Graphics Foundation vocabulary and the whole-Screen caps. Moving it to `shared/` is a large move for no new check, since the server schema is already compile-checked against the contract's type.
- **Add server-only fields to the complete schema outside the contract, as `backgroundLayers` is.** The contract would not hold the mode's whole config, so its type and defaults would still be written elsewhere.
- **Keep refusing `null` for every required field.** It conflates "the field must be present in a complete config" with "deleting it loses authored work", and only the second is a reason to refuse.
- **Reset a stored value outside a tightened bound to the default, or refuse it on read** (#498). Either loses a production Screen's tuned config over a range change its operator did not make; the nearest bound is the closest the contract now allows.
- **Clamp in the write path, so a write outside the bounds is accepted and stored clamped.** It would weaken validation for every client to repair what only stored data needs. Reads clamp, and writes are refused as before.
- **Put the editor's labels and bounds in a separate editor-only table.** It is a second copy of the bounds, the drift this removes. The meta lives on the field, as an Animation Effect param's does (#473).

## ADR-0038: A Screen Mode Definition declares its Event References, and the Screen write derives its checks from them

Accepted · 2026-10-21 · [#585](https://github.com/KeeprDigital/stream-keepr/issues/585)

### Decision

**Every Screen Mode Definition declares its Event References** (`eventReferences` in `shared/screenModes.ts`, next to `config`): each config field naming something that must belong to the Screen's Event, and the kind it names. The kinds are a Phase (#752), a Round, a Player, a Player List, a Feature Match Slot and an Archetype (#761), each by id, and a whole Deck Source. A mode with none declares `{}`. The declaration is required, so a mode added without one fails to compile. A declared field that is not one of the mode's contract fields, or does not hold what its kind names, also fails to compile.

**The Screen write path derives its Event checks from the declaration alone.** `validateScreenModeConfigReferences` checks each declared field of the written config by its kind, through one check per kind (`EVENT_REFERENCE_CHECKS`, exhaustive over the kinds). Every Screen write runs it: create, full update and a mode config PATCH. The per-mode switch it replaces is deleted.

**The checks are unchanged.** An id outside the Event is refused with 404, as before. A Deck Source naming another Event's Player is refused with 404, and a Broadcast Deck List that is not selectable with 409 `SCREEN_DECK_SOURCE_CONFLICT`. The Deck Source guard triggers (`screens_deck_source_insert_guard` and `screens_deck_source_update_guard`) stay. They prove the Deck Source again inside the Screen write's own statement, so a Player or Broadcast Deck List that goes away between the check and the write still cannot be saved.

The declarations are Card Spotlight, Feature Match Controls and Feature Match Overlay `featureMatchId` (Feature Match Slot), Deck List `deckSource`, Standings `roundId` and `playerListId`, Metagame and Most Played Cards `playerListId`, Player History `playerId`, Pairings `roundId` (#751), Top Cut Bracket `phaseId` (#752) and `manualBracket` (a whole Manual Bracket, whose Seeds may name Players, ADR-0075), Head-to-Head `featureMatchId` (Feature Match Slot), `player1Id` and `player2Id` (#760), Archetype Spotlight `archetypeId` (Archetype) and `playerListId` (#761), Round Clock `roundId` (#916), and Talent `talentId` (Talent) and `talentIds` (Talent lineup, an ordered list of Talent ids) (#782). Background and Broadcast Graphics declare none. A Broadcast Graphics stack declares only which kind each Graphic Source Selection picks; the pick itself is Live Session state.

### Why

The switch had no exhaustiveness check, so a mode it forgot was skipped without anyone noticing. It had forgotten Most Played Cards, whose Player List was never checked against the Event. Declaring the references on the Screen Mode Definition puts the question to every mode when it is defined, as the Background Layer declaration does for its stack.

### Consequences

- Saving a Most Played Cards Screen whose Player List belongs to another Event is now refused, as for Metagame. Screens already storing one are not repaired; their next write of Most Played Cards config must name a Player List in the Event, or none.
- `test/unit/server/modules/screenModeEventReferences.sqlite.test.ts` runs over every declared field, against real SQLite. It shows that create, full update and PATCH all refuse another Event's entity and accept the Screen's own. A new kind fails to compile there until it has samples. The test also lists the declarations, so adding or dropping one is a visible test change. It also checks that a display reset keeps every declared Event Reference, which `MODE_RESET_PRESERVED_KEYS` still lists by hand, among other preserved keys.
- The type-level check proves only that each declared field exists and holds an id or a Deck Source. Whether a new id field is an Event Reference is still the author's call, but they now have to make it on the definition.

### Rejected alternatives

- **Declare the references on the config contract** (as `authoredStacks` is). The key check would come for free. But what a field names in the Event is a capability of the mode, not part of its config's shape or defaults (ADR-0037). The Background Layer stack is declared on the definition for the same reason.
- **Infer references from field names** (`*Id`, `deckSource`). Nothing would have to be declared, but naming would become load-bearing. `presetId` and Graphic Asset ids would match the pattern without being Event References.
- **Keep the switch and add a `never` default.** That would catch a new mode but not a forgotten field. The ticket asks for the switch to go, not to be wrapped.

## ADR-0039: A paginated Screen Mode Definition declares its Page Rotation, and one rule decides its shape changes

Accepted · 2026-10-21 · [#586](https://github.com/KeeprDigital/stream-keepr/issues/586) · Amended 2026-10-22: Most Played Cards declares a Page Rotation over its grid rows · [#757](https://github.com/KeeprDigital/stream-keepr/issues/757) · Amended 2026-10-22: every paginated editor renders one shared Pagination card · [#775](https://github.com/KeeprDigital/stream-keepr/issues/775) · Amended 2026-10-23: the card counts the rows the Screen renders · [#780](https://github.com/KeeprDigital/stream-keepr/issues/780) · Amended 2026-11-03: a rendering reads the page size from its mode data · [#913](https://github.com/KeeprDigital/stream-keepr/issues/913) · Amended 2026-11-04: mode data takes its Screen context explicitly, and the page count shows its first load · [#914](https://github.com/KeeprDigital/stream-keepr/issues/914)

### Decision

**A paginated Screen Mode Definition declares its Page Rotation** (`pageRotation` in `shared/screenModes.ts`, next to `eventReferences`), naming the config field holding how many rows a page holds: Standings `rowsPerPage`, Metagame `pageSize`, Most Played Cards `rowsPerPage` (#757), Player History `rowsPerPage`, Pairings `rowsPerPage` (#751) and Archetype Spotlight `rowsPerPage`, over its pilots (#761). A mode that is not paginated leaves it out. The declaration is optional, as `backgroundLayers` is, because the compile check runs both ways: a declaring mode whose config lacks the shared Page Rotation fields (`pageRotationShape`) or a numeric page size field fails to compile, and so does a mode whose config carries any rotation field without declaring one (`PAGE_ROTATIONS_FIT_THEIR_CONFIG`). So a mode cannot rotate without declaring it, and the other eight need not write "not paginated".

**The rotation fields and their validation are written once**, in `shared/screenModeConfigs/subShapes.ts`: `pageRotationShape` with `DEFAULT_PAGE_ROTATION`, and `pageRotationPageSize` for the page size field each mode names itself. Each paginated contract spreads them (ADR-0037), so the server's write forms validate them identically. The type an operator surface reads them through (`PageRotationConfig`) is inferred from that shape, replacing the hand-written copy.

**One rule decides which edits change the rotation's shape** (`pageRotationEdit` in `shared/modules/page-rotation`): an edit of the declared page size field or of `autoPageIntervalMs`. While auto-page is on, such an edit restarts the rotation from page 1 by writing a Rotation Anchor of now. A page size edit also writes `currentPage: 1`, whether or not auto-page is on, because every page then holds different rows. Any other edit is written as it is, so nothing else re-anchors (ADR-0009).

**Every consumer reads the declaration.** A paginated mode's settings editor writes every edit through `useRotationConfigWrites({ mode, config, rowCount, saveConfig })`, whose `updateConfig` applies the rule and whose `totalPages` counts pages by the declared field; its `updateRotationShape`, which each editor had to remember to call, is deleted. Every paginated editor renders the one Pagination card (`ScreenPaginationSettingsCard`, #775) over what that composable returns: it edits the declared page size field through `setPageSize` and the page duration through `setPageDurationMs`, labels and bounds them from the mode's contract, and shows the page count the editor's `rowCount` gives, so no editor writes the rotation fields itself. A paginated mode's rendering pages through `usePaginatedScreenMode({ mode, config, rows })`, which reads the page size from the declared field and writes a page selection or Rotation Anchor only from an interactive surface. It returns that page size as `pageSize`, which a mode's data passes on wherever its rendering sizes by it, so a Display lays its rows out for it without naming the field; an ESLint rule (`eslint.config.mjs`) refuses a page size field read in `app/components/Screen/Modes`, outside the settings editors (#913). The three hand-wired copies of that paging and its writes are deleted. A display reset writes through the rule as well (`getDisplayResetForMode`). Screen Outputs still never write the Rotation Anchor.

### Why

Each paginated editor decided the rule separately, and the copies disagreed: a Standings page size edit re-anchored but left the manually selected page alone, while Metagame and Player History reset it to 1. The rotation's paging was also wired by hand into three renderings and its fields into a fourth type, each naming the page size field anew.

### Consequences

- A Standings page size edit now resets the manually selected page to 1, as Metagame's and Player History's did. Nothing else changes: a page duration edit re-anchors while rotating and leaves the manually selected page, on every paginated mode, as before.
- **Most Played Cards pages its grid by whole grid rows** (#757): its rows are the grid's rows of `columns` cards, so `rowsPerPage` counts grid rows and a page holds `rowsPerPage × columns` cards, each keeping its rank across the whole ranking. Its default `rowsPerPage` is the most cards a Screen can rank (60), so a Screen that never set it, at any card count and column count, shows every card on one page as before. An operator turning auto-page on lowers it to get more than one page. A `columns` edit changes which cards each page holds, not the rotation's shape, so it resets the manually selected page to 1, like the Most Played Cards data edits, and never re-anchors.
- Edits that change the row set rather than the rotation's shape, such as a Metagame scope or a Standings Round, still reset the manually selected page in each editor where they did, and never re-anchor.
- A display reset of a paginated mode goes through the rule too (`getDisplayResetForMode` in `shared/screenModeDefinitions.ts`, which `useModeConfigUpdate`'s `resetConfig` writes): it restores the default page size and duration, a shape change, so it restarts the rotation from page 1 and writes a Rotation Anchor of now only if auto-page is on once reset. The defaults turn auto-page off, so today a reset writes `currentPage: 1` and no anchor; neither `currentPage` nor `rotationAnchor` is a display default or a preserved key. The reset is written from the Screen's settings page, so Screen Outputs still never write the Rotation Anchor.
- The Metagame chart display (#754) is one page. It draws at most eight Archetypes and folds the rest into Other, so it gives the rotation no rows to page, and its editor hides the page controls. Its page size and page duration stay stored and apply again when the operator returns to a table. The eight-Archetype limit belongs to the chart's projection (`projectMetagameChart`), not to the contract: Top archetypes keeps its bounds (ADR-0037). Above eight, it still limits the table, and the chart draws eight plus Other.
- `test/unit/shared/screenModePageRotation.test.ts` lists the declarations, checks that every other mode carries no rotation field, and runs over every declaring mode from `SCREEN_MODES`: it carries the shared fields, validation and defaults, a page size or page duration edit re-anchors only while auto-page is on, and a page size edit resets the manually selected page to 1. `test/nuxt/modules/rotationConfigWrites.test.ts` shows a settings editor's `updateConfig` applies the rule, `test/nuxt/components/Screen/PaginationSettingsCard.test.ts` that the shared Pagination card writes through it whatever the mode names its page size field, and `test/nuxt/composables/screen/useModeConfigUpdate.test.ts` that a display reset does.
- **The editor's `rowCount` is the rows the Screen renders** (#780): each paginated editor sets up its mode's own data composable (`useEditedScreenModeData`), so it reads what the Screen Output reads, through its Screen Output read, and follows it by Screen Mode Data Freshness. It reads through the Screen as saved: the store shows an edit at once, but the server answers from what it holds, so the editor holds the Screen it reads through until its edit is answered, then reads again if the edit changed the read. `rowCount` is the count of the rows that composable pages. No editor estimates it from config (Most Played Cards and Metagame from the limit, Standings from the operator's roster) or counts it once on selection (Pairings, Player History, Archetype Spotlight). A manual page selection is clamped to that count's last page. Every mode-data composable takes its Screen context as an argument: a rendering passes the one its host provides, and `useEditedScreenModeData` builds one for the edited Screen (#914). No module-level override stands in for it, which held only while a composable's setup ran synchronously; an ESLint rule (`eslint.config.mjs`) refuses an injected context in mode data. Until the editor's rows answer their first read, on opening or once something is selected where nothing was (the mode data's `answered`), the manual page controls show they are counting (`aria-busy`) rather than "Page 1 of 1", which would read as an answer; a later read keeps the count it has.
- The shared Pagination card (#775) gives every paginated mode the same manual page buttons, labelled Previous and Next; Standings, Metagame and Most Played Cards had shown icon-only buttons.

### Rejected alternatives

- **A required declaration, `pageRotation: null` on modes that do not rotate.** It makes "not paginated" explicit, as `eventReferences: {}` does, but the reverse compile check already refuses a mode carrying rotation fields without the declaration, so the explicit answer would add seven lines and no check. An Event Reference cannot be detected that way: whether an id field names something in the Event is a judgement (ADR-0038).
- **Declare the rotation on the config contract and spread its fields from the declaration.** Pagination is a capability of the mode, not part of its config's shape (ADR-0038), and the contract already carries the shared fields.
- **Rename every page size field to one name, so the declaration needs no field.** It would need a data migration of stored Metagame configs for a name.
- **Apply the rule to every write in `useModeConfigUpdate`.** Every mode's editor would pass through Page Rotation code, and the rotation writes are already the paginated editor's write path. Only its display reset applies the rule, for the one write that bypasses that path.

## ADR-0040: Melee Sync keeps an imported Phase or Round holding manual structure, as manual structure

Accepted · 2026-10-21 · [#701](https://github.com/KeeprDigital/stream-keepr/issues/701)

### Decision

**Removing imported structure never removes manual structure beneath it.** The schema cascades a Phase delete through its Rounds and a Round delete through its Matches, and an operator may add a manual Round under an imported Phase or a manual Match under an imported Round. So deleting a stale imported ancestor outright took the manual structure with it. Now every removal of imported Phases and Rounds goes through one builder, `buildRemoveImportedStructureQueries` (`server/services/importedStructure.ts`), in one batch:

1. the scope's imported Matches and Round Standings are deleted, as removing the Round would have done;
2. a scoped Round that still holds a Match (by now only a manual one) is **kept, with its Provenance cleared**: `externalSource` becomes `manual`, and `externalId` and `lastSyncedAt` become null;
3. the other scoped Rounds are deleted;
4. a scoped Phase that still holds a Round (a manual one, or one kept in step 2) is kept the same way, and the other scoped Phases are deleted. A kept Phase keeps its `formatExternalId`, because that is still the format it was played in and Deck Lists are matched to its Matches by it;
5. every Screen reference to a deleted Phase or Round is unset (ADR-0060).

**Two paths use it.** Event structure sync scopes it to the stale imported Phases and Rounds. The Melee data reset (disabling the integration, or changing its Melee.gg tournament) scopes it to every imported Phase and Round in the Event. Round Match sync already deletes only imported Matches, so it needs nothing.

**The operator is told which structure was kept, through the warnings each answer already carries.** One sentence per kept Phase or Round names it, and a Round's sentence names its Phase too. A sync's warnings appear in its result toast as before. The configuration answer gains the same optional `warnings`, which the Melee configuration card shows in a warning toast. The reset's confirmation says beforehand that manual Rounds and Matches stay. The structure sync's `melee:structureSynced` change set lists a kept Phase or Round as updated.

### Why

Melee Sync promises to preserve manual structure, and the cascade broke that promise wherever the manual record sat under an imported one.

**Keeping the record is better than refusing the removal.** A refusal would fail or stall the whole structure sync, or the reset, until the operator moved or deleted their manual Rounds, and the reset is a deliberate operator action that should finish. Keeping the record finishes the sync or reset, keeps every identity and relationship (Round ids, Match ids, Feature Match Assignments and their Notes), and needs nothing from the operator.

**It is kept as manual structure, not as a stale imported record.** A kept record that still carried Provenance would still count as Melee-managed (`isMeleeManagedRound`). Update would then try to sync Matches for a Round Melee.gg no longer has, and after a reset there would be Melee-owned structure with no integration behind it. Clearing Provenance needs no schema change, and a repeated sync leaves the record alone: it is manual now, and it is reported only once, when it is kept.

### Consequences

- If Melee.gg later brings back a Phase or Round with the same identity, Melee Sync imports a new one beside the kept manual record rather than adopting it. Upstream identities are not normally reused, and the duplicate is visible and can be deleted.
- The reset now also deletes an imported Round an operator moved under a manual Phase, unless it holds a manual Match. Before, such a Round survived the reset still carrying Provenance.
- A kept Round loses its Melee-synced Round Standings along with its imported Matches, as removing the Round would have done.
- Each step's predicate is evaluated when the batch runs, so a manual Round or Match added after the caller read the structure is still kept.
- `test/unit/server/modules/meleeStructurePreservation.sqlite.test.ts` proves all of this on SQLite with the real migrations and foreign keys enabled: a stale Phase holding a manual Round, a stale Round holding a manual Match and its Assignment, imported-only stale structure still removed, a repeated sync changing nothing and warning nothing, and the reset. `test/integration/integrityAndReset.test.ts` covers the reset's answer over HTTP.

### Rejected alternatives

- **Refuse the removal while manual descendants exist.** See Why: it blocks a sync or reset on operator clean-up.
- **Keep the stale record with its Provenance, and skip it in Round Match sync.** Every reader of `isMeleeManagedRound` would need to know about it, and a reset would leave Melee-owned structure with no integration. A sync would also repeat the warning every time until the operator cleaned up.
- **Change the foreign keys from `cascade` to `restrict`.** Deleting a Phase or Round by hand would then need its children deleted first, and the sync would fail instead of finishing.

## ADR-0041: A Screen write owns only its fields, finishes for its own Event, and sends a cleared field as a deletion

Accepted · 2026-10-21 · [#703](https://github.com/KeeprDigital/stream-keepr/issues/703)

### Decision

**The client shows a Screen as its newest server revision with every unsettled write's fields laid over it** (Field Ownership, in `app/modules/screen/runtime.ts`). Each write owns the fields it names: an ordinary Screen update its top-level fields, a mode-configuration write the config fields it patches, and a Screen Theme Override write the tokens it names. A revision from any door — a write's answer, a conflict refresh, an announced reload, a load — replaces only the revision underneath, and only when it is not older than the one held, so nothing moves a Screen's `stateVersion` backwards. A write that settles drops only its own fields. A failed write therefore rolls back to what the server holds now, keeping a remote change that landed meanwhile, and never over a newer local edit. A write answers its caller with the newer of its answer and the server revision held, never with another write's unsettled fields. A Screen deleted while a write to it was out stays deleted, whichever way the write ends.

**Every write of one Screen runs in one queue**, whichever part of the Screen it names, and is sent at the revision the write before it was answered with. Independent settings edited at once no longer race each other into a conflict.

**A Screen write keeps what it needs to finish for its own Event after that Event Lifetime ends.** The lifetime records the newest revision of each Screen it held or a write in it was answered with, and a write still queued when the operator moves on is sent, and its conflict retried, at that revision. Its store effects stay gated by the lifetime, as ADR-0024 decided: an answer, rollback or error from a finished lifetime touches nothing of the next one's. The caller is still answered, and a refusal still rejects it. This amends ADR-0024, whose "anything it starts afterwards" read as covering the write and its conflict refresh too: those now run for the ended lifetime, against its own record of revisions, and only their effects are gated.

**A settings surface hands off every queued edit when it ends**, whether or not its debounce has fired and whether or not a save is in flight (`useConfigUpdate`). An edit made during a save used to wait for that save's continuation, which ran after the reset had emptied the store, so it was lost.

**A field an edit names with `undefined` is sent as the `null` that deletes it** (`toModeConfigPatch`). JSON omits `undefined`, and the server reads an omitted field as unchanged (ADR-0037), so clearing an Archetype filter, custom header or Player List kept the old value. An authored stack named with `undefined` is left out instead, so a clear never empties one. Omission still means unchanged. The edit type (`ScreenModeConfigPatch`) takes `null` for every field without changing the complete config type, and the settings editors write `null` when an optional field is cleared. A cleared field reads as its contract default at once, so it does not snap back.

### Why

A write's v2 answer replaced a v3 the client already held. A failed write restored a whole snapshot from before it, erasing whatever had landed since. Resetting the Event stores during a save dropped the edit queued behind it, and a write retried after the reset was sent at version 0. A cleared optional field reached the server as nothing.

### Consequences

- Every write of a Screen waits its turn, so a mode-configuration and a Screen Theme Override write to one Screen no longer run concurrently. Writes to different Screens still do.
- A loader's revision is laid under unsettled edits too, so a page load cannot take back an edit still out.
- A display reset now clears a default that is `undefined`, such as a custom header, where it used to leave the stored one.
- An edit queued behind a save is sent once, by the hand-off, rather than by that save's continuation.
- `test/nuxt/stores/screenWriteOwnership.test.ts` orders every answer by hand against the store; `test/nuxt/composables/screen/screenSettingsSaves.test.ts` drives the configuration composable through an Event reset and a server that answers through JSON with the real PATCH schema and merge; `test/nuxt/components/Screen/Modes/clearingOptionalSettings.test.ts` clears each optional field in the Metagame, Most Played Cards, Standings, Player History, Pairings, Top Cut Bracket, Archetype Spotlight and Head-to-Head editors.

### Rejected alternatives

- **Gate write answers on the write's own per-key Flight**, as before. It refused an answer when a newer edit of the same key began, and a newer revision from anywhere else never stopped it.
- **Drain every write before the reset completes.** Navigation would wait on the network, and a write queued behind another would still need its revision from somewhere.
- **Treat `undefined` as omission and fix only the editors.** The display reset sends the contract's `undefined` defaults, and any other caller could repeat the mistake; the type system cannot refuse `undefined` without `exactOptionalPropertyTypes`.

## ADR-0042: A Screen Card's states are ordered by its Card revision

Accepted · 2026-10-22 · [#734](https://github.com/KeeprDigital/stream-keepr/issues/734)

### Decision

**Every Card state a holder is handed carries its Card revision, and a holder applies only one at least as new as what it holds.** The server already advanced `activeCardVersion` on each save and Clear. A save and a Clear now answer the revision they committed (`{ success, revision }`), `card:updated` and `card:cleared` carry it, and the operator and Screen Output Card reads answer `{ card, revision }`: the Card, or `null` for none or for one past its Card Timeout, beside the revision of the row they loaded. The Card store (`app/modules/card-screen/activeCard.ts`) holds the selected Screen's revision and refuses a save answer, Clear answer, read or announcement older than it. A refused write still answers its caller. A refused read has not landed (ADR-0028).

**The revision held belongs to the Screen selection.** A selection and the end of the Event Lifetime forget it, as they forget the Card, so the next Screen's first state applies whatever its revision. The Flights stay: #704's read Flight, and the selection and lifetime Flights of #726 (ADR-0024). The revision orders states within a selection. The Flights decide whether a continuation may touch the store at all.

**A display control shows its toggle without mutating the held Card, and a failed save puts back only that field.** `controlActiveCard` replaces the held Card with a copy carrying the toggled field and saves that copy. If the save fails, that field goes back to the Card last accepted, unless newer Card state was accepted since, the Screen selection changed, or a later control of the same field is still out, which owns the field now. Another control's field, still out, is left as it is.

### Why

Card messages and answers carried no revision, so the store applied whatever arrived last. A save or Clear answered after another operator's newer `card:updated` replaced it locally, and so did a late announcement of an older write. The read Flight (#704) ordered reads against everything else, but nothing ordered writes against announcements. `controlActiveCard` flipped `displayData` in place on the held Card and never restored it, so a refused save left the operator page showing a display the server did not hold.

### Consequences

- `card:updated` and `card:cleared` gained `revision` (`shared/types/messages.ts`). A Card read's answer changed shape from the bare Card to `{ card, revision }`.
- A Screen read still carries no Card and no revision (ADR-0022); only the Card read and the Card's own writes and messages do.
- The operator who saved hears no echo of their own write (self-origin), so the save's answer is what moves their held revision.
- A read that answers the revision held lands, so an expired Card read back as `null` at its own revision is accepted, which is what the clock already showed.
- A field goes back to what was last accepted, not to what its control found. A control can find another control's unsaved toggle, which the server never held.
- A read landing at the revision held while a control's save is out replaces the toggle until the save answers. That is a brief flicker towards accepted state, never a wrong final state.
- A control saved while another is still out is built on the first's toggle. If the first fails after the second saved, the second's save has been accepted, so nothing is put back, and the store shows what the server holds.
- ADR-0022 rejected a revision guard on the operator's expiry `DELETE` partly because no client held a revision. One does now. That rejection still stands: expiry writes nothing, so there is nothing to guard.
- `test/nuxt/stores/card.test.ts` orders every answer by hand against the real store ("card revision ordering", "controlActiveCard display controls"); `test/unit/server/api/cardExpiry.sqlite.test.ts` pins the revisions the real routes answer and announce over SQLite.

### Rejected alternatives

- **Order Card states by `savedAt`.** It is the writing Worker's clock, a Clear has none, and two saves in one millisecond tie.
- **Supersede every write on any later message, as reads are.** A save is the operator's and is sent whatever arrives meanwhile (#726). A Flight cannot tell whether the message it lost to was older or newer than the write.
- **Roll a failed display control back to the whole Card it began with.** That would undo another control still out, and any newer state accepted meanwhile.

## ADR-0043: A Screen Mode key renamed after release is migrated in storage and accepted in its former spelling on a write

Accepted · 2026-10-22 · [#773](https://github.com/KeeprDigital/stream-keepr/issues/773)

### Decision

**Top Cut Bracket's key is `top-cut`, not `topCut`**, the one camelCase Screen Mode key; its Screen Output read was already `top-cut`. Its label and five others changed with it (Card Spotlight, Deck List, Top Cut Bracket, Feature Match Controls, Most Played Cards, Head-to-Head). A label is the Screen Mode Definition's alone and changes freely. A key is stored, so renaming one takes a migration; only `topCut` was renamed.

**Migration `0001_since_v1_5_0`, in its `top_cut_screen_mode_key` section, moves every stored use of the key.** That covers a Screen's `current_mode`, the `topCut` key of its `mode_configs` (in whatever mode the Screen is now), and the `topCut.` root of the owner slots its Top Cut Bracket Background Layers index under in `graphic_asset_references`. A Screen holding both keys keeps the `top-cut` config, as a write does. Unlike ADR-0016's rename, this is a forward migration on released data, since ADR-0019's baseline is closed.

**A Screen write accepts the former key and stores the current one.** `FORMER_SCREEN_MODE_KEYS` (`shared/types/enums.ts`) maps each renamed key to its key now. The mode configuration PATCH route's `:mode`, and `currentMode` and the `modeConfigs` keys on Screen create and full update, read a former key as the current one. A `modeConfigs` carrying both keeps the current key's config. Every other unknown key is still refused, and nothing reads or answers a former key.

### Why

Deployed installations store `topCut` in all three places, and a key left behind in any of them is a Screen that no longer renders its mode, a config lost to a strict schema, or a Background Layer its output cannot resolve. A tab or Screen Output still running a build from before the deploy still sends `topCut`. Accepting it follows ADR-0037's former fields: a client that read a Screen before the change and writes it back is not refused over a spelling. Refusing would fail an operator's rename in the Edit Screen dialog, whose full write sends `modeConfigs` back as it read them, and the work in it would be lost.

### Consequences

- Nothing realtime or packaged carries a Screen Mode key that needed handling. `screen:updated` names only the Screen. Template Packages and Feature Match Layout Templates name only a graphics host (`broadcast-graphics`, `feature-match-overlay`), whose keys did not change.
- A tab or Screen Output on a build from before the deploy can still write, but it cannot render a Screen in `top-cut` mode, because its registry does not know the key. Reloading it, for example with the Screen `refresh` command, fixes it.
- The migration rewrites `mode_configs`, so the Deck Source update guard runs on each Screen it touches and re-proves that Screen's Deck Source, as on any write. A Screen whose Deck Source no longer resolves would stop the migration; the guards and ADR-0032 prevent one.
- `test/unit/server/db/topCutScreenModeKeyMigration.sqlite.test.ts` holds the migration back, stores the former key in all three places, and applies it. `test/unit/server/schemas/formerScreenModeKeys.test.ts` covers the write paths.

### Rejected alternatives

- **Rename the other keys to match their new labels** (`card`, `deck`, `top-cards`, `feature-match`). Each would take a migration of its own for no gain to an operator, who sees only the label.
- **Refuse a former key with a clear error.** It costs as much code as accepting it, and a stale tab's full write would fail rather than land.
- **Rewrite the baseline.** ADR-0019's squash was a one-time transition, and installations have applied `0000_baseline`.

## ADR-0044: An operator form settles on what its save stored

Accepted · 2026-10-26 · [#794](https://github.com/KeeprDigital/stream-keepr/pull/794)

### Decision

**A form save runs through `useForm`'s `runSave`.** It snapshots the form when the save is sent. Once the save resolves truthy, every value still as sent takes the baseline's, which the store has moved to the server's answer by then. A value the save normalized (trimmed, a blank read as null, numeric text as a number, an empty deck dropped) reads clean. A value edited while the save was in flight stays a change. A failed save, or one whose answer never reached the baseline, leaves the form alone.

**An Event config card owns its save through `useEventConfigForm`.** It bundles `useForm`, the page's unsaved-changes registration and the save: validate, map the changes to an Event update, `runSave(handleSubmit)`, one at a time. A card no longer emits its changes for the page to save, because an emit cannot report whether the save landed.

**`useForm` compares values regardless of object key order.** The #612 merge appends keys a new baseline adds, so the same values can arrive in another order.

**A form in an overlay modal guards itself through `useModalUnsavedChanges`.** The modal renders outside the page, so it can neither register with the page's guard nor use `onBeforeRouteLeave`. It guards navigation through the router, a browser unload, and its own close through `confirmDiscard`.

### Why

The #612 three-way merge keeps a local edit over a conflicting baseline. After a save that normalized a value, the operator's raw value and the stored one conflict, so the form kept the raw value as unsaved. Saving a Feature Match Slot's setup with a trailing space showed the success toast while Save stayed enabled and leaving warned. The Event Controls holding text did the same. A form told to treat itself as saved instead (`updateOriginal`, now removed) marked an edit typed while the save was in flight as saved, and leaving lost it without a warning.

### Consequences

- A save's answer must reach the form's `initialData` before the save resolves. The stores do this, since each writes the answer before it resolves. A form whose baseline the save sets itself, such as the Melee integration card, assigns its `initialData` ref inside the save.
- A guarded modal renders its own close button in the header's `actions` slot with `:close="false"`. Nuxt UI wraps its built-in close in reka-ui's `DialogClose`, which closes the dialog whatever the button's `onClick` does, so it cannot wait for `confirmDiscard`.
- A guarded modal renders its own close button in the header's `actions` slot with `:close="false"`. Nuxt UI wraps its built-in close in reka-ui's `DialogClose`, which closes the dialog whatever the button's `onClick` does, so it cannot wait for `confirmDiscard`.
- Talents keep their reset after a save. A staged Talent with no id merges in beside the one the save created (#612), so the card resets to the Event rather than settling.
- `test/nuxt/composables/ui/useForm.test.ts` and `useEventConfigForm.test.ts` cover the settle. The Feature Match panel, Event Controls and Event settings card tests have the mocked store write back a normalized answer, and the form must read clean.

### Rejected alternatives

- **Settle automatically on any baseline that follows a submit.** An optimistic update followed by a rollback would replace a failed edit with the old value, so a retry would have nothing to send. Only the save knows whether it landed.
- **Normalize in the form before comparing.** Each form would have to repeat the server's normalization, and drift between the two would bring the bug back.
- **Settle on the save's answer rather than the baseline.** Each form would have to map the answer to its own shape. The stores already do that through `initialData`.

## ADR-0045: A Slot setup edit to a seated Player's identity is a Player write

Accepted · 2026-10-26

### Decision

**A Feature Match Slot setup save that edits a seated Player's name, pronouns or LGS writes those fields to the Player.** `featureMatchSlotWriteModule().updateSetup` compares each side's submitted `name`, `pronouns` and `lgs` with the Player seated there (the side's `playerNId` in the save, else the Slot's) and sends the differences through `playerUpdateModule().updatePlayer`. An omitted field was not edited and is left alone. A cleared name is a Player write only for a Player with a Nickname to fall back to (ADR-0074); otherwise it stays on the Slot only, because a Player always shows by something. A side with no Player seated has nothing to write.

**Records, deck and archetype stay Slot snapshot fields.** A setup edit to wins, losses, draws, position, points, deck or archetype is held by the Slot only, and Melee Sync's standings reach it through Reverse Sync as before. The exception is a One Piece Card Game side linked to a Player: its Leader and Deck List are the Player's, so a setup save never writes them, and they are edited as the Player's Deck List (ADR-0074).

**The Player write runs before the Slot write, and is published with no origin.** Its Reverse Sync rewrites every Slot seating the Player, the edited one included, from the Player; the Slot write that follows then lands the rest of the save on the edited Slot, so a record edited in the same save is not overwritten. The saving client applied only the Slot, so it must receive the Player's and the other Slots' messages too.

### Why

Reverse Sync rebuilds a Slot's player snapshot from the Player after every Player write and Melee Sync. An identity edit held only by the Slot was therefore lost to the next round "Sync Matches": an LGS typed in setup was cleared because the Player had none. An operator expects one edit to a featured Player to hold across the Event, so the Player has to hold it.

### Consequences

- The write-through is an ordinary manual Player write, so a name or pronouns it changes becomes a Manually Edited Field and holds through Melee Sync (ADR-0046). LGS is never imported and holds anyway.
- A setup save that fails on the Slot write (a `409`, or the Slot deleted) has already written the Player. The Player's edit stands and the operator retries the Slot.
- `test/unit/server/services/featureMatchSlotSetupSurvivesReverseSync.sqlite.test.ts` holds the round-sync and One Piece Nickname cases against SQLite; `test/unit/server/modules/eventDataWrites.test.ts` holds the order and the missing origin.

### Rejected alternatives

- **Freeze a Slot's snapshot at promotion.** Standings and reviewed-deck corrections would stop reaching a featured Match, and the setup form would still disagree with the Players page.
- **Pin setup-edited fields on the Slot against Reverse Sync.** It keeps the LGS on one Slot, but the Player, other Slots and the next round still lack it, so the operator enters it again.

## ADR-0046: Melee Sync keeps a Player field an operator edited

Accepted · 2026-10-26

### Decision

**A Player records the Melee-imported fields an operator has edited, and Melee Sync stops writing them.** `players.manually_edited_fields` (migration `0001_since_v1_5_0`) is a JSON list drawn from `PLAYER_MANUALLY_EDITED_FIELD_VALUES`, `name` and `pronouns`. `playerService().update`, the one manual Player write behind the Players page and a Slot setup's write-through (ADR-0045), adds a field to it in the same statement when the write changes that field's value. The Melee bulk upsert (`buildBulkPlayerUpsertQueries`), shared by the Players sync and the Deck List sync, keeps the Player's own value for each listed field and takes Melee's for the rest.

**An edit is a change of value.** The Players page saves its whole form, so writing the value a field already holds marks nothing. Clearing a field is an edit: an operator who removes pronouns keeps them removed rather than taking Melee's.

**Records stay Melee-owned.** Wins, losses, draws, position and points are not in the list: a manual edit to one lasts until the next sync, as before. LGS and game data are not imported, so they never needed it.

**The column is server-managed.** It is classified so in `PROVENANCE_ENTITIES`, never accepted from a client, and not part of `PlayerResponse`.

### Why

The Melee upsert wrote `excluded.name` unconditionally, and `excluded.pronouns` as `null` whenever Melee held none. So an operator's rename or pronouns, from either surface, reverted at the next Players or Deck List sync, and Reverse Sync then carried the revert onto every Slot. An operator expects one edit to a Player to hold across the Event.

### Consequences

- Nothing hands a field back to Melee yet. A Player whose edited name later changes on Melee keeps the edited one until the field is removed from the list. A "reset to Melee" action is its own change.
- Players imported before the migration have no list, which is read as empty, so they behave as before until edited.
- `test/unit/server/services/playerManualEditsSurviveMeleeSync.sqlite.test.ts` covers both sync paths, a cleared field, an unchanged whole-form save, and an edit made in a Slot's setup.

### Rejected alternatives

- **Never let Melee blank a field** (`coalesce(excluded.pronouns, players.pronouns)`). It keeps pronouns Melee lacks, but a non-empty Melee value still overwrites an edit, and a rename still reverts.
- **Store Melee's value and the operator's side by side.** It supports a reset for free, but every reader of a Player would choose between two values. A list of edited fields answers the same question with one column.

## ADR-0047: A Match Result is Melee's alone, and holds its Game Score whole

Accepted · 2026-10-26

### Decision

**Only Melee Sync writes a Match Result.** `hasResult`, `player1GameWins`, `player2GameWins`, `gameDraws` and `isBye` are Melee-owned in `PROVENANCE_ENTITIES`, and the Match create and update schemas refuse them, so a manual Match write carrying one answers `400`. The Matches page's result modal is gone. A manual Match, including one ADR-0040 keeps, is a pairing with no result.

**Melee Sync stores a whole Game Score.** Melee sends a side's `GameWins`, and a Match's `GameDraws`, as `null` rather than `0` when there were none: a 2–0 arrives as `2` and `null`. `mapMeleeMatchToDbRow` reads such a `null` as `0` on a reported Match that is not a bye, and stores no game wins or game draws for an unreported Match or a bye, whatever Melee sends. So every reported Match that is not a bye holds both sides' game wins and its game draws, and a reader can trust `hasResult`.

**Melee's `ResultString` is no longer kept.** It is English from player 1's side ("Kim Fields won 2-0-0") that no Player-side reading can turn round, and it existed only as the fallback for a reported Match without game wins, which no longer occurs. Migration `0001_since_v1_5_0` drops `matches.result_string`. Player history, Pairings, Head-to-Head and Top Cut Bracket read the Game Score; the stored `match.result` Graphic binding keeps its id and resolves the Game Score from player 1's side.

**Migration `0001_since_v1_5_0`, in its `melee_owned_match_results` section, brings stored Matches to the same shape.** It clears every result on a Match not from Melee, gives a reported Melee Match its missing zeros, and removes game wins and game draws from unreported Matches and byes.

### Why

A reported 2–0 read as pending. `readMatchFromPlayerSide` needs both sides' game wins to name a winner, so in a local Event about a third of reported Matches showed "Pending" in a Player's history beside Melee's "won 2-0-0" text in the Result column; Head-to-Head called them `reported` with no winner, and Top Cut Bracket advanced no one. Normalising where Melee's payload enters fixes every reader at once.

Manual results were never meant to exist. A result entered by hand reached Player history, Pairings, Head-to-Head and Top Cut Bracket advancement while Melee's standings, which set every Player's record, never counted it, so the two disagreed.

### Consequences

- The migration clears results operators entered on manual Matches. They are not recoverable from the database afterwards.
- Melee's `HasResult` stays the authority on whether a Match is reported. A Match Melee sends with `HasResult: false` and game draws (seen once locally, as "0-0-1 Draw") is unreported until Melee reports it.
- `HeadToHeadOutcome` loses `reported` and an earlier Match's `gameScore` is never `null`.
- `test/unit/server/mappers/meleeMappings.test.ts` pins the mapping, `test/unit/server/db/meleeOwnedMatchResultsMigration.sqlite.test.ts` the migration, and `test/integration/matches.test.ts` the refused manual writes.

### Rejected alternatives

- **Treat a `null` as `0` in each reader.** Player history, Pairings, Head-to-Head, Top Cut Bracket and the Graphic binding would each need the rule, and the next reader would miss it.
- **Keep manual result entry for manual Matches.** Melee's standings would still never count those results, so a Player's record and their history would keep disagreeing.
- **Keep `ResultString` for display.** It cannot be read from the second Player's side, and with a whole Game Score nothing needs it.

## ADR-0048: A Player's name opens their match history

Accepted · 2026-10-27

### Decision

**Clicking a Player's name, on any operator page, opens that Player's match history, as clicking a deck name opens its deck list.** `PlayerMatchHistoryButton` (`app/components/Player/MatchHistoryButton.vue`) renders every such name. It takes the Player and, when the surface shows other text, such as a Match's snapshot name or "TBD", that text. A name with no Player behind it, like a seat filled by hand or an opponent off the roster, is plain text. The button carries no icon; it takes the hover colour the deck name uses.

It renders names on the Players page, Matches rows (both seats and the bye), the match history modal's opponent column, the deck list modal's title, the Feature Match live panel's seats and the metagame Players table. Surfaces that know only a name, like the card page's deck column headers and the sync page, stay plain text, as do pickers that choose a Player.

**A row on the Players page does nothing when clicked.** Edit Player is the first action in the row menu, and the menu no longer offers View Match History, because the name already opens it.

**The row menu is a `UDropdownMenu`, mounted only once its row's trigger is clicked**, so it has menu roles and keyboard navigation without a menu per virtualized row. Player Lists sit under Add to List, and a Screen send becomes a submenu (Send Deck to…, Send Match History to…) once more than one Screen could take it.

**On the Players page, `?player=<id>` names the Player whose history is open** (`usePlayerMatchHistoryLink`): arriving with it opens their history once the roster loads, and it follows the modal to another Player and away when it closes. Other pages open the modal without a link, since no shell is shared between them.

**Every name opens one modal.** `usePlayerMatchHistoryModal` is a shared composable, so opening another Player, an opponent from inside the modal included, replaces what the open modal shows instead of stacking a second one.

**The match history modal is a Player's detail view.** Its footer holds Edit Player, Deck List, the Player List memberships (checked, toggled in place) and Send to Screen, and each row with a roster opponent sends a Head-to-Head of the shown Player and that opponent to a Head-to-Head Screen, picking both directly (`playerSource: 'players'`). Its header gives the record as the Event displays records, the Players page's Record column does too, and the pronouns and LGS the Event shows. Opening an opponent from it remembers the way back, one Player at a time, until the modal closes. It reads the history itself through `usePlayerMatchHistory`, which follows the Event Data a Player History Screen follows (`playerHistoryDependencies`, Screen Mode Data Freshness), so a Match reported or a Melee Sync landing while it is open shows without reopening it.

### Why

The Players page opened Edit on a row click and kept history in the menu, while every other page showed names that did nothing. Viewing a Player's history is the expected default, and editing is the deliberate act. One meaning for a name everywhere means an operator learns it once.

### Consequences

- A new surface that shows a Player's name renders it through `PlayerMatchHistoryButton`.
- Without the shared composable, each button would create an overlay of its own through `useOverlay().create`, which never removes one.
- `test/nuxt/components/Player/MatchHistoryButton.test.ts` pins the rule and the single modal; each surface has one wiring test.

### Rejected alternatives

- **Make the whole Players page row open history.** It would hide one target behind another again, and the deck cell and row menu sit in the same row.
- **Link a name the surface knows only as text by matching it against the roster.** Two Players can share a name, and the wrong history is worse than none.

## ADR-0049: Themes replace Graphic Style Sets, resolve live, and use a closed vocabulary of two tiers

Accepted · 2026-10-27 · [#812](https://github.com/KeeprDigital/stream-keepr/issues/812) · Amended 2026-10-28: Graphic Style Sets and Animation Effect Presets are removed, and a document's Style Set link is a former field · [#830](https://github.com/KeeprDigital/stream-keepr/issues/830) · Amended 2026-10-28: a composite Mode Token default names colour Foundation Tokens, and the chart palette is Foundation Tokens · [#851](https://github.com/KeeprDigital/stream-keepr/issues/851)

### Decision

**Every Screen's look comes from a Theme, resolved when it renders.** A Theme is an installation-scoped set of Theme Token values. An Event uses one, or the built-in, read-only Default Theme. A Screen resolves each token from its own Screen Theme Override, else its Event's Theme, else the token's shipped default. An edit reaches every Screen Output using the Theme at once. There is no draft, publish, review or per-template update.

**Stream Keepr owns every token.** Users set values, never names.

- **Foundation Tokens** are app-wide roles and hold a literal. A colour inside a composite Foundation Token (a fill, a surface, or a colour layer of the `background` stack) may name a colour Foundation Token instead, and a colour holds a literal only (#829, #831).
- **Mode Tokens** are declared by a Screen Mode Definition. Each holds a literal or names a same-type Foundation Token, and defaults to a Foundation Token, except where none fills its role: a badge shadow's colour (no shadow role exists) or Card Spotlight's zoom (no motion Foundation Token holds it) defaults to its shipped literal (#823, #844). A composite Mode Token's literal default may name colour Foundation Tokens inside it, as the Feature Match Overlay's Frame and Source Item surfaces fill with `surface` and outline in `accent`, so a change to those tokens restyles every placed preset; the Frame fills at full opacity, so the Theme's colour, alpha included, is what it paints. Metagame's chart slots follow the `series-1` … `series-8` and `series-other` Foundation Tokens (#851).
- **Graphic Item properties** name a whole Foundation Token or hold a literal. Nothing is bound partially, and nothing names a Mode Token. Resolution therefore takes at most two steps (a Mode Token or binding, its Foundation Token, then a colour that token names) and cannot cycle. It was one step until #829: the PRD has a composite's colour name a colour token, so a change to the accent reaches every surface using it.

**A Theme stores only the tokens it sets.** A token added later reaches every existing Theme through its default. Renames and removals follow ADR-0043 and ADR-0037.

**Graphic Style Sets are deleted, with `.skstyle` and the override-pin rules of ADR-0006, and so are Animation Effect Presets with `.skeffect`** (#830). Their data is dropped, not migrated. Templates keep their values as literals.

### Why

- Look and feel lived in four places: `ScreenConfig`, per-mode inline fallbacks, the Feature Match Overlay Frame's own fields, and Style Sets that reached Broadcast Graphic Templates only.
- A new Screen Mode started unstyled.
- The Style Set's copy-and-review model protected placed graphics from change. The product wants the opposite: one edit restyles the whole production.
- Defaulting each Mode Token to a Foundation Token is what makes a new Screen Mode fit every Theme with nothing changed.
- A closed vocabulary keeps tokens consumable everywhere, and lets a template travel between installations carrying only token names.

### Consequences

- A template renders in whichever Theme it is placed under, and its package carries no Theme.
- A Theme edit is a live on-air change: editing a Theme an Event is using restyles its outputs mid-show. This is accepted; Themes have no draft state.
- Theme writes are per token, last write wins, and take no Graphics Authoring Lease.
- A Theme in use cannot be deleted.
- Typography tokens carry no size. Colour tokens may carry alpha, and a consumer's opacity multiplies it. The Key Output keys a translucent colour at its own alpha, so Fill and Key agree.
- A Graphic Theme Binding (#829) is a slot name and a token name beside the property, never in place of it. The property keeps the value it last resolved to, so a document stays complete and renders without a Theme. The compositor paints every bound slot from the Screen's resolved Foundation Tokens. An author's edit to a bound slot's value detaches that slot, keeping what the author made of the resolved value. That is the only implicit change; there is no override record. A binding naming no Foundation Token of its slot's type is refused on a write and inert on a read.
- The Theme editor and a Screen's token section edit a composite, or the `background` stack, as it is stored, not as it resolves, so a colour inside it keeps naming its Foundation Token across a save. Each such colour's control follows a colour Foundation Token or holds its own (#851).
- Media treatment and on-screen cycling bind nothing, because no token type fills either. A Media Graphic Item's picture binds an asset token, such as the logo (#831).
- Migration `0001_since_v1_5_0`, in its `remove_graphic_style_sets` section, drops the Graphic Style Set and Animation Effect Preset libraries and a Broadcast Graphic Template's link columns (#830). A template's document is untouched, so its values stay as the literals it already held.
- A graphics document recorded with a Style Set link, stored or in a `.skgraphic` or `.sklayout` exported before #830, still reads. An item's `styleRefs`, and a Broadcast Graphic's `styleSet` and `styleRefs`, are former fields: accepted by the graphics schemas and dropped, as ADR-0037's are, so a write that sends the document (a Screen write, a template revision carrying its document, a package install) stores it without them. A client holding one sends it back unrefused. A copy the server makes of a stored document without parsing it, such as saving a placed graphic as a template or renaming a template, carries a stale link along, inert, until such a write. Every other unknown key is still refused.
- A rendering holds its Event's Theme in its Event context (ADR-0022), not in a read of its own (#820). A token write advances the Theme's revision in the same statement, then announces `theme:updated` with the whole stored map on every Event using the Theme. A holder applies it only for the Theme its Event names, and only if it is newer than the revision held. A Theme switch is an Event Presentation Settings write, so it announces `event:updated`. That names the new Theme without its tokens, so a rendering whose context names a Theme it does not hold re-reads the context.
- A Screen Theme Override write is one Screen write (`PATCH …/screens/:screenId/theme-overrides`, #827): it names tokens, each with a value or the `null` that clears it (ADR-0041), and announces `screen:updated`, so outputs re-read the Screen with its overrides. It may name any token the Screen's mode can consume: its Mode Tokens, and every Foundation Token of a type they declare, since a Mode Token may be pointed at any of them. A graphics host's Graphic Items may bind any Foundation Token of a type a binding slot takes, so it consumes those too (#831). Anything else is refused whole, and an override already stored for another mode's Mode Token stays dormant. The Screen's token section lists only what the mode's declaration consumes (`resolveThemeTokens`'s `consumed`), and on a graphics host every Foundation Token its Graphic Items may bind.

### Rejected alternatives

- **Keep Style Sets beside Themes.** Two token systems split the vocabulary.
- **Draft and atomic publish.** Rejected for simplicity.
- **User-named primitive tokens, as Palette Entries were.** An open vocabulary cannot be consumed by code written before a name existed.
- **An Event-level override layer.** It makes "why is this colour here" a four-layer answer. An Event picks a Theme instead.

## ADR-0050: Theme Tokens may reference Graphics Asset Library content

Accepted · 2026-10-27 · [#812](https://github.com/KeeprDigital/stream-keepr/issues/812) · Reverses ADR-0001 · Amended 2026-10-27 ([#828](https://github.com/KeeprDigital/stream-keepr/issues/828)): what is indexed, what holds Retire back, and what the capability admits

### Decision

**An asset-typed Theme Token, or a Screen Theme Override of one, holds an ordinary Graphic Asset Reference** to an exact revision of an image, silent video or font. Library fonts are included. The reference protects the asset from retire and trash as a template's does (ADR-0034), and the refusal names the Theme or Screen. A Screen Output's asset capability covers the revisions its resolved Theme supplies.

Three token shapes reach library content (#828):

- **An `asset` token** holds `{ kind, assetId, revisionId }` or `null` for none. Its definition names the kinds it admits; the `logo` Foundation Token admits an image or silent video, and ships `null`.
- **A typography token's font** is an application font or one exact font revision, as a Graphic Item's is.
- **A Background Layer stack's image and video layers** take library media as a Screen's own do. A Screen's stack and the `background` token validate through one schema (`shared/modules/theme/background.ts`).

**How each is indexed.**

- **A Theme's references** have owner kind `theme`, the Theme's id, and slots rooted at the token: `logo`, `heading/font`, `background/<layer id>/source`. No token name holds the `/`, so the `background` token's slots never read as a `background.` Mode Token's. A token write replaces only that token's slots, in the statement that commits the value. Each reference must resolve there, and the route first asks the library, so a refusal names the slot. Clearing the token, or setting it to none, releases them. Deleting the Theme drops them.
- **A Screen's overrides** index under its own `themeOverrides.` namespace, beside its modes'. Each override write replaces that whole namespace.

**Retire is refused** while a Theme or an override references the asset, as for a template. A Screen's own mode references still do not hold it back (ADR-0034). Trash was already refused for any reference. The usage names the Theme by its name.

**The capability admits exactly what the Screen's resolved tokens supply.** That is every Foundation Token, which any Screen may consume and a Graphic Item may bind, plus the Mode Tokens of the mode the Screen shows. Each resolves from the override, else the Theme, else the default. A Theme value an override shadows, a dormant override of another mode's Mode Token, and a Theme the Event does not use supply nothing. The revision must also be indexed by that Theme or by the Screen's override namespace. Screen Outputs load the library fonts their typography Mode Tokens resolve to as `FontFace`s, and hide the mode's display, not its background, while the fonts load.

### Why

A Theme is meant to carry the production's logo, backdrop and typefaces. ADR-0001 kept Style Sets data-only so that `.skstyle` needed no asset pipeline. Themes have no export yet, so that cost is deferred rather than avoided.

### Consequences

- Theme export/import, when built, must carry asset bytes through the Template Package asset pipeline: staging, quota, revalidation and Graphic Asset Origin. It cannot be data-only.
- ADR-0001 is fully superseded: #830 removed Graphic Style Sets.
- A Theme or override cannot hold a retired asset, because Retire is refused while one references it. A token write therefore never needs ADR-0034's retained-reference allowance; an override still grants it to a revision it already held at the same slot.
- A Screen overrides only a token its mode can consume (ADR-0049). Since #831 both graphics hosts consume every Foundation Token a Graphic Item binds, the logo included, and the Feature Match Overlay declares the asset Mode Token `frame-media`, so a graphics Screen can override `logo`. A plain mode declares no asset Mode Token, so it cannot. Its fonts and its `background` stack can be overridden.
- The capability admits the Theme's logo on every Screen of the Event, whether or not that Screen's mode paints it. The Event context already carries the whole Theme, so this reveals nothing new, and a graphics host binding the logo needs no change to the capability.

## ADR-0051: A Screen holds no look of its own, and the Event Canvas is a coordinate space

Accepted · 2026-10-27 · [#812](https://github.com/KeeprDigital/stream-keepr/issues/812) · Amended 2026-10-28: only overlay Screen Modes scale the Event Canvas, and Standings and Metagame's last look fields are Mode Tokens · [#851](https://github.com/KeeprDigital/stream-keepr/issues/851)

### Decision

**`ScreenConfig` is deleted.** A Screen holds its Screen Mode, that mode's content config and its Screen Theme Overrides.

- Background, text colours, padding and alignment become Theme Tokens.
- colorMode goes: a light look and a dark look are two Themes.
- Mode config holds what a mode shows (headers, columns, page size, Event References). Mode Tokens hold how it looks (colour, type, spacing, size, media, motion).

**Each Event sets one Event Canvas** (default 1920×1080) in its Event Presentation Settings, with its Theme and on-air wording. Every Screen of the Event uses it, graphics hosts included, and every overlay Screen Mode scales it uniformly to fit its window. There is no per-Screen canvas. Feature Match Controls is the exception: it is an operator surface, so it fills its window and consumes no Theme Token (#812, Q37 and Q44).

### Why

Canvas size and wording are set once per production, not per brand or per Screen. Dimension tokens are in canvas pixels. If canvas meant output resolution, a Theme reused on a 4K show would render at half size. As a coordinate space the canvas changes only for a different aspect ratio, and output resolution is the browser source's to set.

### Consequences

- Today's two canvases (`ScreenConfig` width/height and the graphics hosts' canvas fields) become one.
- Padding and alignment are the `inset` and `alignment` Foundation Tokens. The inset is one value on every side; the separate horizontal and vertical padding a Screen had is not kept. A plain overlay mode's Screen host consumes them itself, so they are among what its Screen consumes and may override (#826). The Background Screen and the graphics hosts render edge to edge and consume neither, and Feature Match Controls consumes no Theme Token at all.
- A portrait display on a landscape Event is not supported; an override is the reopening path if a real case appears.
- Resizing the Event Canvas moves the frame every graphics composition of the Event was authored in, yet takes no Graphics Authoring Lease, like any other Event Presentation Settings write (ADR-0030).
- On-air wording stays on the Event, so one Theme serves Events that word things differently.
- Holding text stays on the Event but is set in Event Controls, not Event Presentation Settings: an operator rewrites it during a show, while the settings here are set once per production.
- The existing look fields are dropped, not migrated, and existing Screens render the Default Theme.
- The plain modes' remaining look fields became Mode Tokens and former fields (#844): their colours, type and Card Spotlight's enter and exit. Card Spotlight's on/off switch went with its speed, since a motion recipe with no channel cuts.
- **A Theme Token is shared, never a value one display alone reads** (amended by ADR-0054). A Mode Token defaults to a Foundation Token, so it carries a shared value to the place it is consumed. A size or spacing only one display reads is that mode's config, edited beside the control it sizes: Most Played Cards' card width, gap and badge size; each Deck board's card width and gap, the sideboard's stack reveal, and the Deck's badge, pill and chip text sizes; Card Spotlight's card width. A badge's size is its text size, and the badge is laid out around it in em, so one value sizes it whole. A colour, type, motion or surface a brand would set stays a Theme look even where one mode reads it, such as the Metagame chart palette. The badges' shadow is the `shadow` Foundation Token.
- Standings and Metagame followed (#851). Max table width became the `max-width` dimension, shipped at the widest Event Canvas, so a table fills its Screen until a Theme narrows it. Animate entries became `row-motion`, which also times Metagame's chart bars. Standings' `reveal` view mode keeps its own rise as `reveal-motion`. An entering row starts an eighth of the duration after the one above it, so a cut has no stagger either. No plain mode keeps a size or motion field in config.
- A motion Mode Token reaches its display as custom properties a CSS transition reads: its timing, and the excursion state the element enters from and leaves to. A slide clearing its parent travels the whole Screen, which is the size container its Screen host sets.
- `text-inverse` is text on the primary text colour. Every badge, pill and chip whose surface is `text-primary` pairs it with `text-inverse`, so a light Theme sets the two as a pair.

## ADR-0052: Live Results polls the Current Round, and Melee Sync announces only what changed

Accepted · 2026-10-27

### Decision

**Live Results is a per-Event setting under which Melee Sync polls Melee.gg.** It is off by default, existing Events included, and can be on only while Melee Sync is on; turning Melee Sync off turns it off, so re-enabling sync starts without it. Turning it on starts a fresh poll (due now, no backoff, no error or stop reason, the idle clock restarted); turning it off stops polling and touches no data. `PUT /api/events/:id/melee/live-results` sets it; `GET` on the same path answers the Current Round and the last poll's state for the Sync page.

**The Current Round is derived, never set.** It is the latest Melee-managed Round (`isMeleeManagedRound`), in the Event's Round order, with at least one Match stored from Melee. A Round is complete when every such Match has a result or is a bye, or when the next Melee-managed Round has pairings. While the Current Round is incomplete, a tick fetches its Matches only (one paginated request) and syncs them. Once it is complete, a tick probes the next Round; when Melee pairs it, the tick refreshes Players once, so new Players resolve, and syncs it, which makes it current. With no Round paired, the first is probed; with no next Round, polling idles until a structure sync adds one (`liveResults/currentRound.ts`).

**Round Standings are stored only for a complete Round, on every Melee Sync path**: polling, Update from Melee, per-Round Refresh and Re-sync Matches. A sync of an incomplete Round stores its Matches and leaves its standings alone, without asking Melee for them. Pairing Round N+1 completes Round N, so that sync fills Round N's standings if none are stored. A manual sync of Round N+1 tries that fill every time, so it heals one that failed; Live Results tries it only with Round N+1's first pairings, so a Round N Melee has no standings for is not re-fetched every minute (`syncRoundMatches`' `previousRoundStandings` option). The Standings Screen therefore always shows standings after the last complete Round. A Match side's Player record follows the same rule: the Round's own fetched Round Standings once it is complete, and while it is played the previous Melee-managed Round's stored Round Standings, the record going into the Round, or none when that Round holds none.

**The Round snapshot write diffs, and each kind of change is announced on its own.** `meleeRoundSnapshotService().replace` writes only rows that changed and reports what did. `syncRoundMatches` publishes `melee:matchResultsSynced` (changed `matchIds`), `melee:pairingsSynced` and `melee:roundStandingsSynced`, each only when its content changed, for manual syncs too; a quiet sync publishes nothing. For one release `melee:roundSynced`, payload unchanged, is published beside any of them for Screen Outputs still on the previous bundle; new client code never listens to it.

**A one-minute Cloudflare cron is the scheduler.** `wrangler.jsonc` declares `* * * * *` beside the hourly `17 * * * *`, and every `cloudflare:scheduled` handler checks `controller.cron` against `server/utils/cronSchedules.ts`, so the graphics jobs stay hourly. `runDueLiveResultsTicks` ticks Events with Melee Sync and Live Results on whose `meleeLiveResultsNextCheckAt` is unset or passed, longest-waiting first, at most 25 per run, one at a time, each in its own `try`/`catch`.

**Local launchers fire the same cron themselves.** No local runtime fires a cron trigger, so under `pnpm dev`, `dev:local` and their `:bypass` variants Live Results never ticked and an operator saw "Not checked yet" for good (#887). The dev server fires the Worker's own `cloudflare:scheduled` hook with `* * * * *` in-process (`liveResults/localSchedule.ts`, started by the Live Results cron plugin only when `import.meta.dev`), and `pnpm preview` fires it through Wrangler's `/__scheduled` test route (`scripts/preview-worker.mjs`). Both fire at start and then each minute, skipping a minute while the previous firing is still running (`server/utils/localCron.ts`). Under `pnpm dev` a firing lasts the whole run; Wrangler answers `/__scheduled` once the handler has handed the run to `waitUntil`, so under `pnpm preview`, as under Cloudflare's own cron, a run longer than a minute can overlap the next, and the Melee Sync lease keeps one Event's ticks apart. They fire the entry the cron does, so the runner, the lease and each Event's next check decide what ticks, exactly as deployed. A deployed Worker never starts the local schedule: its real cron would tick every Event twice, and `pnpm worker:smoke` proves the built Worker ticks only when its cron fires.

**Poll state is columns on `events`**: next check, backoff step, last checked, last change, Live Results error, stop reason. Cadence is `nextLiveResultsSchedule`: results every minute, every five minutes after thirty quiet minutes, back to every minute on a change; probing, idling and failures back off from a minute, doubling to a fifteen-minute cap. Live Results stops itself, storing a stop reason, after twelve hours with no change of any kind (failed ticks count) or on a Melee 401/403.

**The Melee Sync lease keeps a tick from writing after Melee Sync is turned off, and never blocks an operator.** A tick takes the Event's lease as `live-results` for two minutes or skips; it never waits. Any operator command, configuration included, takes a `live-results` lease over at once in the same conditional `UPDATE` that takes a free one; only another operator command's lease answers `409`. Just before each Player or Round write the tick renews its lease by token and re-reads that Melee Sync and Live Results are both on, abandoning that write and every later one, its poll state included, when either check fails. Its poll-state write is itself conditioned on the lease token and both settings, so a reset that took the lease over always wins.

**A tick churns no Event row.** It writes only its poll columns, and publishes `event:updated` only when its Live Results error appears or clears or it stops itself. The Live Results error is its own column, apart from the manual sync's `lastSyncError`, so neither clears the other. Melee Sync takes a `MeleeSyncContext` (an optional origin connection id) instead of an `H3Event`, so a tick runs with no request.

### Why

Match Results reported on Melee.gg reached Stream Keepr only when an operator pressed a button. Polling closes that gap without operator action, and deriving the Current Round from synced data means no pointer can go stale.

Polling with the old messages would have made every results-reading Screen re-read every minute: every Round sync published `melee:roundSynced` whether or not anything changed, and every command rewrote and announced the Event row. Diffing and per-kind messages make a quiet tick invisible.

Melee's Round Standings for Round N include Round N's results, so storing them mid-Round would move the Standings Screen while the Round is played. Storing them on completion keeps "standings after Round X" honest.

A minute cron meets the cadence: the shortest interval is a minute, and backoff only needs a stored next-check time. It keeps all state in D1 beside the Event, with no new binding to deploy.

### Consequences

- A deploy without the minute cron silently stops Live Results; Events keep their setting and resume on the next deploy with it.
- Live Results polls Melee.gg from any running local launcher with an Event's Live Results on, as production does. Turning it off on the Sync page stops that.
- Every new `cloudflare:scheduled` handler must check its own cron, or it runs every minute. `test/unit/server/utils/cronSchedules.test.ts` pins the triggers against `wrangler.jsonc` and each handler's gate.
- A result corrected on Melee after its Round is complete is not polled for; a manual sync picks it up.
- Polling refreshes Players only when a new Round is first paired, never Deck Lists or Event structure.
- An operator command taken over a tick can overlap only the write the tick had already begun when it lost the lease: one Round snapshot or Player reconcile, which is itself a Melee Sync write of the same data. The tick's poll-state write is then refused by the token condition.
- `melee:roundSynced` is gone in the same release, with no compatibility window: a Screen Output still on the previous bundle during a deploy misses Round sync messages until it reloads.
- `test/unit/server/modules/meleeLiveResults.sqlite.test.ts` pins the tick, the runner and the status route; `meleeLiveResultsRules.test.ts` the cadence; `meleeLiveResultsCurrentRound.sqlite.test.ts` the Current Round; `meleeLiveResultsLocalSchedule.sqlite.test.ts` the local schedule and its dev gate; `test/unit/server/utils/localCron.test.ts` its cadence and overlap rule; `test/unit/scripts/previewWorker.test.ts` the preview launcher.

### Rejected alternatives

- **A Durable Object alarm per Event.** Exact per-Event timing, but a new binding and state outside D1, for a cadence a minute cron already meets.
- **An operator pointer to the Current Round.** It goes stale the moment Melee pairs the next Round, which is what polling exists to notice.
- **Store Round Standings whenever Melee returns them.** The Standings Screen would change mid-Round, and Seeds would read standings that still move.
- **Keep `melee:roundSynced` as the only message, published only on change.** Standings would still re-read on every reported result, and the Pairings Screen could not tell a result from a re-pairing.
- **Let a tick wait for the lease like an operator command.** A tick that waits holds a cron invocation for nothing; the next minute's tick tries again.
- **Let an operator command wait out a tick.** A tick slower than the wait still answers the operator `409`, and every wait delays the operator for polling, which Live Results must never do.
- **Leave local launchers without a scheduler, firing `/__scheduled` by hand.** Live Results is meant to just work wherever an operator runs the app, and a forgotten manual step looks exactly like #887.

## ADR-0053: Program holds what it shows until what replaces it is ready

Accepted · 2026-10-28

### Decision

**A Screen Mode rendering is ready once what it shows has settled**: its display has declared its data settled, its Theme fonts have loaded or failed, and every image, video and pending part inside it has loaded or failed. This is Rendering Readiness, owned by `app/modules/screen-mode/readiness.ts` and the Screen renderer's frame (`Screen/RendererFrame.vue`).

**The renderer double-buffers modes.** On a mode change the incoming mode renders hidden behind the one on program, and the renderer cuts to it once it is ready. On a first load nothing shows until then. A mode left before it was ready is dropped; going back to the mode on program drops the one loading. Only the rendering on program hosts overlays. A rendering not ready after `SCREEN_MODE_READY_TIMEOUT_MS` (10 s) is shown anyway with a console warning, so a hung read or image never pins program to the outgoing mode.

**Every display declares.** `ScreenModeBase` takes a required `ready` prop, so a mode built on it cannot forget; a display without it calls `useScreenModeReady` (Background, Feature Match Overlay, Broadcast Graphics). Its data composable answers `ready`: its first read answered or failed (Screen Mode Data Freshness's `answered`), and whatever it stages loaded. Nothing declared is not ready, because a display is an async component that declares only once its chunk has loaded. A part that loads on its own declares too (the Card Spotlight's card), or marks itself `data-render-pending` while it loads (a Background Layer stack resolving library media, an Animation Effect loading its module); the frame waits for both, then for every `<img>` and `<video>` inside it.

**Inside a mode, a change that brings new images is staged.** `useStagedScreenContent` holds what a rendering shows until the images of what replaces it have preloaded and decoded (`preloadImages`), a newer change superseding one still loading, a failed image counting as loaded so its fallback shows. Most Played Cards stages each page with its page indicator, Archetype Spotlight its whole read. The Deck List keeps its own staged swap, now on the shared preload, and the Card Spotlight keeps its card on program until the replacement's images have loaded, then plays its exit and entry.

### Why

Some modes held program and others did not. The Deck List preloaded its card art and swapped whole; Most Played Cards mounted its grid at once and painted card by card on every page; every mode change showed the incoming mode's empty scaffold ("TBD vs TBD", an empty table) while its first read was in flight. Doing it once in the renderer covers every mode, present and future, without each re-implementing a preload.

### Consequences

- A mode change shows nothing new until the incoming mode is ready, up to the timeout. A read that fails settles as ready, showing what the mode shows on error.
- Two renderings are briefly live during a mode change, each reading its own data and holding its own Realtime Subscriptions.
- A Broadcast Graphics output whose Live Session read fails reaches program only at the timeout.
- A video whose source changes, a video Background Layer's or the Feature Match Overlay Frame's, keeps playing until the new source has its first frame or fails (`ScreenMediaBackground`).
- A Take cannot be held on one output, whose animation phases follow the shared clock with every other. Instead a Broadcast Graphics output loads every image its stack can put on air once its content URLs resolve, and holds the loaded images while the stack names them (`createImageRetainer`): its library content is `no-store`, so only an image still held is reused. Videos are not preloaded.
- A Broadcast Graphics canvas whose library font fails now shows in the fallback face, as the Feature Match Overlay does, rather than staying hidden: a blank graphic is worse on air than the wrong face.
- Not covered: a Screen Output navigated to another Screen still blanks while it loads, because the display session unmounts the renderer. Nothing in the app moves an output between Screens, and holding one would need each rendering to keep its own Screen, Event, Theme and capability.
- `test/nuxt/components/Screen/Renderer.test.ts` pins the hold, `test/nuxt/modules/screenModeReadiness.test.ts` the declarations and staging.

### Rejected alternatives

- **Each mode preloading its own media, as the Deck List did.** It covers only the modes that remember to, and none of them covers the mode change itself.
- **Hold program by scanning the DOM alone, with no declaration.** An async display's chunk has not mounted when the scan runs, so an empty rendering would look ready.
- **Vue `<Suspense>`.** Still experimental, and suspending setup would keep the incoming rendering from mounting, which is what starts its media loading.

## ADR-0054: Cards fit the Event Canvas or take a fixed width

Accepted · 2026-10-28

### Decision

**A card grid's Card Sizing is Fixed width or Fit to screen.** `cardSizing: 'fixed' | 'fit'` replaces `dynamicCardSize` on Most Played Cards and on each Deck List board. Fixed takes the grid's own `cardWidth` and may overflow. Fit gives the grid the height its display leaves it, splits it into equal rows (`ScreenCardGrid`), and sizes each card in its cell as `min(100cqw, 100cqh × 61/85)` (`MtgCardFitBox`), so no card leaves the Event Canvas. This is CSS: nothing measures the rendered page. A Most Played Cards page lays out a full page's rows, `min(rowsPerPage, rows)`, so a short last page keeps its card size. Deck boards below each other share the height by their Fit rows, and a Fixed board keeps its own height.

**Auto columns are chosen from the Event Canvas, never measured.** `autoColumns` sits beside `columns`. Fit picks the column count, from 1 to 12, at which the cards are largest (`fitColumns`). Fixed fits as many card-width columns as there is room for (`fixedColumns`). Both read the canvas inside the Screen inset and the grid's own width and gap (`useCardGridColumns`), and the settings editor's mode data now carries its Event's canvas and Theme, for the inset. Most Played Cards chooses its columns over every card and then pages them, so the column count and the page size never depend on each other. A Fixed Deck grid with auto columns uses CSS `auto-fill`, because a Deck has no pages to agree on.

**Only a sideboard stacks, as the strip beside the mainboard.** The mainboard's views are grid and list. A sideboard stack placed below the mainboard, or shown alone, renders as a grid and keeps `view: 'stack'` stored, so moving it back beside restores the strip. Settings shows the Stack tab disabled in those cases. A Fit strip is one mainboard column wide, and its cards fit the whole stack to its height while the sideboard's `stackReveal` stays in px. A mainboard stack stored by an older client reads as a grid (`resolveDeckBoards`).

**A card grid's sizes are its mode's config, not Mode Tokens.** Each one a single display reads moved back beside the control it sizes, which amends ADR-0051's #844 bullet: a Theme Token is shared. Most Played Cards holds `cardWidth`, `cardGap`, and each badge's own text size and position (`rankBadgeTextSize`, `statBadgeTextSize`, `rankBadgePosition`, `statBadgePosition`), as a Deck's badges are; each Deck board `cardWidth` and `cardGap`, the sideboard `stackReveal`, and the Deck its four text sizes; Card Spotlight `cardWidth`. The three badge shadows read a new `shadow` Foundation Token.

**Nothing is migrated.** The Themes work is not in production, and existing Screens are deleted and set up again rather than carried over. Every replaced field is a former field, so a stored one reads as the mode's default until the Screen is next written:

- `dynamicCardSize`;
- the size presets;
- `stackOverlap`;
- `scale`;
- `rowsPerPage` on Most Played Cards.

**A Deck's Fit boards are laid out together from the space they measure** (`solveDeckLayout`). A Deck has no pages, so when every board shown is Fit, the Screen measures the space below its header and lays both boards out at one card size: the largest at which both fit.

- **Columns:** each board's columns are chosen alongside the other's. A set column count is kept.
- **Stack:** a stacked sideboard shows less of each card, down to its name bar (`MIN_STACK_REVEAL_SHARE`), before its cards shrink.
- **One score, no thresholds** (`layoutScore`): each column choice is laid out at the largest card size that fits. The choices are compared on one continuous score:
  - card size, relative to the largest possible;
  - the share of the width the deck spans;
  - the square root of the share of the height it spans;
  - how full its rows are.

  Every term is a ratio, so the same choice holds at any canvas, card or gap size, and no small change flips it. Width counts more than height: space under a deck reads as margin, space beside it as a gap. Most Played Cards' auto columns use the same score (`fitColumns`).

- **A sideboard below wraps at the mainboard's width**: choosing its own columns, it takes as many as the mainboard has, or as many as it has cards.
- **Measured, not guessed:** a board's heading and a Most Played Cards name label are measured from hidden copies, as their Theme types them, by layout height (`useLayoutHeight`), which the Screen's scale leaves alone. The gap between boards is set from the value the layout reads.
- **Placement:** the boards are sized exactly and fill the space they share. Across the axis they share, each board sits at its own `alignment`, as far as the Screen's edge, a sideboard's heading with it. Along it they sit together at the mainboard's `alignment`, so the space they leave is shared out around them. A sideboard aligned away from the mainboard (bottom below it, right beside it) goes to that far edge instead. A board fitting itself places its cards at its own `alignment`.
- **First frame:** until the space is measured, each board fits itself.

**Most Played Cards pages by cards.** `cardsPerPage` replaced `rowsPerPage`. Columns no longer change which cards a page holds, so the Screen chooses its auto columns from the grid space it measures, and a page laid out at a full page's capacity keeps its card size.

**The Deck's information is the deck's alone.**

- **Counters:** none are shown.
- **Companion:** it is a card, the sideboard's first, tagged "Companion" and listed once, or in a column of its own with no sideboard (`showCompanion`).
- **Header:** the Player's name and the deck's name are each their own line (`showPlayerName`, `showDeckName`).
- **Visibility:** each board's card shows or hides it, writing the one `board` selection, so the last board shown stays on.
- **Hidden settings:** a setting that cannot have an effect is not shown:
  - card points without an Event points system;
  - the details row's look while the row is empty;
  - the column count while auto columns choose it;
  - the sideboard's alignment while both boards are placed together.

### Why

A Theme exists to share a look across Screens. A size only one display reads gained nothing from the Theme and cost an override section away from the control it sized.

With "Dynamic card size", columns only filled the canvas width. Card height followed the card's aspect, so enough rows ran off the bottom of the Event Canvas with no way to stop them. Operators need one mode that never overflows and one that takes an exact width and accepts overflow. Choosing auto columns from inputs every surface holds keeps the settings editor's page count equal to the Screen Output's. The mainboard stack and the horizontal sideboard row were never used.

### Consequences

- Most Played Cards keeps Fit as its default, so a Screen that filled its columns now also fits its height, and a long grid shrinks instead of overflowing.
- Fit cards in a page of 60 can be small. Paging, not a minimum size, is the operator's way to keep them large.
- Canvas aspect only chooses the auto column count; the rendered Fit size always comes from the grid's real space, so a tall header costs size, never overflow.

## ADR-0055: A stopgap public read names an Event's commentators and holding text

Accepted · 2026-10-28. Amends ADR-0010's exempt surface.

Outside tools need the commentators' names and the holding text for an Event, and have no session or Screen Output Asset Capability to present.

### Decision

**`GET /api/public/events/:id/on-air` is unauthenticated** and answers `{ eventId, eventName, holdingText, talent: [{ slot, name }] }`, `talent` being the Event's commentator 1 and 2 Talents that are set, in slot order. It sends `access-control-allow-origin: *` and `cache-control: no-store`. An unknown Event is a 404.

**Two vMix-shaped reads answer the same facts as flat rows.** `GET /api/public/events/:id/commentators` answers `[{ commentator1, commentator2 }]` and `GET /api/public/events/:id/holding-text` answers `[{ holdingText }]`, with the same headers and 404. A vMix JSON Data Source reads an array as rows and shows `null` as text, so each is a one-element array and an unset value is an empty string.

**`/api/public/` joins ADR-0010's exempt prefixes.** Everything under it is public by name, so a route belongs there only if anyone on the internet may read what it answers.

### Why

A stopgap that works now. Names and wording an operator puts on air are not secret; nothing else is exposed.

### Consequences

- Anyone can enumerate Events by id and read their names, commentator names and holding text.
- Contradicts ADR-0010's rejection of a stopgap boundary only in spirit: that rejected a shared token in front of private routes, not a public read of on-air text.
- Replace with a capability- or token-scoped read when a real integration needs one.

## ADR-0056: A stopgap public read shows a Feature Match Slot as its Overlay would

Accepted · 2026-10-29. Extends ADR-0055.

An Event is producing its Feature Match graphics in vMix rather than with a Feature Match Overlay, and vMix needs the Slot's names, records and clock without a session or a Screen Output Asset Capability.

### Decision

**`GET /api/public/events/:id/feature-match-slots/:slotId` is unauthenticated** under ADR-0055's `/api/public/` prefix, with the same `access-control-allow-origin: *` and `cache-control: no-store`. It answers a one-element array holding one row of strings, because a vMix JSON Data Source reads an array as rows and shows `null` as text: every Feature Match token the Overlay resolves (`player1Name`, `player1Record`, … `eventName`), plus `clock`, `player1Life`, `player1GameWins`, `player2Life` and `player2GameWins`, and for vMix alone `player1Game1Win`, `player1Game2Win`, `player2Game1Win` and `player2Game2Win`: `#FFFFFFFF` once that game is won and `#00000000` before, eight hex digits that read the same as ARGB or RGBA. An unknown Event, or a Slot not of that Event, is a 404.

**It applies the Overlay's display rules by sharing their code.** The token values moved from the app into `shared/featureMatchOverlayValues.ts`, and the clock's rendering into `formatClockDisplay` in `shared/utils/clock.ts`, which `useClockDisplay` now calls. The clock is read at request time: a countdown's remaining time, its overtime when it counts up after, an Untimed Match's Untimed Label (empty while blank), and `0:00` with no Session, as the Overlay shows it. A Slot without a Session starts none.

### Why

A stopgap that works now. Sharing the rules rather than copying them keeps vMix and an Overlay showing the same Slot identically.

### Consequences

- Anyone can enumerate Slots by id and read the Players' names, pronouns, LGS, records, decks and the live state of a Feature Match: what an Overlay would put on air.
- vMix polls, so its clock is only as fresh as its polling interval; it does not tick between reads.
- Replace with a capability- or token-scoped read when a real integration needs one, as ADR-0055 says.

## ADR-0057: A One Piece Card Game Event has no Rounds or Matches, and its Feature Match Slot sides seat a Player or manual data

Accepted · 2026-11-02 · Compatible with ADR-0047 · Amended 2026-11-05 ([#1000](https://github.com/KeeprDigital/stream-keepr/issues/1000)): ADR-0074 gave OP Events Players with Player-owned Deck Lists, one card catalogue keyed by card number, Unresolved Deck Cards and a participation Metagame, so this section no longer says OP Events have no Players, keep inline card snapshots or offer no Metagame; it now covers what the Feature Match Slot side keeps. Amended 2026-11-05 by ADR-0075: Top Cut Bracket is offered to OP Events, showing a Manual Bracket. Amended 2026-11-07: the Cards page offers OP Events its Feature Match Deck List mode, picked by Slot.

One Piece Card Game Events run their pairings in Bandai TCG+, whose only export is a deck list export with no pairings or results, and are streamed by featuring one or two Matches a Round. Nobody enters results round to round.

### Decision

**An OP Event models no Rounds, Matches or Match Results.** Its Players come from a TCG+ Import or the Players page (ADR-0074). Feature Match Slot Promotion and Assignment never run for it; Reverse Sync does, from a Player to every Slot seating them. Melee Sync, Integrations, Archetype Review, the Matches and Event Structure pages, and the Screen Modes that need Rounds or results (Standings, Pairings, Player History, Head-to-Head, Round Clock) declare themselves MTG-only and are not offered (`EVENT_PAGE_CARD_GAMES`, `SCREEN_MODE_CARD_GAMES`); ADR-0074 lists what OP Events are offered. Top Cut Bracket is offered, and shows the Screen's Manual Bracket (ADR-0075).

**A Feature Match Slot side seats a Player, or holds manual slot data.** A side linked to a Player shows that Player's Leader and Deck List by reference (ADR-0074), and its setup form edits the Player's Deck List. An unlinked side is manual slot data: the operator types its name, pronouns and LGS, picks its Leader and pastes its Feature Match Deck List.

**A Feature Match Deck List belongs to an unlinked Slot side, not a Player.** The operator pastes it (`N[x] CARDNUMBER [name]` lines; a Printing id reads as its card number, a number pasted twice is added into its first line, any other line is ignored). It stays until replaced or its side is cleared, follows its player on `SwapPlayers`, and replacing it during an active Feature Match Session updates that Session's source snapshot. Its Leader is the side's Leader. It is written through the OP Deck List write, as a Player's Deck List is, and never counts in the Metagame (ADR-0074). A paste to a linked side is refused (`409`).

**A Deck List Screen showing a Slot side follows whichever player sits there now, and is released when its Slot goes.** The Deck Source names the Slot and a side, and the side's player comes from `featureMatchSidePlayer` (ADR-0058), so a swap shows the other player's Deck List; the side's Deck List reference names what to read, so a re-paste or a clear reaches the Screen with the Slot's announcement, and a linked side shows its Player's Deck List. Its OP layout shows the Leader large, a cost curve, and the Mainboard grouped Character, Event, Stage, each by cost (`opDeckLayout`); it has no Sideboard, so no Board Selection, and a side holding no Deck List shows nothing. A Screen entering Deck List mode on an OP Event with no Deck Source chosen starts on the Event's first Slot, left side (no Slot while it has none), written by the Screen write that puts it in Deck List mode ([#877](https://github.com/KeeprDigital/stream-keepr/issues/877)). Deleting a Slot, alone or by lowering the Event's Slot count, clears every Deck Source naming it to no Slot, keeping its side, in the same write, and announces each Screen first without an origin, as ADR-0032 does for a Player. The Screen guard triggers prove the Slot belongs to the Screen's Event (migration `0001_since_v1_5_0`).

**The Cards page shows a Slot's two Deck Lists, as it shows a Magic matchup's.** Its Feature Match Deck List mode picks a Feature Match Slot, there being no Round or Match to pick, and shows each side's Deck List, its own or its linked Player's, beside the other: a Leader section and one Mainboard section, filtered by card name or number. A side shows whoever its followed Session seats there, so a swap, a re-paste or a Player's Deck List write reloads the Slot in place. Choosing a card previews it on Card Spotlight; an Unresolved Deck Card shows its number and cannot be chosen. There is no Player Deck List mode.

**A side's slot data holds its Deck List by reference.** A Feature Match Deck List's entries live in their own table, deleted with their Slot; each holds a card number and quantity and reads its card from the catalogue, so a number catalogued later fills in. The side's slot data keeps only the Deck List's id and Mainboard count (the `player.deckCardCount` binding). A paste is saved through the Slot setup write, so the Session's snapshot carries the reference and the Session's own re-orientation after `SwapPlayers` keeps it with its player; the Slot's sides are never swapped for it. A setup save may keep, move or drop a reference; one naming another Slot's or a missing Deck List, as a stale form would, keeps what the side holds, so a stale save never deletes a newer paste. The Mainboard count is always the stored one, and only a setup save carries a reference. A Deck List the save drops (side cleared, replaced, or the side linked to a Player) is deleted. A linked side's game data is the server's: a setup save takes the Player's Deck List reference and Leader whatever the form sent. A paste with a Leader sets the side's Leader; one with none keeps the Leader picked; one with two or more uses the first and warns.

**A Slot side's Leader is picked, not typed, and held by card number.** The operator picks it from a Leader-only card search. The side's slot data keeps only its card number, and every read fills in the card from the catalogue (`withCatalogueLeaders`); a picked card that is not a Leader is refused. The Leader follows its player on `SwapPlayers`, and a change during an active Feature Match Session corrects that Session's source snapshot. A number the catalogue lacks, or a Leader typed as free text before the picker, reads as no Leader. On the Feature Match Overlay, and so on the public read (ADR-0056), a side's Deck and Deck Colours tokens name its Leader and its colours, because the Leader names the deck and sets its colours; a Leader Image token adds the card.

**Card data comes from bandai-keepr through a server proxy.** bandai-keepr needs a Bearer key and serves no CORS, so the browser never calls it. Pasted card numbers resolve through the shared card catalogue and bandai-keepr's bulk lookup, as imported ones do (ADR-0074); a number bandai-keepr does not know is kept number-only as an Unresolved Deck Card, with a warning. Deck rule breaches (50 cards, 4 copies, one Leader, Leader colours) warn and never refuse.

### Why

It matches how OP Events are actually produced. TCG+ leaves no source for pairings or results, and nobody will enter them during a stream. Manual slot data stays for a side with no Player to link, such as one featured before an import, and reuses what a Feature Match Slot already holds.

### Consequences

- An unlinked side's competitor is typed and pasted again each time they are featured, and their Deck List never counts in the Metagame. Linking the side to a Player avoids both.
- OP standings, records or Conversion Rate would need a source for results, so this decision would be reopened. TCG+ exports none (ADR-0074).
- An OP Event never runs Melee Sync, even if its tournament is on Melee.gg. Its Players come from the TCG+ Import or the Players page.

### Rejected alternatives

- **Operator-entered Match Results for non-Melee Events**: reopens ADR-0047 for data nobody will keep up during a stream.

## ADR-0058: A Feature Match Session owns which side each player sits on

Accepted · 2026-11-03 · [#886](https://github.com/KeeprDigital/stream-keepr/issues/886). Settles the rule 41bfa662 (#314) left in code comments; extends ADR-0056.

### Decision

**Side order belongs to the active Feature Match Session; the Feature Match Slot keeps its pairing order.** `SwapPlayers` swaps the Session's source snapshot and current state and sets `playersSwapped`. It never writes the Slot. A `SnapshotCorrected` rebuilt from the Slot is put back into the Session's orientation by the reducer, as 41bfa662 made it.

**A surface that shows a side beside the Session's live state takes that side's player from the active Session's source snapshot, and from the Slot only while no Session is active.** `featureMatchSidePlayer` (`shared/utils/featureMatchSidePlayer.ts`) states the rule. The Feature Match Overlay's token values follow it, and so does the ADR-0056 public read, which shares them. So do the Overlay's sideboards and the controls' deck name and deck counters. So do the surfaces that name a Slot's pairing: a Head-to-Head from a Slot, the Card Spotlight Screen's matchup Deck Lists from a Slot, and the Slot pickers' "A vs B" labels ([#891](https://github.com/KeeprDigital/stream-keepr/issues/891)), so none of them shows the players on the opposite sides from the Overlay. The controls' names and Graphic Input Bindings already read the snapshot. A client surface reads the Session the Live State Follower holds, not the one the Slot's last read carried (`withFollowedFeatureMatchSession`), because `SwapPlayers` moves only the Session.

**The Slot setup form edits the Slot in Slot order and shows it in the Session's.** Swap Players sends only `SwapPlayers`. The form keeps the Slot's sides, and each shown column reads and writes the Slot side its player holds, so a save sends each edit to its own player and a swap leaves nothing to save.

### Why

Two owners disagreed (#886). The Session owned side order, while the setup form swapped the Slot's sides alongside `SwapPlayers` and Save wrote them. The Overlay read names from the Slot and life, game wins and active and first player from the Session. After Swap the Overlay paired each name with the other player's state. After Save the Slot was swapped too, the correction re-oriented the rebuild a second time, and the controls paired each name with the other player's state. No sequence of steps put every surface right. Keeping the Session as the one owner fixes it without a Slot write beside a Session command, which Sequenced Live State cannot make atomic, and Reverse Sync and Feature Match Slot Promotion keep writing Match order to the Slot unchallenged.

### Consequences

- A Slot's sides, and a Slot-side Feature Match Deck List or Leader (ADR-0057), never move on a swap. The Session's snapshot carries them with their player.
- A new Session opens in Slot order: a swap lasts as long as its Session.
- A Deck List Screen whose Deck Source is a Slot side follows that Slot side's player, whichever side the Session shows them on. Every surface that shows a Slot's two sides shows them in the Session's order; with no active Session it shows Slot order. A Head-to-Head re-reads when the Session seats its Players on the other sides, and the Card Spotlight Screen's matchup Deck Lists reload. A Match picked by Round keeps Match order, because a Match has no Session.
- The Overlay's player values now come from the snapshot, which merges a seated Player's data under the Slot's overrides, as Graphic Input Bindings already did.
- A Session swapped and then saved before this decision holds its snapshot back in Slot order while its state stays swapped. Resetting the match realigns it, and so does any new Session.
- Neither ADR-0045 nor ADR-0015 changes. A setup save still writes a seated Player's identity edits through, by the Slot side's Player, and sideboard reveal still rides Session state per side.
- `test/unit/server/services/featureMatchSideOrder.sqlite.test.ts` holds the swap, swap-then-save and swap-save-swap paths for an MTG and an OP Event.

### Rejected alternatives

- **The Slot owns side order, and `SwapPlayers` swaps the Slot row too.** It needs a Slot write alongside a Session command, and it conflicts with promotion and Reverse Sync, which write Match order.
- **Detect a swapped Slot in the correction.** It would have to match players by id, or by typed data on an OP Event, and the Overlay would still be wrong between Swap and Save.

## ADR-0059: A Feature Match Layout's Graphic Animation Preview plays the whole layout or one Graphic Item alone

Accepted · 2026-11-03 · [#749](https://github.com/KeeprDigital/stream-keepr/issues/749). Records E31 and E32 from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783).

### Decision

**The Feature Match Overlay editor offers the Graphic Animation Preview Broadcast Graphics has, over two subjects: the whole Feature Match Layout, or the selected Graphic Item alone (E31).** Phase or lifecycle, speed, loop, Play and Stop are the same controls (`GraphicsAnimationPreviewControls`); the run is the same plan with an optional `itemId`; the frame runs the same clock (`useGraphicAnimationPreviewClock`) and times the run with the same function (`resolveGraphicAnimationPreview`). A Feature Match Overlay pushes a whole mode configuration rather than a preview state, so its run travels on its own shared message, `graphics-compositor:preview-animation`, as the compositor selection already does.

**One item alone means its motion is isolated, and nothing else changes.** Every other owner — the composition, its siblings, and the Graphic Group it sits in — is held at its Graphic Resting State, with its animation Theme bindings dropped so the render model cannot paint them back. The item starts at the run's start, free of any container's stagger. A selected Graphic Group keeps its children's recipes and its own stagger over them, since that is the group's motion. The run then composes through the projection a live output uses.

**A layout's lifecycle is enter, on-screen and exit.** A Feature Match Layout declares no Graphic Inputs, so it never updates: its controls offer no update phase, and a lifecycle run goes straight from on-screen to exit rather than pausing where an update would be.

**The Frame's Animation Effect keeps running during a run (E32).** A run moves Graphic Items only; the Frame and Source Items are host-owned and untouched.

**Only a preview frame listens, and nothing writes.** A live Screen Output installs no listener for the run. The controls send a plan to the embedded frame and write no Screen configuration, so they need no Graphics Authoring Lease and work for a read-only observer.

### Why

The two editors author the same Graphic Item recipes, and a Feature Match Layout has no lifecycle on air of its own, so the composition run is the only place an author sees an enter, on-screen and exit together. The item run answers "what does this recipe do?" without the rest of the layout moving.

### Consequences

- Broadcast Graphics still previews a whole Broadcast Graphic; its frame ignores an `itemId`.
- During a one-item run in a preview backed by a real Feature Match Slot, a sideboard reveal on another Deck List Graphic Item snaps rather than plays, because its recipes are isolated away. A live output is unaffected.
- A frame that reloads mid-run (an output or guide switch) is handed the same run and plays it from the start.
- `test/unit/app/modules/graphicsAnimationPreview.test.ts` holds the timing and isolation rules; the Feature Match Overlay Display and preview aside tests hold the wiring.

### Rejected alternatives

- **An owner filter in the shared render model.** It would add a preview-only input to the model every live output composes through. Isolating motion in the composition leaves that model unchanged.
- **Projecting the item through the per-item animation input** (the sideboard reveal's). That input applies no stagger, so a selected Graphic Group's children would play together rather than in their authored order.

## ADR-0060: Deleting a Phase, Round or Archetype releases every Event Reference naming it

Accepted · 2026-11-03 · [#907](https://github.com/KeeprDigital/stream-keepr/issues/907). Extends ADR-0032 and ADR-0038.

### Decision

**A Phase, Round or Archetype a Screen names can be deleted, and the delete unsets that Event Reference in the same write.** `buildReleaseScreenEventReferencesQuery` removes, from each Screen in the Event, every Event Reference of the given kinds naming a record the Event no longer holds, and bumps its `stateVersion`. The fields come from the Screen Mode Definitions' `eventReferences` of kind `phase`, `round` and `archetype` (ADR-0038), not a list kept here, so a new mode declaring one is released with no further change. Today they are Top Cut Bracket `phaseId`, Standings, Pairings and Round Clock `roundId`, and Archetype Spotlight `archetypeId`. The field is removed, not nulled: each is optional, and a Standings Screen with no Round shows the Current Round.

**Every path that deletes one runs it, in the delete's batch, after the delete.** Deleting a Round releases Rounds; deleting a Phase releases Phases and the Rounds it cascades away; deleting an Archetype releases Archetypes. Melee Sync's removal of stale imported structure and the Melee data reset release Phases and Rounds (`buildRemoveImportedStructureQueries`). It runs after the delete, unlike ADR-0032's clear, and selects by absence rather than by id: a cascade and an imported structure removal decide what they delete as the batch runs (ADR-0040), so only afterwards does the Event say what is gone.

**Each released Screen is announced with `screen:updated`, ahead of the delete's own announcement and without an origin**, as ADR-0032 does. The Melee data reset answers a Screen both its releases rewrote once, at the later version.

**Contradicts ADR-0030, which says every Screen write passes through `screenWriteModule()`,** as ADR-0032 does and for the same reason: the release has to commit in the delete's batch. It also skips the ADR-0038 reference check every Screen write runs; it only removes Event References, so it cannot name anything outside the Event.

### Why

A Screen left naming a deleted Phase, Round or Archetype rendered an empty bracket, a missing Round or an error state, and every later full Screen write failed, because the write checks every declared Event Reference (ADR-0038). The operator could not save the Screen until they repicked. Unset is what an operator gets by deselecting first, and the Melee data reset and a sync delete this structure as a side effect, so refusing the delete would make them hunt for Screens first. A Player (ADR-0032) and a Feature Match Slot (ADR-0057) were already released by their deletes, though their Deck Source keeps the field as null where these remove it.

### Consequences

- An operator form that read a released Screen before the delete gets a `stateVersion` conflict on its next save, as for any concurrent Screen write, lease holder included.
- A Screen already naming a missing Phase, Round or Archetype is released by the next delete of that kind in its Event, whichever record that delete names.
- A Phase or Round delete that finds nothing to delete still releases what the Event no longer holds, and announces it. An Archetype delete refuses a missing Archetype before it writes.
- Player and Player List references (Player History, Head-to-Head, `playerListId`) are not covered here.
- ADR-0070 adds Talent and Talent lineup references, released by a Talent delete through this query.

### Rejected alternatives

- **Clear by the deleted ids, ahead of the delete, as ADR-0032 does.** The imported structure removal decides which Phases and Rounds go as its batch runs, and a Phase takes its Rounds by cascade; each would need its own prediction of what will be deleted.
- **`AFTER DELETE` triggers.** Rejected for ADR-0032's reason: the service could not say which Screens changed, and they must be announced.

## ADR-0061: An Event has one Conversion Target, which every Metagame read counts against

Accepted · 2026-11-03 · [#908](https://github.com/KeeprDigital/stream-keepr/issues/908), settling [#783](https://github.com/KeeprDigital/stream-keepr/issues/783) Q13–Q16. Amends ADR-0022's list of what a Screen Output read derives.

### Decision

**The Conversion Target is an Event setting.** The `events` row holds `conversion_metric` (`topN` or `minPoints`) and `conversion_threshold`, Top 8 by default (migration `0001_since_v1_5_0`). The Metagame page, the Metagame Screen and Archetype Spotlight all count Conversion Rate against it. `conversionMetric` and `conversionThreshold` are former fields of both Screen Mode contracts (ADR-0037), so a stored per-Screen target is read without them.

**It is written whole, within its metric's bounds.** An Event PATCH names both fields or neither. Top N takes 1–999; a minimum-points target takes 0–999 (`shared/conversionTarget.ts`).

**The Metagame page writes it, and the write is announced.** The page's conversion control writes the operator's Event through the Event write, which announces `event:updated`. The page asks its archetype reads for the target the operator's Event holds, so it re-reads on the pending value and returns to the stored one if the write is refused. Another operator's page follows the announcement.

**A Screen Output reads it from its Event.** The Metagame and Archetype Spotlight reads take the target from the Event row, not the Screen's configuration (ADR-0022). The Event context a Screen Output holds carries the target, so an `event:updated` folded into it changes what its Screen Mode Data Freshness source asks, and the mode re-reads. A Metagame cards breakdown asks for no target and does not re-read.

**Screen Settings show the target read-only.** Both editors name the Event's target and link to the Metagame page; Metagame shows it while the Conversion Rate column shows or the archetypes sort by Conversion Rate, which Sort by now offers.

### Why

Three targets disagreed (#783): one per Metagame Screen, one per Archetype Spotlight, and the page's, held only in the browser and reset to Top 8 on reload. A Screen's Conversion Rate matched the page's only by coincidence, and a display reset sent a Screen back to Top 8. One target per Event makes every surface answer the same question, and a display reset cannot touch an Event setting.

### Consequences

- **A Screen whose stored target differed from Top 8 changes on upgrade**, to its Event's target, which starts at Top 8. An operator sets the Event's target once on the Metagame page.
- Two Screens of one Event can no longer show Conversion Rates against different targets.
- The page's metagame API still takes the target as query parameters, so the page can ask for its pending value; only a Screen Output's read takes it from the Event.
- A minimum-points target of 0 counts every Player in the scope as converted.
- A Screen rendering mounted in the writing operator's own client would re-read on the pending target, before the write commits, and skip its own announcement. None is: the control lives on the Metagame page, which mounts no Screen rendering, and a rendering mounted later reads the stored target.
- Each threshold step is an announced Event write, and every Metagame and Archetype Spotlight Screen Output re-reads once per step.

### Rejected alternatives

- **A per-Screen target with a "match the page" default**: keeps two answers to one question, and the page's target had nowhere durable to live.
- **Reading the target server-side for the page's reads too**: the page's optimistic write would be read back as the old target until the write commits.

## ADR-0062: The Feature Match Stress Dataset overrides a bound Slot, in the editor's preview only

Accepted · 2026-11-04 · [#743](https://github.com/KeeprDigital/stream-keepr/issues/743).

### Decision

**A second named dataset, not a wider Sample Dataset.** The Feature Match Stress Dataset (`shared/featureMatchStressDataset.ts`) sits beside the Feature Match Sample Dataset: one per Card Game, each the longest plausible value of every Feature Match token, and of the live state the context-gated Graphic Items read. The clock is `formatClockTime`'s widest form, or for an Untimed Match an Untimed Label at the Event schema's maximum; the active Session's clock type decides which, or else the Event's Match Format. A One Piece side has no record, life or Sideboard, as in the sample (ADR-0057), and is named and coloured by the catalogue's longest two-colour Leaders.

**The editor asks for it on the preview's URL, and it overrides live data there.** The Feature Match Overlay editor's preview toggle adds `stress=1` to its frame's URL. The display session reads it only with `embed=preview`, exactly as it reads the guide flags, so no Screen Output and no Program monitor shows it. While it is on, the preview resolves against it even with a Feature Match Slot bound. The toggle is never written, so it is offered whether or not the session holds the Graphics Authoring Lease.

### Why

The sample is typical, so overflow shows up on show day rather than while authoring. A fixed set keeps the stress preview the same for every author, as the sample's canonical values do. Overriding a bound Slot lets an author stress a layout already bound for the show, and nothing about it can reach air.

### Consequences

- A hand-built `embed=preview&stress=1` URL shows stress values; it is the same accepted residual as the guide flags (`app/modules/screen/displaySession.ts`).
- Toggling reloads the preview frame, which the editor answers with a full push, as for the guide switches.
- A Theme preview has no toggle; it shows the sample.

### Rejected alternatives

- **Amend the Sample Dataset to be the worst case.** A preview of only worst cases stops looking like a show, and the sample is shared with the Screen Mode Sample Dataset.
- **Push the toggle by message instead of the URL.** It avoids a reload, but a frame listening for it must also be shown to refuse it on a live output; the URL flag reuses the guide flags' proven gate.

## ADR-0063: A Layer Lock is stored on the layer in the Feature Match Layout, and the canvas clicks through it

Accepted · 2026-11-04 · [#747](https://github.com/KeeprDigital/stream-keepr/issues/747) · Amended 2026-11-04: the lock moved from this browser's storage onto the layer · [#943](https://github.com/KeeprDigital/stream-keepr/issues/943). Records E27 and E28 from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783).

### Decision

**A Layer Lock keeps a layer of a Feature Match Layout from canvas edits, and nothing else.** A locked layer is not moved, resized or rotated on the canvas and arrow nudges skip it; with several selected, the canvas moves only the unlocked ones. It stays selectable from the layer list, where it shows no canvas handles but a lock badge on its row and its canvas outline, and its property panel still edits it (E27). Delete, duplicate, hide, reorder (a drag in the layer list included), copy and paste, group and ungroup, and align and distribute are not canvas edits and still act on it.

**A click on a locked layer in the preview falls through to the layer beneath it, or to the canvas (E27).** The preview frame reads the locks from the working layout the editor already pushes it, and draws their guides without offering them.

**Locking a Graphic Group locks its children; a Source Item locks too (E28).** A child locked through its group cannot be unlocked on its own.

**A Layer Lock is the layer's own optional `locked` field in the Feature Match Layout (#943).** A Graphic Item, a Graphic Group child and a Source Item each carry one; unlocking drops the field, and a layer stored without it is unlocked, so no stored layout or Template Package needs migrating. Locking is a layout edit through the editor's one write funnel: one undo step, written only by the Graphics Authoring Lease holder (ADR-0030), and seen by every session of the Screen. The field is shared Graphic Item vocabulary, but only a Feature Match Layout holds one: a Broadcast Graphic refuses it, since no Broadcast Graphics editor shows or lifts a lock.

**A lock travels with the layout and stays with the original.** Saving a Feature Match Layout Template keeps it, and placing one or installing its Template Package (`.sklayout`) keeps it. A duplicate or a pasted copy arrives unlocked, a Graphic Group's children too, since a copy lands somewhere new to be placed. Ungrouping a locked Graphic Group bakes its lock into each child, as it bakes in the group's hiding (ADR-0065); grouping leaves each member's own lock, and the new group starts unlocked.

### Why

Frame bars and backgrounds sit under everything and were dragged by accident. Clicking through a locked layer lets the author reach what lies beneath it on the canvas, which is the point of locking it. #747 kept the lock in browser storage, which reached no other operator or machine, no template, and no undo; once operators share a Screen's editing, a lock one of them sets has to hold for the others (#943).

### Consequences

- Every operator of the Screen sees the same locks, and an observer sees them but cannot change them.
- Undoing a delete brings the layer back with its lock, since the lock is part of the layer.
- Reapplying a preset clears every lock, as presets carry none.
- A locked child of an unlocked Graphic Group still moves with its group, since the group places it; lock the group to hold both.
- One unlocked layer selected among locked ones only moves, as several do; select it alone to resize or rotate it.
- A row or column child, or a rotated group's child, has no box of its own on the canvas, so locked it is badged on its row only.
- A `.sklayout` package carrying a lock is refused by an installation built before #943, on its strict schema; the Feature Match Layout format version is unchanged, since no term changed meaning.
- Locks set in browser storage under #747 (`editor-featureMatchLayoutLocks:<screenId>`) are not imported and no longer read. #747 was never released, a browser's private lock should not silently become every operator's, and an import would make a write on opening that the author did not ask for.
- `app/modules/feature-match-overlay/layerLocks.ts` holds the lock rules. `withoutLayerLock` in `shared/modules/graphics/authoring.ts` is how every copy drops one: `cloneGraphicItem` for Graphic Items, and a Source Item's duplicate and paste. `ungroupGraphicGroup` bakes a group's lock in, and `editorLayersFrame` leaves locked layers out of what the canvas moves.

### Rejected alternatives

- **Keep the lock in browser storage, per browser per Screen (#747).** Another operator, another machine and a template would not see it, and it could not be undone.
- **One `locks` list of layer ids on the layout.** Every copy of a layer would have to be kept off the list by hand, and the lock would not sit with the layer it holds.
- **A pasted or duplicated layer keeps its lock.** It would land offset and locked, so the canvas would refuse the drag that places it and a click would fall through it.

## ADR-0064: Copied layers and styles stay in this browser, paste within their host, and paste whole or not at all

Accepted · 2026-11-04 · [#746](https://github.com/KeeprDigital/stream-keepr/issues/746) · Amended 2026-11-04: a copy arrives unlocked · [#943](https://github.com/KeeprDigital/stream-keepr/issues/943). Records E23–E26 from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783), and #746's Theme-bindings note.

### Decision

**The clipboard is this browser's storage, not the system clipboard (E23).** ⌘C copies the selected layers and ⌘⌥C one Graphic Item's style, in the Feature Match Overlay and Broadcast Graphics editors alike, so ⌘V and ⌘⌥V paste them on another Screen of another Event in the same browser. The rules live in `app/modules/graphics/clipboard.ts`. Copying is not a write, so an observer may copy; pasting is a write through each editor's lease-gated funnel (ADR-0030).

**A paste stays within its host (E24).** Feature Match Layout to Feature Match Layout, Broadcast Graphic to Broadcast Graphic, for layers and styles alike. The other host refuses with a reason.

**A paste lands whole or not at all (E25).** It is refused, naming the items, when one pins a Graphic Asset no longer selectable: retired, trashed, missing, or with unavailable content, asked of the Graphics Asset Library before writing. It is refused whole when it would pass a Graphic Item cap: a Broadcast Graphics Screen's 300 (ADR-0007), a Broadcast Graphic's or Feature Match Layout's 100, or a Graphic Group's 50. The commit still checks every reference as for any Screen write (ADR-0034). In Broadcast Graphics an item reading a Social Profile Projection pastes only into that projection's Presentation Group, since the projection does not travel with it and the write path refuses it anywhere else.

**Copies land in front, offset 20 pixels from where they were on the canvas.** A Graphic Group arrives with its children. Every copy gets a fresh id, arrives unlocked (ADR-0063), and keeps its name unless one in the destination already carries it. With a Graphic Group selected, or one of its children, copied non-group items land in it.

**Style paste follows the Graphic Item Definition (E26).** Between items of one Definition, every style group it declares pastes: typography, each Graphic Surface Style, and its Shape Geometry. Between two kinds that both paint a surface, only the Graphic Surface Style does. Anything else is refused.

**Graphic Theme Bindings travel.** A pasted layer keeps its `themeBindings`, so each bound group paints from the destination Screen's resolved Theme. A pasted style group carries its binding state: bound in the source binds the target to the same token, unbound pastes the literal and detaches the target.

### Why

Each is #783's recommendation for v1. Reading the system clipboard needs the browser's permission, and app-local storage already reaches every Screen in the browser. Pasting across hosts would have to drop host-only items and bindings without saying so, and a partial paste would leave the author to find what went missing.

### Consequences

- The Graphic Item caps moved to `shared/types/graphics.ts`, and `MAX_FEATURE_MATCH_SOURCE_ITEMS` to `shared/featureMatchSourceItems.ts`, so the client can refuse what the schema would. `server/schemas/api/screen.ts` re-exports them and keeps their reasoning.
- What was copied is kept per kind under a versioned key; a later build that changes the shape bumps the key rather than reading an old entry.
- Pasting a Text Graphic Item into another Broadcast Graphic does not carry the Graphic Inputs its `{inputKey}` placeholders name; they render as they would for any undeclared key.
- A Graphic Group's stagger still names its original children's ids, as a duplicate's does; stale ids are legal (ADR-0007).
- Each paste offsets from the copied position, so pasting twice lands both copies in one place.

### Rejected alternatives

- **The system clipboard as JSON (E23 b).**
- **Pasting across hosts, dropping what the other host cannot hold (E24 b).**
- **Pasting without an unselectable reference (E25 b).** The item would arrive without its picture or font, and nobody would be told.

## ADR-0065: Ungrouping keeps what each child draws, and what only the group drew goes with it

Accepted · 2026-11-04 · [#920](https://github.com/KeeprDigital/stream-keepr/issues/920) · Amended 2026-11-04: a locked group's children come out locked · [#943](https://github.com/KeeprDigital/stream-keepr/issues/943). Records E11 and E12 from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783).

### Decision

**⌘G wraps two or more top-level Graphic Items in a canvas Graphic Group that changes nothing drawn.** Its box is the union of what its members draw, a rotated member by the box it turns into; it paints no surface and clips nothing, and it takes the frontmost member's slot in the Graphic Layer Order. A Source Item, a Graphic Group or a group's child refuses the selection (E8, E9), as does one larger than a group may hold (`MAX_GRAPHIC_GROUP_CHILDREN`, 50), and the editor says why.

**⌘⇧G puts each child on the canvas where its group drew it.** A canvas group's children are rebased as any item leaving a group is (`placeGraphicItem`). A row or column group's children are first placed where its flex layout put them (`laidOutOnCanvas` in `shared/modules/graphics/authoring.ts`), taking their laid-out size and losing a rotation the row never drew; a hidden child takes no space there and keeps its stored corner.

**What a child inherited is baked in; what only the group drew is dropped.** A child that can paint a surface but holds none of its own takes the group's local style default, and the default's Graphic Theme Binding, and a hidden group's children are hidden, each where the group laid it out; a locked group's children are locked (ADR-0063). The group's clipping, animation and stagger go, and so do its own surface and glow, which belonged to the group rather than to any child.

**Two visible changes are accepted for v1.** Ungrouping drops the group's own surface and glow, though its glow, a filter over the whole group, also lit its children; undo restores them. Resting positions are kept but motion is not: grouping takes members out of the Broadcast Graphic's stagger, and a member's `clear-parent` slide then clears the group's box rather than the canvas; ungrouping drops the group's stagger.

### Why

"Nothing moves" is the authoring promise of grouping both ways. A row or column child's stored corner is not where it is drawn, so rebasing from that corner, as moving one layer out of a group does (#741), would scatter a whole stack at once.

### Consequences

- The flex layout is computed twice: in CSS by the compositor (`stackedPlacement` in `app/modules/graphics/renderModel.ts`) and in `laidOutOnCanvas`. A change to one must change the other; the ungroup tests pin the layout cases.
- A child laid out to no size is stored a pixel wide, the least the write schema admits.

### Rejected alternatives

- **Replace the group's surface with a Shape Graphic Item.** It keeps the backdrop, but invents a layer the author never made; E12 drops what is not inherited.
- **Refuse to ungroup a row or column group.** The author would have to switch it to canvas first, which moves its children, so the only way out of a stack would move what it held.

## ADR-0066: A Round's start and duration are the operator's, and a Round Clock projects from them

Accepted · 2026-11-04 · [#916](https://github.com/KeeprDigital/stream-keepr/issues/916). Records N1 b from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783). Extends ADR-0040 and ADR-0046; follows ADR-0009 and ADR-0022 · Amended 2026-11-06 (ADR-0076): a Round Clock's Screen may count up after the end, to an optional limit

### Decision

**A Round gains an optional start and duration, entered by an operator.** `rounds.started_at` (a server timestamp) and `rounds.duration_minutes` (whole minutes, 1 to 600) are added by migration `0001_since_v1_5_0`. Both are `manualWritable` in `PROVENANCE_ENTITIES`, so a Round edit (`PATCH …/rounds/:roundId`) accepts them, an ISO instant and a number, and `null` clears either. A new Round starts untimed: the create write refuses them. They ride the Round's response, so `round:updated` announces them.

**"Start now" sets the start to server time.** `POST …/rounds/:roundId/start` (`roundWriteModule().start`) writes the server's own clock as the start, so the operator's browser clock never sets it. The Event Structure page offers it on each Round row until the Round has started, then in the Round's menu, where it restarts the clock. The Round edit modal edits the start and duration, and sends either only when edited, so a save never undoes a "Start now" made while it was open.

**Melee Sync never writes either field, whether the Round is imported or manual.** Melee imports no timing, and neither its Round upsert (`upsertByExternalId`) nor its removal of imported structure (ADR-0040) names them, so an imported Round keeps its operator's timing through every sync, and through being kept as manual structure. Unlike ADR-0046, no edited-field list is needed: there is no Melee value to keep apart.

**The Round Clock Screen Mode shows a Round's time remaining as a clock projection.** `projectRoundClock` (`shared/utils/roundClock.ts`) is a pure function of the Round's start, its duration and server time: before the start, or with none, it shows the full duration, not running; after the end, `0:00`, or the time since the end where its Screen counts up (ADR-0076); with no duration, no clock. Every rendering evaluates it on the shared clock (`useServerTime`) and re-evaluates exactly when it next changes (a start further off than one timer can wait is waited for in steps), so renderings of the same Round agree, and nothing writes as it runs or when it runs out, as with Page Rotation (ADR-0009) and Card Timeout (ADR-0022). The display uses `formatClockTime`.

**It shows the Current Round unless it picks a Round.** Its `roundId` is an Event Reference of kind `round` (ADR-0038), released when that Round is deleted (ADR-0060). Unset, its Screen Output read (`round-clock`) answers the Current Round (ADR-0052), so a Melee Event's clock follows the Event from Round to Round. Its data re-reads on its Round's `round:updated`, so "Start now" starts every output counting without a reload, and while following the Current Round, on any Round, Phase, Match or Melee pairing change that may move it.

**It is a plain overlay mode, Magic: The Gathering only.** It declares `cardGames: MTG_ONLY` (a One Piece Card Game Event has no Rounds, ADR-0057), a Background Layer stack, and Mode Tokens defaulting to Foundation Tokens: its surface, the Round name's type and colour, and the clock's type and its colour running, before the start and after the end. A Theme preview shows it through the Screen Mode Sample Dataset's Round 8, not yet started, at 50:00.

### Why

Productions want an on-air clock of the time left in the Round, and Rounds stored no timing and Melee Sync imports none, so the operator enters it. A projection, rather than a ticking state an output persists, keeps every output in step without a writer and survives a realtime outage, the reasons ADR-0009 gives.

### Consequences

- The clock is only as right as the operator's entry. A Round started late on the floor is corrected by editing its start or pressing "Start now" again.
- A manual Event has no Current Round, so its Round Clock must pick a Round.
- The sample shows the clock before its start, so a Theme preview paints the clock's colour before the start, not its running or ended colours; the Theme token tests probe all three.
- Tests: `test/unit/shared/roundClock.test.ts` holds the projection on a fake clock; `test/unit/server/schemas/round.test.ts` the duration's bounds; `test/unit/server/modules/roundTiming.sqlite.test.ts` the Round writes, "Start now" and both Melee Sync paths; `test/unit/server/services/roundClock.sqlite.test.ts` which Round the read shows; `test/nuxt/composables/screen/useRoundClockModeData.test.ts` the ticking and re-reads.

### Rejected alternatives

- **Melee-imported Round timing.** Melee Sync imports none today, and #783 chose operator entry (N1 b).
- **The browser's clock stamps "Start now".** Two operators' browsers can disagree by seconds; the server's clock is the one every rendering already syncs to.
- **A timer state an operator pauses.** A pause is a Feature Match Session clock's concern, not a Round's. Counting up past the end was rejected here too, as the ticket asked for `0:00`; ADR-0076 reopened it as a Screen setting, off by default.

## ADR-0067: A Talent's photo is a Graphic Asset Reference that holds Retire back

Accepted · 2026-11-04 · [#918](https://github.com/KeeprDigital/stream-keepr/issues/918). Records T4 b from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783).

### Decision

**A Talent may hold a photo: an ordinary Graphic Asset Reference to one exact image revision, or none.** Image only; a silent video is refused. The Talent row stores `{ assetId, revisionId }` in `event_talents.photo`, and the Talent's existing `talent:created` and `talent:updated` messages carry it.

**It is indexed under a new owner kind, `talent`,** with the Talent's id, slot `photo`, and the Talent's Event as the reference's `event_id`. A write naming the photo is held to ADR-0034's rule: the route asks the library first, so a refusal names the slot, and the statement that commits the Talent row asks again (`REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE`). Setting the photo replaces the slot in that commit; `null` clears it and releases the reference. A write that omits `photo` leaves both alone. Deleting the Talent releases it in the same commit, and deleting the Event drops it through the reference's `event_id` cascade.

**Retire is refused while a Talent references the asset,** as for a Theme (ADR-0050). Trash was already refused for any reference. The usage names the Talent and its Event's name, and the Library Workspace's refusal says both.

**The Screen Output Asset Capability was left unchanged here.** The photo showed in the operator app only, read through the authenticated revision content route. ADR-0070 (#782) extends the capability so a Talent Screen showing photos admits the photo revision of each Talent it shows.

### Why

The Talent Screen Mode (#782) and productions need a photo per Talent, and all broadcast media comes from the Graphics Asset Library. Without the Retire guard a Talent could keep a photo the library had hidden from discovery, and any write re-stating it would be refused, as ADR-0034 found for templates.

### Consequences

- A Talent cannot hold a retired photo, so a photo write needs no retained-reference allowance.
- Binding a Talent's photo to a Broadcast Graphics media Graphic Input is not covered; it needs its own ticket.
- `event_talents.graphic_asset_reference_version` is the one-shot token a photo write stamps, as a Theme's is, so the index rows are written only beside the Talent row the batch committed. A create learns its new Talent's id through it.

### Rejected alternatives

- **Let Retire proceed, as a Screen's own mode reference does.** The Talent would keep a retired photo that #782 would put on air; the maintainer chose the Theme's rule (#918).
- **Admit the photo in the capability now.** No Screen Mode shows a Talent's photo yet; #782 owns that change, made by ADR-0070.

## ADR-0068: An Installed Graphics Template may be removed, releasing its references, and a retried installation reinstalls it

Accepted · 2026-11-04 · [#622](https://github.com/KeeprDigital/stream-keepr/issues/622) · Amends ADR-0034

### Decision

**Any signed-in User may remove an Installed Graphics Template.** It is the library's own Delete, for an imported entry as for an authored one. #411 will narrow who may. Removal releases the Template's Graphic Asset References and takes it out of the library in one transaction (`removeInstalledGraphicsTemplate` in the Graphics Asset Library). Copies placed from it are independent and unaffected. Editing an Installed Graphics Template stays out of scope: it is still never renamed or revised, and is changed by placing it and saving the placed copy.

**The row stays, as provenance.** A removed Template keeps its document, source identity and installing operation, marked with `removed_at` and `removed_by`. It is in no listing, reads as not found, and holds no reference, so nothing in the library counts it. The Graphics Ingestion Operation that installed it keeps its idempotency key and its `packageInstallation` receipt unchanged.

**Retrying the installation reinstalls the same Template.** Posting the installation of a completed operation answers with that operation, as before. When the Template it published has been removed, the post first reinstalls it under the same identity. The staged package is long released, but nothing needs it: the stored document already names local revisions, so reinstalling re-indexes those (`installedTemplateDocumentReferences`). As installation required of a reused revision, each must exist on an active Graphic Asset. If one is retired, trashed or gone, the retry is refused with `409` and nothing changes; restoring the asset, or importing the Template Package again, is the way back. Importing again creates a new Installed Graphics Template, as it always has.

**Removal follows the Retire and Trash rules.** A Graphic Asset is refused Trash while anything references it, and Retire while a template does. An Installed Graphics Template's references now hold Retire back like an authored template's (amending ADR-0034), and removing the Template is what releases them. Retire and Trash would also refuse to remove a Template something still referenced. Nothing references an Installed Graphics Template by identity today, because placing one copies it, so no removal is refused on that ground yet.

### Why

An Installed Graphics Template could not be deleted, so the revisions its references pinned could never be Trashed, pruned or purged, even after nothing else used them (#622). ADR-0034 let Retire ignore those references only because nothing could release them. With removal, they can be treated like any other template's.

### Consequences

- A revision only a removed Template pinned is unreferenced at once: Trash may take its asset, and a superseded one becomes a Revision Pruning candidate at the next Graphics Retention Sweep. A revision another artifact still references stays held by that reference.
- **A Graphic Asset an Installed Graphics Template references can no longer be Retired** until that Template is removed. This applies to every installation already made, with no backfill: their references were always indexed under `installed-graphics-template`. An asset already retired under an Installed Graphics Template stays retired, and that Template stays unplaceable until the asset is restored.
- Only the User who started an installation can retry it, as for every Graphics Ingestion Operation, while any signed-in User may remove what it installed. A retry reinstalls only while that operation's record exists; the retention contract plans to clean one up a year after it ends. Either way, importing the Template Package again still works, as a new Installed Graphics Template. The library's Delete prompt says so.
- Removal records no Evidence: it is not a Graphic Asset lifecycle transition. The removed row's `removed_by` and `removed_at` record who removed it and when.
- Migration `0001_since_v1_5_0`, in its `installed_template_removal` section, adds the two nullable columns. Existing rows read as installed.

### Rejected alternatives

- **Delete the row.** A retried installation would then have nothing to reinstall from, because its staged bytes are released at completion, and the receipt would name a Template no record explains.
- **Refuse a retry after removal as already handled.** The maintainer chose to reinstall (#622).
- **Two-stage removal, like Trash, with a restore window.** Retrying the installation already restores a removed Template, for as long as its assets can take references.

## ADR-0069: An Archetype's Pinned Chart Series names a Theme chart series, and is placed before the id rule

Accepted · 2026-11-04 · [#909](https://github.com/KeeprDigital/stream-keepr/issues/909), settling [#783](https://github.com/KeeprDigital/stream-keepr/issues/783) Q17. Builds on ADR-0049 and ADR-0051.

### Decision

**The pin is a series slot, 1 to 8, stored on the Archetype.** The `archetypes` row holds a nullable `chart_series` (migration `0001_since_v1_5_0`). It names one of the Metagame Mode Tokens `chart-series-1` to `chart-series-8`; the Theme, or a Screen Theme Override, still decides what each series looks like, and a Screen holds no look of its own (ADR-0051).

**An operator sets and clears it through the Archetype write.** The Archetype PATCH takes `chartSeries` (an integer 1–8, or null); the write announces `archetype:updated`, which every Metagame Screen already re-reads on. Creating an Archetype takes no pin, and Melee Sync writes no Archetype field, so it never writes one. The Archetype's Metagame page edits it, naming any other Archetype pinning the same series and warning when the chosen one is taken.

**The chart places pins first.** `assignColorSlots` (`shared/utils/metagameChart.ts`) gives each shown pinned Archetype its series, lowest id first; one whose series a lower id already holds is placed as if unpinned. The unpinned then take the remaining slots by the existing preferred-slot rule. The breakdown carries each Archetype's `chartSeries`, so every chart reading it colours alike.

### Why

The id-derived slot moves an Archetype whenever another preferring the same slot enters or leaves the chart, so an operator could not hold one Archetype in one colour for a show. #783 tied the pin to the shared Screen style (#781), which Themes superseded; pinning a literal colour would have given a Screen a look of its own and bypassed the Theme.

### Consequences

- A pinned Archetype keeps its series whichever others enter or leave the chart, unless a lower-id Archetype pinning the same series is shown too.
- Pins are not unique: two Archetypes may pin one series, and only the chart decides between them, by id, which is creation order.
- Changing the Theme's chart series recolours every pinned Archetype with it.

### Rejected alternatives

- **Pin a literal colour.** It would bypass the Theme and Screen Theme Overrides, contradicting ADR-0049 and ADR-0051.
- **Refuse a pin another Archetype holds.** Only Archetypes shown together clash, and which are shown depends on scope and limit; a warning leaves the operator to decide.

## ADR-0070: A Talent Screen names its Talents as Event References, and its output resolves the photos it shows

Accepted · 2026-11-04 · [#782](https://github.com/KeeprDigital/stream-keepr/issues/782). Records T1 to T6 from [#783](https://github.com/KeeprDigital/stream-keepr/issues/783). Extends ADR-0038, ADR-0050, ADR-0060 and ADR-0067.

### Decision

**The Talent Screen Mode (`talent`) shows one Talent or a lineup, chosen by a setting.** `selection` is `one` or `lineup`; `talentId` names the one Talent and `talentIds` the lineup, at most eight, in the order shown. The choice not taken is kept, as Head-to-Head keeps its. Layout is a setting: `lowerThird` or `fullPanel`. It is a plain overlay mode, with Mode Tokens defaulting to Foundation Tokens (ADR-0049), its own Background Layer stack and the generic header, off by default. There is no live quick control (T6 a).

**Each picked Talent is an Event Reference.** `talentId` is of a new kind, `talent`, and `talentIds` of another, `talentLineup`, whose value is a list of Talent ids. A Screen write naming another Event's Talent is refused with 404 `Talent not found`, as for every kind (ADR-0038).

**Deleting a Talent releases it in the same write.** The Talent delete batches `buildReleaseScreenEventReferencesQuery(eventId, ['talent', 'talentLineup'])` after the delete, beside the photo release (ADR-0067), and announces each released Screen with `screen:updated`, without an origin, before `talent:deleted` (ADR-0060). A `talent` field is removed. A `talentLineup` list loses only the ids the Event no longer holds, keeping the rest in order; it is not removed, since the lineup's other Talents still stand.

**The operator picks which Supported Social Networks show** (`socialNetworks`), and they show in the catalog's order whatever order they were picked in. **An optional Social Profile Rotation** (`rotateSocialProfiles`, default off) shows one profile at a time for `socialProfileDwellMs`, 2 to 60 seconds, default 8. It has no Live Session to anchor it, so it is projected from epoch zero, as a Page Rotation with no anchor is (ADR-0009): every rendering at one server instant shows the same profile, every Talent of a lineup steps at the same instant through its own profiles, and nothing writes. It reuses the Social Profile Projection's `projectSocialProfileRotation`, with a cut. An unsynced rendering shows the first profile.

**The Screen Output read** `GET /api/screen-output/events/:id/screens/:screenId/talent` answers the picked Talents in order, skipping any the Event no longer holds, each with its name, role, photo and the Social Profiles on the chosen networks (ADR-0022). It answers the photo only while the Screen shows photos (`showPhoto`).

**The Screen Output Asset Capability admits the photo of each Talent its Screen shows, while the Screen is in Talent mode and shows photos.** The revision must be indexed by that Talent's `talent`/`photo` Graphic Asset Reference in the Screen's Event (ADR-0067), so a photo replaced or cleared stops resolving with the write that released it. A Talent the Screen keeps but does not show, such as the one Talent while it shows a lineup, supplies nothing. It is a third path beside the mode's own references and the resolved Theme Tokens (ADR-0050), not an index row the Screen owns.

**It is offered to Events of every Card Game.** It needs no results and no Deck Lists, so ADR-0057 does not exclude it.

**A Talent holds a free-text role** (`event_talents.role`, migration `0001_since_v1_5_0`), at most 100 characters, trimmed, blank stored as none. It is edited with the Talent, carried on `talent:created` and `talent:updated`, and shown on the Screen while `showRole` is on (T5 b).

### Why

Productions want a plain "on the desk" Screen without authoring a Broadcast Graphic, and #783 settled its shape. A Talent's photo is indexed by the Talent, not the Screen, so the Screen write cannot index it as a mode reference without copying the Talent's photo into every Screen naming it, and keeping those copies current on each Talent write. Reading the Talent's own reference keeps one owner, and the capability already reads past the Screen's own rows for Theme content. A lineup that lost a deleted Talent should still show the rest, so it drops the id rather than unsetting the field.

### Consequences

- A Talent Screen's output re-reads on `talent:updated` and `talent:deleted` for a Talent it shows, and on a config change of what the read derives from: the Talents, the networks and `showPhoto`.
- A photo shown on a Talent Screen can still not be retired, since the Talent's reference holds Retire back (ADR-0067); the Screen adds no reference of its own.
- The Screen Mode Sample Dataset holds a sample lineup, a host and a commentator without photos, so a Theme preview renders the mode for either Card Game.
- Binding a Talent's role to a Broadcast Graphics Graphic Input is not covered.

### Rejected alternatives

- **Index the shown photos under the Screen's own owner slots.** Every Talent photo write would have to rewrite the index of each Screen naming that Talent, or the output would resolve a replaced photo until the Screen was next saved.
- **One list for both choices, showing its first Talent in `one`.** Switching between one Talent and the lineup would lose the one Talent picked, and picking one would reorder the lineup.
- **Re-anchor the rotation when it is turned on.** It would need a stored anchor and the Page Rotation's write rules; with every Talent stepping together from epoch zero there is no visible restart to protect.

## ADR-0071: The migrations unreleased at v1.5.0 are squashed into one, and journal numbers are never reserved

Accepted · 2026-11-04 · [#953](https://github.com/KeeprDigital/stream-keepr/issues/953). Amends ADR-0019.

### Decision

**The 21 migrations merged after v1.5.0 become one, `0001_since_v1_5_0.sql`.** v1.5.0, the production release, had applied only `0000_baseline`. The originals are concatenated verbatim in their order, each under a `-- Section: <name>` comment, so every backfill, rewrite and trigger runs as it did. Their numbers had run 0001–0016 and then 0020–0024. The squash makes file numbers match journal positions again. It is a one-time repair, not a release step: later releases ship their migrations as they are.

**The next migration takes the next journal number** (README § Database). A branch never reserves a number ahead, and it does not rename a file to claim one. `migrationJournal.test.ts` fails on a gap.

### Why

drizzle-kit numbers a new migration by its count of journal entries and diffs against the snapshot that sorts last. With the gap, every `pnpm db:generate` produced a file that needed a hand rename, and a missed rename produced a duplicate migration. Production has applied none of the 21, so they could be rewritten without touching its `_hub_migrations`; ADR-0019's window closed only for what has shipped.

Concatenation rather than a regenerated diff keeps the hand-written data statements that drizzle-kit cannot emit. One file rather than a renumbered 0001–0021 moves production from v1.5.0 to the next release in one recorded step. Wrangler sends a migration and its `_hub_migrations` row as a single query. A renumber would keep 21 recorded points where a failed deploy could stop, in states no release ever ran.

### Consequences

- The held-back migration tests hold back at `0000`, so they arrange rows in production's schema, not some unreleased intermediate one.
- A local D1 that applied the old names needs a one-time reset (README § Database). Production needs none, but before the first deploy carrying this, its `_hub_migrations` must list only `0000_baseline.sql`.
- Earlier ADRs that named a numbered migration now name `0001_since_v1_5_0`, and its section where that helps.

### Rejected alternatives

- **Renumber to 0001–0021.** Keeps the per-migration files, but production would take 21 separately recorded steps for one release, and the held-back tests would keep arranging rows in intermediate schemas no deployed database will hold.
- **Regenerate one diff from the baseline snapshot.** It would drop the backfills and the Deck-source triggers that drizzle-kit cannot generate.

## ADR-0072: A Mode Token names the Screen Settings Group it styles, and its override renders there

Accepted · 2026-11-04 · [#955](https://github.com/KeeprDigital/stream-keepr/issues/955), [#968](https://github.com/KeeprDigital/stream-keepr/issues/968), [#969](https://github.com/KeeprDigital/stream-keepr/issues/969), [#970](https://github.com/KeeprDigital/stream-keepr/issues/970) · Amends ADR-0037 · Builds on ADR-0049 and ADR-0051

### Decision

**A Mode Token declares its Screen Settings Group on the token** (`settingsGroup` on `DeclaredModeTokenDefinition`), as ADR-0037 has a contract field carry its editor meta. The field is required, and the type takes the groups its mode declares (`DeclaredModeTokenDefinition<StandingsSettingsGroup>`), so a token cannot leave its group out or name one its mode does not have. The groups follow the audit's grouping per mode: Standings' `header`, `table` and `data`; Metagame's `chart` and `size-and-surface`; a badge's own group, such as Most Played Cards' `rank-badge`.

**Every token a Screen may override renders once on its settings page** (`placeScreenThemeTokens` in `shared/screenThemeOverrides.ts`). That is what its mode's declaration consumes, plus, on a graphics host, every Foundation Token its Graphic Items may bind (ADR-0049). Each lands in one place:

- **A Mode Token** renders in its group, under a "Look" subheading after the group's config controls, as a compact row (`ScreenThemeTokenGroup`). A mounted group registers itself with the page (`provideScreenSettingsGroups`) for as long as its `ScreenSettingsCard` is on it: collapsing the card unmounts its body, but not the registration, so its tokens do not move. Until a group registers, its tokens render in the residual card, so a token never disappears or doubles while a mode's settings have not adopted its group yet.
- **A plain mode's host tokens**, `inset` and `alignment`, render in **Background & Placement**, beside the mode's Background Layer stack.
- **Every other Foundation Token** renders in the residual **Screen-wide look**. Foundation Tokens stay overridable per Screen, but together: overriding one restyles every Mode Token following it, so placing it beside one element would mislead.

The coverage test places each mode's tokens with no group, one group and every group mounted, and fails if one is placed twice or not at all.

**The page ends with Background & Placement, then Screen-wide look.** The order is the Screen info card, the mode's settings, Background & Placement, then the Screen-wide look. Both closing cards start closed unless something in them is set or overridden: a Background Layer or a host token's override, or an override of a token the residual lists. Data and live-action cards stay open and are not collapsible. Each collapsible card remembers its open state per browser by `mode:card` id (`ScreenSettingsCard`, #964). Editor Focus Mode hides both closing cards, as it hid the Theme card. A group's Look is part of the mode's settings, so it shows in Editor Focus Mode: the Feature Match Overlay's Frame and Source Item rows show there once its inspector mounts their groups (#982).

**Only where a row renders changes.** A row still writes a Screen Theme Override (`PATCH …/theme-overrides`) and shows Theme against Overridden (ADR-0049). It never becomes mode config (ADR-0051). A display reset still leaves every override in place, whichever card shows it.

### Why

All of a Screen's Mode Tokens sat in one flat Theme card above the mode's settings, about 35 entries on Metagame. Each entry sat apart from the control for the element it styles. Declaring the group on the token keeps one copy that a test can check, as the editor meta on a contract field does. A per-page list would be a second copy that drifts from the declaration.

### Consequences

- `useScreenThemeOverrides` holds the Theme load, the resolution, and the per-token write and Clear for every card that renders rows. Cards mounting together share one in-flight read of the Event's Theme.
- No mode mounts a group yet, so each mode's Mode Tokens stay in the Screen-wide look until its own settings ticket mounts them (#971–#983).
- Both closing cards remember their open state as `<mode>:background-and-placement` and `<mode>:screen-wide-look`. Until an operator toggles one in this browser, it follows what it holds, so a group registering after the residual card mounts moves its override out and can close the card again. Once toggled, the remembered state wins over what the card holds, on every Screen of that mode.
- A Mode Token added later must name a group of its mode, or it fails to compile. It renders in the residual card until its group is mounted.
- Round Clock's and Talent's Mode Tokens name groups here too, though #968 left them for #983, so every Mode Token is placed by one rule.
- The Feature Match Overlay's inspector shows one layer's sections at a time, so its editor holds all four of its groups while open (#982). Selecting a Source Item or a Graphic Item never moves the Frame's rows into the Screen-wide look. The rows sit inside the inspector's read-only fieldset, so an observer without the Graphics Authoring Lease sees them disabled, though the override write itself is not lease-gated (ADR-0030).

### Rejected alternatives

- **List each group's tokens in its Settings component.** It is a second copy of the declaration, and nothing would catch a token placed twice or left out.
- **Remove Foundation Tokens from a plain Screen's page, leaving them to the Theme.** It drops a per-Screen override that operators use today.
- **Have display Reset offer to clear the overrides shown in the same groups.** Reset restores mode config, and an override is not config (ADR-0049). Today's behaviour stays.

## ADR-0073: The Graphics Asset Library keeps one facade, and an operation family moves behind its own smaller interface only where its invariants get a home

Accepted · 2026-11-04 · [#623](https://github.com/KeeprDigital/stream-keepr/issues/623) · Follow-ups [#989](https://github.com/KeeprDigital/stream-keepr/issues/989), [#990](https://github.com/KeeprDigital/stream-keepr/issues/990), [#991](https://github.com/KeeprDigital/stream-keepr/issues/991), [#992](https://github.com/KeeprDigital/stream-keepr/issues/992)

### Evaluation

The evidence is from `main` at `82c22f49`, after #949 (Talent photo) and #950 (Installed Graphics Template removal).

**The current interface.** Every reader and writer sees one facade, `GraphicsAssetLibrary`: 53 methods (`server/modules/graphics-asset-library/index.ts:659–1077`), all built by one 4,600-line factory, `createGraphicsAssetLibrary` (`index.ts:1259–5878`). The factory takes one catalogue port, `GraphicsAssetCatalogue`, which has 42 methods plus `checkHealth` (`index.ts:362–657`), and a staging and a canonical byte store (`index.ts:1112–1131`). The port has two adapters: D1 (`catalogue.ts:486`) and in-memory (`in-memory-catalogue.ts:51`). The D1 adapter also spreads three further catalogues, for retention, reconciliation and the cockpit (`catalogue.ts:492–495`).

**The real operation families,** found by tracing which facade methods call which catalogue methods and which invariants change together:

| Family                  | Facade                                       | Catalogue                                                                      | Where it lives                                                                         | Verdict                                                   |
| ----------------------- | -------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Delivery                | 5 reads (`index.ts:5446–5553`)               | `findRevisionContent(s)`, `findThumbnailContent` (`index.ts:607–657`)          | Closures in the factory (`index.ts:1693–1710`, `1802–1882`)                            | **Moved here**                                            |
| Ingestion               | 15 (`index.ts:4210–4249`, `4473–5275`)       | 19, among them publish, reuse, claim, multipart and staged bytes               | `continueGraphicsIngestion` (`index.ts:3707`), helpers (`1891–2631`)                   | Worth doing: #989                                         |
| Template Packages       | 8 (`index.ts:4250–4472`, export `5554–5717`) | 12, plus `findRevisionContent` (`index.ts:3339`, `5580`)                       | `index.ts:2692–3706`                                                                   | Worth doing after the ingestion operation interface: #990 |
| Discovery and lifecycle | 6 (`index.ts:5276–5445`)                     | 6; Retire-blocking SQL (`catalogue.ts:265`)                                    | Facade plus Evidence hooks (`index.ts:1717–1775`)                                      | Worth doing, as a contract across both adapters: #991     |
| Retention               | 6 (`index.ts:5718–5779`, `5801–5818`)        | `GraphicsAssetRetentionCatalogue`, 32 (`retention.ts:160`)                     | `createGraphicsRetention` (`retention.ts:426`)                                         | Already split; no ticket                                  |
| Reconciliation          | 7 (`index.ts:5819–5876`)                     | `GraphicsAssetReconciliationCatalogue`, 30 (`reconciliation.ts:151`)           | `createGraphicsReconciliation` (`reconciliation.ts:356`), media port (`index.ts:1433`) | Already split; no ticket                                  |
| Operational reads       | 4 (`index.ts:4174`, `5780–5800`)             | Cockpit 9 (`operations-cockpit.ts:91`), queues 14 (`operational-queues.ts:64`) | Their own modules                                                                      | Already split; no ticket                                  |
| Health and capacity     | 3                                            | `checkHealth`, `getCapacity`, `updateCapacityLimits`                           | Facade                                                                                 | A split would only pass through; no ticket                |

Ingestion and Template Packages share the Graphics Ingestion Operation lifecycle: `get/updateIngestionOperation`, `claimGraphicsIngestion`, `recordCanonicalWrites` and `getCapacity`. That shared lifecycle is one sub-interface, and #989 proposes landing it first.

**Behaviour contracts across both catalogue adapters:**

- **Delivery's reads match.** Its seam test (`test/unit/server/modules/graphicsAssetDelivery.sqlite.test.ts`) runs against both adapters.
- **Retire, Trash, Restore and usage match in type but not in behaviour.** The in-memory `retireGraphicAsset` holds Retire back for template owners only (`in-memory-catalogue.ts:1250–1255`). D1 also counts Themes, Screen Theme Overrides and Talents. #991 makes that a shared contract.
- **Publication, claim and Template Package installation** exist in both adapters and are contract candidates in #989 and #990.
- **Retention, reconciliation, cockpit and queue catalogues** have only the D1 adapter, so they stay on the SQLite harness.

### Decision

**`GraphicsAssetLibrary` stays the one facade routes and modules build.** Families move behind smaller internal interfaces inside it, not into separate services a caller has to choose between.

**A family moves only when it gains something.** Its invariants must be nameable and testable at its own seam, and something must vary across that seam: both catalogue adapters, or a caller needing only that family. No generic repository or table abstraction is introduced to fold together SQL that merely looks alike.

**Delivery is the first.** `server/modules/graphics-asset-library/delivery.ts` holds it:

- **Interface:** `GraphicsAssetDelivery` has the five reads, unchanged: `inspectGraphicAssetRevision(s)`, `inspectGraphicAssetRevisionContent`, `resolveGraphicAssetRevision` and `resolveGraphicAssetThumbnail`.
- **Catalogue:** `GraphicsAssetDeliveryCatalogue` has the three catalogue reads.
- **Built from:** `createGraphicsAssetDelivery({ catalogue, canonical, reportDisagreement? })`.

It owns three rules:

- Bytes are served only while the canonical store agrees with the catalogue, by reconciliation's own definition of agreement.
- A revision the catalogue lacks is `missing`, and bytes the store cannot produce are retryably `unavailable`.
- A contradiction the store answered with is reported, and the report never changes or fails the read.

How the existing types fit around it:

- `GraphicsAssetCatalogue` extends the delivery catalogue, and `GraphicsAssetLibrary` extends `GraphicsAssetDelivery`.
- Every reader wires `reportDisagreement` to `createGraphicsDisagreementReporter` (`reconciliation.ts`). It is built from the catalogue's observation reads and writes and the canonical store alone, never staging or media. The scheduled reconciliation pass compares an expectation through the same code, so a reader and the pass open the same Graphics Discrepancy and announce it once (#992).
- `catalogueRequest` moved to `catalogue-request.ts`, unchanged, so every family shares one way of failing as unavailable.

**Template Package export keeps the shared agreement rule.** It reads through delivery's `readCanonicalContent` and `observeCanonicalContent` until #990 moves it.

### Why

**Before,** a reader learned the 53-method facade and built it from the 43-method catalogue port plus a staging store. The Screen Output Asset Capability, which only ever reads bytes, built the whole library over a stub staging store to reach two methods (`screen-output-assets/runtime.ts:60–97`). Delivery's rules were spread across closures in the factory, and were tested only through the full library.

**After,** a reader learns five methods and builds them from three catalogue reads and the canonical store. The rules sit in one module, which is tested at its own interface against both catalogue adapters. The deletion test agrees: delete `delivery.ts` and the agreement, missing-versus-unavailable and reporting rules reappear in the facade and in every reader that wants delivery alone.

### Consequences

- **Routes and write modules:** nothing changes. Their `Pick<GraphicsAssetLibrary, 'inspectGraphicAssetRevisions'>` (`screen-write/index.ts:104`, `talent-write/index.ts:10`, `theme-library/index.ts:99`, `server/utils/graphicsTemplateReferences.ts:66`) still compiles. A new caller can depend on `GraphicsAssetDelivery` directly.
- **The Screen Output Asset Capability** now builds delivery with no stub staging store, through `createScreenOutputGraphicsDelivery` (`screen-output-assets/graphics-delivery.ts`).
- **On-air reads now feed reconciliation (#992).** Before, reaching reconciliation needed the staging store the stub lacked, and that failure was swallowed. So CONTEXT.md's rule that every reader observing a contradiction feeds Graphics Reconciliation did not hold for Screen Outputs. Now a Screen Output reports through the reporter, so content whose canonical object is missing opens its Graphics Discrepancy on the first read, not at the next scheduled pass. A store that could not answer still reports nothing.
- **An on-air report never holds the read.** The Screen Output hands each report to the Worker's `waitUntil`, the same deferral its edge-cache write uses. The read answers first, and a failed report is dropped, because the scheduled pass re-observes it. Without an execution context (local Node), the read awaits its report. Operator-facing reads through the facade still await theirs. Concurrent reports of one content still open one discrepancy, because opening is idempotent on the open subject. Only the announcement is once: each read of missing content still costs a deferred metadata read and a few idempotent D1 writes, as operator reads always have.
- **A catalogue double needs only the three reads** to back delivery.
- **The estimated cost** of each split:
  - Delivery: small, done (5 facade methods, 3 catalogue reads, 1 caller rewired).
  - Ingestion: large (#989).
  - Template Packages: medium to large (#990).
  - Discovery and lifecycle: medium (#991).

### Rejected alternatives

- **One application-facing service per family.** Every route would have to learn which one to build. #623 asked for a stable facade.
- **A generic repository or table-name SQL abstraction.** #623 rules it out: SQL that looks alike does not share invariants.
- **Splitting the retention, reconciliation, cockpit or queue catalogues further.** Each already has its own module and port. Another layer would only delegate.
- **Its own interface for health and capacity.** Three pass-through methods; the deletion test removes it.
- **Give delivery reconciliation itself rather than a reporter.** Building reconciliation needs the staging store, which would put staging back into every delivery. A reporter keeps delivery buildable from the catalogue and the canonical store alone.
- **Let the reconciliation factory take staging lazily, so a Screen Output could build all of it (#992).** The output would still need the media port, built from the facade's validators, and every repair action would type-check against a staging store that might not be there. The reporter needs neither.
- **Move export onto delivery now.** Export belongs to the Template Package family (#990).

## ADR-0074: A One Piece Card Game Event's Players and their Deck Lists come from a TCG+ Import, and its cards from one catalogue keyed by card number

Accepted · 2026-11-04 · [#1000](https://github.com/KeeprDigital/stream-keepr/issues/1000) · Changes ADR-0057. · Amended 2026-11-05 by ADR-0075, which offers OP Events Top Cut Bracket.

### Decision

**An OP Event has Players, and each Player holds one Deck List.**

- **TCG+ Import.** The operator uploads the Bandai TCG+ deck list export on the OP Sync page, previews what it will change, and confirms. Nothing is saved before the confirm, and there is no undo.
- **Re-import.** It upserts Players by their Bandai member number. A Player missing from the file is marked inactive, never deleted, as Melee Sync does, and one back in it is active again. A Player's Deck List is replaced only when its cards changed, or when it holds an Unresolved Deck Card the catalogue now knows.
- **What the import ignores.** The export's status column is ignored. Rows sharing a card number, which are printings the export cannot tell apart, are summed into one entry.
- **Players added by hand.** They are kept as on MTG, and the import never matches them. When one's name or Nickname matches an incoming Nickname, the preview warns about a possible duplicate.

**A Player's Nickname is the import's, and their name is the operator's.** The import owns the Nickname and refreshes it on every import. The name is optional. Where it shows, ADR-0077 decides: the name fills the fields that show a name, and operator screens tell Players apart by Nickname.

**An OP Player's Deck List is imported or entered by hand, and a hand edit survives re-import.**

- **Where it's edited:** on the Players page, or from a Feature Match Slot side the Player is linked to, as a Player write (as ADR-0045 treats a seated Player's identity).
- **One write.** Every OP Deck List write, a Player's or an unlinked Slot side's, goes through the OP Deck List write (`server/modules/op-deck-list-write`), and each one gives the Deck List a new id, so whatever holds it by reference sees the change. A Player's game data holds only that reference and its Leader's card number; their Archetype and game data are the write's, and a Player write leaves them.
- **How it's edited:** the paste format and paste rules are ADR-0057's.
- **Re-import:** the preview flags a hand-edited Deck List the import differs from, and the operator may drop the edit to take the import's. The import still retries a hand-edited Deck List's Unresolved Deck Cards in its one lookup, and names any now known by rewriting the hand edit as a resolution, which keeps it hand-edited. The preview lists every Deck List the import rewrites.
- **Deck rule breaches** warn and never refuse.

**OP cards live in the shared card catalogue, keyed by card number; MTG cards stay keyed by name.**

- Player Deck Lists, pasted Feature Match Deck Lists and picked Leaders all reference the catalogue, replacing the inline snapshots ADR-0057 first kept. A migration builds catalogue rows from the snapshots already stored.
- Card data comes only from bandai-keepr's bulk lookup. The export's own card fields are not used.
- A card number the catalogue already holds is never looked up again.
- If the lookup fails, the import or paste fails whole and saves nothing.
- A card number bandai-keepr does not know stays out of the catalogue. It is held number-only as an **Unresolved Deck Card**, with a warning, and retried on the next import or paste. The Cards page lists them Event-wide, with the Player and Slot side Deck Lists holding each.
- **Retry and resolve.** The operator can retry one through the bulk lookup, or resolve it to a card picked from a bandai-keepr search (through the server proxy, as the browser never calls bandai-keepr). Either names the card for every Deck List in the Event holding that number, as ADR-0031 does for MTG, by rewriting each through the OP Deck List write. A rewrite keeps whether the Deck List was hand-edited, and copies of a picked card the Deck List already holds are added into its entry.
- **A resolution re-projects.** Contradicts ADR-0031, whose resolution re-projects nothing and announces only `playerDeck:cardsResolved`, because on OP the Leader is the Archetype projection, and every reader holds a Deck List by id. So each rewritten Deck List gets a new id and the write's own announcements (`player:updated` and Reverse Sync for a Player, the Slot's for a side), and a resolved Leader re-derives the Player's Archetype.

**An OP Player's Archetype is their Leader card.**

- **Created automatically.** One Archetype per distinct Leader card number, named after the Leader (with the card number when two Leaders share a name) and coloured by it.
- **Derived, not assigned.** A Player's Archetype follows their Leader. It is never reviewed or reassigned, though an operator may rename an Archetype or pin its chart series, which marks it customised for good. The server refuses Archetype Review and creating or deleting an Archetype by hand on OP.
- **Name clashes.** When a new Leader shares a name with an Archetype already in the Event, it and every clashing Archetype not customised take their card number, and keep it once the clash is gone, so names stay stable.
- **Removed when empty.** An auto-created Archetype left without Players, by a Deck List write or by deleting its last Player, is deleted, and the Screens naming it released, unless an operator renamed it or pinned a series. It is created again if a Player takes that Leader later.
- **Unknown Leader.** A Player whose Leader is unresolved is unclassified.

**OP Metagame counts every Player's Deck List, and reads participation only.**

- Its scopes are every Player and a Player List.
- With no standings, it shows no Conversion Target, Conversion Rate, win rate or average position.
- Its card rules are OP's: Character, Event and Stage, with no basic lands, highlander or Scryfall data.
- The read model holds these rules, read off the Event's Card Game (`getMetagameRules`), so a stored or requested scope it does not offer reads every Player, and a requested Conversion Target, win rate or place reads as none. The page and Screen editors offer only what it reads, and a Screen rendering hides any column it does not.

**A Feature Match Slot side takes a Player as on MTG, or manual data.**

- **Linked side.** Its Leader and Deck List are the Player's, by reference. A re-import or edit reaches the Slot, and the active Feature Match Session's snapshot is corrected, as replacing a paste is today. The side's game data is the server's: a setup save takes it from the Player whatever the form sent, and releases a Feature Match Deck List the side held. Its setup form edits the Player's Deck List, and a paste to the side itself is refused (`409`).
- **Unlinked side.** Paste and Leader picking stay available. That Feature Match Deck List never counts in Metagame.
- **Deck List Screen.** On an OP Event it takes a Player or a Slot side as its Deck Source, and both render in the OP layout. A Player source follows every write to the Player's Deck List: a hand edit or resolution gives the Deck List a new id and rolls the Player's `updatedAt`, which its `player:updated` carries, and the Screen reads again on every `tcgplus:imported`. A linked Slot side shows its Player's Deck List the same way, and a Screen showing that side may read the Players its Slot seats. A Player holding no Deck List shows nothing. A Screen with neither chosen still starts on the first Slot's left side; a Player chosen stays. Deleting the Player releases the Deck Source (ADR-0032).

**What OP Events now offer.** The Players, Metagame, Sync and Cards pages, and the Metagame, Most Played Cards, Archetype Spotlight and Top Cut Bracket Screen Modes, the last showing a Manual Bracket (ADR-0075). Standings, Pairings, Player History, Head-to-Head, Round Clock, Matches, Event Structure, Archetype Review and Integrations stay MTG-only.

### Why

ADR-0057 rested on TCG+ having no export. Its deck list export holds every Player's Leader and full 50-card Mainboard (512 of 512 in the Sydney Regionals sample), so a Feature Match can be picked from real Players with their decks attached, and the Metagame has every Deck List to count.

Keying OP cards by card number in the shared catalogue was rejected while nothing aggregated across OP Deck Lists. Metagame now does. One catalogue lets OP reuse the Player Deck List, Archetype and Metagame read model rather than maintain a parallel one. Card data is effectively static, so a card is fetched once and never refreshed. A single source keeps the catalogue from carrying two answers for one card.

The Nickname is the player's handle in Bandai's app, not the name the broadcast wants. Keeping it apart from the operator's name lets a re-import refresh one without touching the other. A cleared name falls back to the Nickname rather than showing blank, which an ADR-0046 Manually Edited Field would.

The Metagame is all or nothing: either the whole field was imported or no Metagame is worth showing. So every Player's Deck List counts, whether imported or entered by hand.

### Consequences

- **One lookup.** Imports, pastes and picked Leaders all resolve through bandai-keepr's bulk lookup (`POST /cards/collection`), at most 1,000 numbers a request.
- **Picking a featured match.** An OP Feature Match is picked from Players instead of typed. A Player featured in two Rounds no longer needs re-entering, as an unlinked side's competitor still does (ADR-0057).
- **No printing.** The export does not say which printing a Player registered, so every entry shows its card's standard printing.
- **Catalogue corrections.** A card bandai-keepr corrects stays as first fetched until the catalogue row is cleared. Nothing refreshes it.
- **No standings.** OP standings, records and Conversion Rate wait for a source. The export has none.
- **Duplicates.** A hand-added Player who later appears in an import is duplicated until the operator deletes one.
- **How the import lands.** `server/modules/tcgplus-import` reads the export by its Japanese headers, never by position, and refuses a file missing one (`422 TCGPLUS_EXPORT_INVALID`). Preview and import each send the whole export, so the browser holds it between them; its routes take a body up to 4 MiB rather than the usual 1 MiB. The import resolves every card number in one lookup before writing, then writes the Players in one batch and the changed Deck Lists in a second (`opDeckListWriteModule().writeMany`). A failure between the two leaves the Players without their new Deck Lists, and a re-import finishes them. It announces one `tcgplus:imported` count rather than a `player:updated` per Player, as Melee Sync does.
- **The import's Deck List is kept.** Each import stores the Deck List it brought every Player (`tcgplus_imported_deck_lists`), so "Use imported Deck List" takes it at once rather than waiting for the next import.
- **Resolutions are not remembered.** Unlike Melee Sync's name overrides, nothing maps a resolved number for the next import, so a re-import still holding the misentered number brings it back, unless the Deck List was hand-edited.
- **One write per Deck List.** A retry or resolution writes each Deck List holding the number on its own. A lookup failing partway leaves the earlier ones rewritten; retrying finishes the rest.
- **No Archetype deleted by hand.** OP refuses it: an Archetype goes only when it is left without Players and not customised.

### Rejected alternatives

- **Separate OP deck tables with inline snapshots and their own Metagame read model.** Every Metagame, Archetype and Deck List Screen rule would be duplicated for OP.
- **Taking card fields from the export when bandai-keepr is missing a card.** Two sources would give one card two answers. The export has no cost, power or image anyway.
- **Refreshing every card on every import.** Card data barely changes, and the bulk lookup would grow with the field instead of with new cards.
- **The Nickname as the Player's name, with an operator's name kept as a Manually Edited Field.** A cleared name would show blank instead of the Nickname.
- **A pasted deck on a linked side as a Slot-only override.** The Metagame would count a different deck from the one on air.
- **Interpreting the export's status column.** Its meaning is unknown, and every row is a registered Player.

## ADR-0075: A Top Cut Bracket may be a Manual Bracket its Screen holds, and One Piece Card Game Events show one

Accepted · 2026-11-05 · Changes ADR-0057 and ADR-0074 · Compatible with ADR-0047

A One Piece Card Game Event's top cut runs in Bandai TCG+, which exports no pairings or results (ADR-0057, ADR-0074), so Stream Keepr holds no Phase to derive its Top Cut Bracket from. Operators still want the graphic on air, filled in as the cut is announced and played. A Magic Event not run on Melee.gg has the same gap.

### Decision

**A Top Cut Bracket Screen reads its bracket from a Phase or from its Manual Bracket.** `bracketSource` (`phase` or `manual`) chooses. The choice not taken is kept, so switching back restores it. A One Piece Card Game Event holds no Phases, so its bracket is always its Manual Bracket, whatever `bracketSource` says (`topCutBracketSource`). The server read and the output's freshness both decide the source by that one rule. Top Cut Bracket is offered to both Card Games (`SCREEN_MODE_CARD_GAMES`).

**A Manual Bracket is Screen config.** `manualBracket` holds three things:

- its size (4, 8, 16 or 32);
- its entrants by Seed, Seed 1 first, each a Player of the Event (`{ playerId }`) or a typed name (`{ name }`), `null` for a Seed not entered;
- the results marked in each column by position, each naming the side that advanced (`winner`) and, optionally, a game score (`gameWins`).

The schema refuses more Seeds than the size, or more columns or positions than the size holds. Every edit writes the whole Manual Bracket through the Screen write, so it reaches the output as every Screen config edit does, live. A display reset keeps it, with `bracketSource` and `phaseId`.

**The bracket is derived from it purely** (`deriveManualTopCutBracket`, `shared/modules/top-cut-bracket/manual.ts`):

- The first column pairs the Seeds in standard order (1v8, 4v5, 2v7, 3v6 for 8), the same order a Phase's Seeds are placed in.
- An empty Seed is a bye for the entrant it meets. A position no entrant can ever reach passes a bye on to whoever meets it in the next column.
- A result counts only at a position seating both its entrants. Each later column seats the entrants advancing into it, and the Final's winner is champion.
- Columns are named by size (Quarterfinals, Semifinals, Final). The output renders it with the same Display as a Phase's bracket.

**A mark is held by its position and side, not by who sat there.** Correcting an entrant keeps every result, so the corrected entrant takes the place and the wins. Resizing keeps each entrant's Seed (dropping those past the new size) and clears every result, since every column moves to another position.

**A Seed naming a Player is an Event Reference.** The `manualBracket` kind requires each named Player to belong to the Screen's Event (ADR-0038). Deleting a Player, alone or through a Melee data reset, empties each Seed naming them in the same batch (`buildReleaseManualBracketPlayersQuery`), keeping every other Seed and every result, and announces the Screen without an origin, as ADR-0032 does for a Deck Source. A Screen left naming a deleted Player could otherwise never be written again.

**An entrant shows as Top Cut Bracket shows any entrant.** A Player shows by their current name, or their Nickname (ADR-0074), and their Archetype or Deck List's deck name while Archetypes show. A typed name shows as typed, with no deck. A Seed is shown as the entrant's place in the operator's list, while Seeds show.

### Why

The bracket is a broadcast graphic, and the operator knows the cut before Stream Keepr could. TCG+ shows the top cut's Seeds in order, so listing them in that order reproduces the bracket with the fewest clicks. Marking who advanced is the only input each match needs, and a score is optional because most One Piece top-cut matches are best of one.

ADR-0047 removed operator-entered Match Results because they reached Player history, Pairings, Head-to-Head and Top Cut Bracket while Melee's standings never counted them, so the two disagreed. A Manual Bracket's results are not Match Results. They are held on the one Screen that shows them, and no record, history, standings, Head-to-Head or Metagame reads them, so there is nothing for them to disagree with.

### Consequences

- Two Screens showing one top cut each hold their own Manual Bracket, and the operator fills in both.
- A Manual Bracket on a Magic Event never follows Melee. Switching the Screen to its Phase does.
- A re-seeded or corrected entrant keeps the results at their Seed's positions. The operator clears a result by picking its winner again.
- Nothing announces a Manual Bracket edit beyond the Screen write's own `screen:updated`. The output re-reads because the read's source key holds the Manual Bracket, and re-reads on `player:updated`, `player:deleted` and `tcgplus:imported` for the Players it seats.
- `test/unit/shared/manualTopCutBracket.test.ts` pins the derivation and the edits, `test/unit/shared/manualBracketSchema.test.ts` the schema's bounds, and `test/unit/server/services/manualTopCutBracket.sqlite.test.ts` the read, the source rule and the release on delete.

### Rejected alternatives

- **Manual Rounds and Matches for One Piece Card Game Events, with operator-entered results.** It reopens ADR-0047 and ADR-0057 for a whole structure nobody keeps up during a stream, to feed one graphic.
- **A Manual Bracket held by the Event, shared by its Screens.** It needs a table, a write module and its own announcements for something only a Screen shows. Revisit if operators run two Screens of one cut.
- **Results held by entrant, so a correction moves them.** A typo fix would lose the result, and a swapped Seed would carry wins to a position the entrant never played.

## ADR-0076: A clock that counts up after running out may hold at an operator-set limit, and a Round Clock may count up too

Accepted · 2026-11-06 · Amends ADR-0066

Productions want to show how far past time a Match or Round has run, but only for a set stretch (the end-of-round window, say), after which a clock still climbing on air is noise. A Feature Match Session clock could already count up after its countdown, with no limit; a Round Clock held `0:00`.

### Decision

**Both clocks share one rule: counting up after running out is opt-in, and may hold at a limit in whole minutes (1 to 600), or count up without one.** `countUpOvertimeMs` (`shared/utils/clock.ts`) is the rule, with the bounds `COUNT_UP_LIMIT_MINUTES_MIN` and `COUNT_UP_LIMIT_MINUTES_MAX`. Both clocks stay clock projections: a held clock is a display, and nothing writes when it reaches its limit.

**A Feature Match Session clock takes its limit from its Event.** `events.feature_match_default_count_up_limit` (minutes, `null` for no limit, migration `0007_count_up_limit`) sits beside the count-up toggle in the Event's Format Settings. As with the toggle, a Session's clock takes it when its state is created (`countUpLimitMs` on `ClockState`), so an edit applies to the next Match or a Match reset, not to a running one. A Match reset rebuilds the state from the Session's source snapshot, so an Event write naming any Feature Match default besides best of corrects every active Session's snapshot to the Event's defaults (`applyEventDefaults`, a `SnapshotCorrected` that leaves the state alone), and the Slots are announced. A state persisted before the limit existed carries none and counts up without limit. `formatClockDisplay` applies it, so the operator clock, both Feature Match Screen Modes and the public Feature Match read all hold at the same value.

**A Round Clock counts up when its Screen says so.** `countUpAfterEnd` (off by default) and `countUpLimitMinutes` (unset for no limit) are Round Clock Screen config, set in the Clock card. `projectRoundClock` takes them, and after the end shows the time since the end, re-evaluating each second until it holds. The state stays `ended`, so its colour is the clock's colour after the end.

### Why

The limit is how long the production wants the overrun on air, which is a broadcast choice. A Round's timing is the floor's fact (ADR-0066), so the Round Clock's count-up belongs to the Screen that shows it, not to the Round. The Feature Match clock already took its count-up from the Event's defaults, and its limit follows it there.

### Consequences

- Two Round Clock Screens of one Round may differ: one holding `0:00`, one counting up.
- Changing an Event's limit leaves running Sessions on the limit they started with until a Match reset.
- Tests: `test/unit/shared/clock.test.ts` and `test/unit/shared/roundClock.test.ts` hold the rule on each clock; `test/unit/shared/featureMatchSessionReducer.test.ts` the limit a Match takes from its Event; `test/unit/server/services/featureMatchState.sqlite.test.ts` a new Session taking every stored default; `test/unit/server/services/featureMatch.sqlite.test.ts` a running clock keeping its limit while a Match reset takes the Event's; `test/unit/server/modules/eventWrite.test.ts` which Event writes correct the Sessions; `test/unit/server/schemas/event.test.ts` the Event column's bounds; `test/nuxt/components/Event/ConfigCards.test.ts` and `test/nuxt/components/Screen/Modes/RoundClock/Settings.test.ts` each setting; `test/nuxt/composables/screen/useRoundClockModeData.test.ts` the Screen setting reaching the projection.

### Rejected alternatives

- **The Round's own count-up setting, beside its start and duration.** It needs a migration and a Round write for what only a Screen shows, and would force every Screen of the Round to agree.
- **A per-Session limit an operator edits mid-Match.** The toggle has no such control today; an Event default covers the ask without a new Session command.
- **Hiding the clock at the limit.** Holding keeps the final overrun on air; a production that wants it gone switches the Screen.

## ADR-0077: A One Piece Card Game Player's name fills the fields that show a name, and never hides their Nickname

Accepted · 2026-11-08 · Changes ADR-0074.

### Decision

**A Player's name and Nickname each keep their place.**

- **Fields that show a name** take the operator's name, with the Nickname filling in while there is none: a Feature Match side's Name (picking a Player fills it), the Feature Match and graphic `Name` values, the Deck List Screen, Metagame and the Cards page's Slot sides (`playerDisplayName`).
- **Operator screens** tell a Player apart by Nickname, else name: the Players page, every Player picker and modal, the Cards page, and the TCG+ Import preview (`playerLabel`). The Players list shows the name and the Nickname each in its own column, the name blank until an operator gives one.
- **The Top Cut Bracket** shows a Player by name or by Nickname, as its Screen's `Show Players by` setting picks, the other standing in when the chosen one is blank. It is offered on One Piece Card Game Events. A Screen saved before it shows the name.

### Why

ADR-0074 let a given name stand in for the Nickname everywhere, so naming a Player hid the handle the operator knows them by and searches TCG+ with. An operator gives a name for the broadcast, so the name belongs in the fields that go on air. Not every Player is given a real name, so the bracket offers the Nickname for a field where most have none.

### Consequences

- One rule, `playerShownName(player, 'name' | 'nickname')`, decides both orders, so a Player missing one name always shows the other.
- A Magic: The Gathering Player has no Nickname, so every surface shows their name as before.

### Rejected alternatives

- **Showing both, as `Name (Nickname)`, everywhere.** A broadcast wants one name, and the Players list already gives each its column.
