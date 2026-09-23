# Decisions

One section per settled architectural decision, numbered in the order taken; read the sections that touch an area before working in it, and surface a contradiction rather than silently overriding one. A new decision goes at the end under the next unused number — take it from `origin/main` at merge time, because parallel branches otherwise pick the same one. When a decision changes, edit its section to state what is now true and say in a line what changed; git history keeps the old text, so there are no separate superseded records. Numbers 0003, 0008 and 0013 were superseded and folded into ADR-0010 (0003, 0008) and ADR-0017 (0013); they are not reused.

## ADR-0001: Graphic Style Sets reference application fonts only

Accepted · 2026-08-01 · [#143](https://github.com/KeeprDigital/stream-keepr/issues/143)

### Decision

A Graphic Style Set's typography presets reference **application fonts only**. The entry's font is typed `GraphicApplicationFontSelection` and its wire schema accepts only the `application` arm. A Graphic Item's own typography is unrestricted and takes either arm of `GraphicFontSelection`. The `.skstyle` exporter's `undeclared-graphic-asset-dependency` refusal stays, as enforcement against a document that reached the exporter by some route other than the write path.

### Why

A `.skstyle` package is deliberately data-only: no staging, no quota reservation, no asset revalidation, and preflight is a pure read of the received bytes (`server/modules/graphic-style-set-package/preflight.ts`). Embedding font bytes would take all of that back — a packaged Graphic Asset Revision must be staged durably, charged against the Graphics Staging Allowance, revalidated under the receiver's Graphic Asset Compatibility Profile and given an origin, and a font additionally needs browser-load evidence. That is the Template Package asset pipeline in full, and a second copy inside the Style Set module would break the library's one export contract.

What it would buy is small: the font asset a template needs already travels with that template in its Template Package. And a Style Set naming a library font would be publishable on the installation that authored it and unpublishable wherever it travelled, breaking the rule that it references only assets in the same reusable-library scope.

### Consequences

- A `.skstyle` package carries zero packaged assets and one `application-font` capability declaration per distinct font; a receiver missing one refuses with `unsupported-application-capability` rather than installing a Style Set it could never publish.
- An author who wants a library font selects it on the item. Binding that item's typography slot to a Style Set entry replaces the item's font with the entry's application font, as binding replaces every other property the entry owns.
- `undeclared-graphic-asset-dependency` is belt and braces: the wire schema already refuses an asset-arm font on the way in.
- Reversing this means building `.skstyle` asset embedding (a slice comparable to #76); the type then widens to `GraphicFontSelection`. Nothing here forecloses it.

### Rejected alternatives

- **Let a Style Set font reference a font Graphic Asset Revision and embed its bytes in `.skstyle`** — see _Why_.

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

The Key Output survives: its rule is that every painted element is pure white at its own alpha with no blend modes or filters. Composition uses no property beyond the `opacity`, `transform` and `mask-image` animation already used — nested opacity multiplies alpha, nested masks multiply alpha, a transform moves paint without changing it — so nothing new paints. The guard in `graphicsRenderModel.test.ts` walks the new elements.

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

Pinned in `test/unit/server/mappers/broadcastGraphicsCommandApplied.test.ts` against worst cases driven through the real reducer:

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

Accepted · 2026-08-05, amended under #229 and #240 · [#199](https://github.com/KeeprDigital/stream-keepr/issues/199) (decided under #167)

### Decision

Before #162, answering **Keep mine** in review recorded the whole property group — all eight typography keys — as the override; #162 narrowed it to the author's prior pins plus the keys the update was about to move. Documents written earlier carry eight-key pins, and **nothing reconciles them**: no migration, heuristic narrowing or one-off pass. An over-broad pin is preserved like any recorded override.

The rule for every recorded key: it leaves the record only when the author sets that property to exactly what the entry resolves to; any other edit re-pins it at the new value. **Unbind and rebind** the slot (`unbindGraphicStyleRef` then `bindGraphicStyleRef`, next to the slot's picker) is the reset that drops a whole pin. Apply (`heldGraphicStyleOverrides` in `shared/modules/graphic-style-sets/apply.ts`) and recapture (`recaptureGraphicStyleOverrides`, via `authoredGraphicStyleOverrides`) read the recorded set the same way: a recorded key the stored value still honours survives, whether or not the entry has caught up with it.

### Why

- **Storage cannot tell an over-broad pin from a deliberate one.** Both are the same eight keys. The only candidate signal — "this override agrees with what the entry resolves to" — is wrong: a pin the republished preset happens to land on is still the author's, and dropping it lets the next republish take the property. Losing a real override is worse than keeping one the author did not mean to make.
- The same wrong reading used to run on the live path: recapture re-derived overrides from where the composition deviates and discarded the recorded set, so a deliberate pin vanished once the Style Set's value coincided with it — triggered by an edit to _any_ owner in the composition. #229 removed that discard; this is why recapture and apply now share one rule.
- A fully pinned slot resolves to what the owner already holds, so it never produces a review row and no later Keep mine can narrow it.
- No such document reaches production: spec #60 wipes the database before ship and puts data migration out of scope.

### Consequences

- A pre-#162 document keeps its over-broad pin, and editing a pinned property re-pins it rather than releasing it. The author cannot read the target value off the screen, since a pinned slot shows no review row. The answer to "this property inherits nothing" is **rebind the slot**.
- **A value typed onto the preset's own value records nothing (#240).** Capture is a diff against the entry, so the document stays byte-identical and a later publish moving that entry takes the property under the review row's default answer. Accepted: nothing recorded is lost, and the failure is visible — an unpinned property gets a review row (`30 → 99`) where Keep mine records the pin the typing did not. Both halves are pinned in `test/unit/shared/graphicStyleSetBindings.test.ts` under _when the author types the value the preset already resolves to_.
- `heldGraphicStyleOverrides` and `recaptureGraphicStyleOverrides` stay pure functions of what is recorded and what is stored. Nothing may give them provenance (when an override was written) — that is the rejected heuristic under another name.
- Recapture's guard is per slot and turns on whether the stored value is in step with the published entries, not on revision number (#198), so a template stranded on an older revision it is in step with records deviations too.

### Rejected alternatives

- **Migrate on the "agrees with the entry" signal** — cannot tell deliberate from accidental, and fails destructively.
- **Ask the author** — a prompt about eight keys on a template they have not opened has no context. The slot, with its bind and unbind, is where that question belongs.
- **Record a pin whenever the author edits an owned key (#240).** Four counts. It deletes the release rule: typing the entry's value cannot mean both "mine" and "give it back", leaving only the whole-slot rebind. It fails quietly (a pinned slot shows no review row) where the current failure is shown and answerable. The signal is "a value arrived", which fires on net-zero gestures like a stepper nudged and nudged back, and may not fire at all when the typed value equals the displayed one. And it makes provenance a per-control obligation whose failures are silent in both directions. The workable fix is an explicit "pin this property" gesture at the slot, filed as [#244](https://github.com/KeeprDigital/stream-keepr/issues/244); a design that uses the touched key to scope such a gesture is not decided here.
- **Version the override record** — a permanent stored-schema field for a population that is empty by construction.

## ADR-0007: The Broadcast Graphics Graphic Item cap is set from what a show needs, and the worst case is allowed not to fit

Accepted · 2026-08-01 · [#99](https://github.com/KeeprDigital/stream-keepr/issues/99)

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

The worst case populates every construct `broadcastGraphicsModeConfigSchema` admits at its own maximum — all seven Graphic Item types including groups, maximal-length ids, Style Set references in every slot, animation and staggers on items, groups and shells, every Graphic Input, binding, Graphic Source Selection and Graphic Channel slot. One named exception: a Style Set link's `revision` is `int().nonnegative()` with no upper bound, so the fixture uses six digits. The claim is qualified deliberately; four earlier corrections each came from an unqualified one. It costs **11,437 bytes per Graphic Item on 282,564 bytes of fixed shell cost**, reaching 3,713,744 bytes at 300.

- **Lowering the cap until it fits** gives 21 (521,272 bytes; 22 is 532,755). That clears the 19-item acceptance set, but the objection is volume: it would leave most of a Screen's 50 Broadcast Graphics unable to carry a single item, while the spec asks for commentator and player lower thirds, slates and brand bugs concurrently.
- **Narrowing further cannot close it.** At 300 the budget left after fixed cost is 241,724 bytes, 806 per item, and `MAX_GRAPHIC_TEXT_LENGTH` is 1,000 — a maximal text template alone overshoots before anything else is counted. Removing the largest remaining axis (a Style Set reference in every slot, ~6,100 bytes per item) is not enough. Only cutting vocabulary the spec settles would be.
- **The overshoot is safe** because the byte total is enforced on the editors' write path (#85), refusing an oversized configuration legibly at authoring time, and because realtime no longer publishes mode configurations (#95), so anything storable is notifiable. The live-session message is keyed by graphic and input, never by item, so this cap does not touch it (ADR-0004).

What is given up is "the named cap binds first", only for configurations nobody authors: they read a byte count instead of a limit name. One non-pathological shape crosses the line — a Screen at the cap where every item carries a 1,000-character template (300,000 characters) is refused by byte count.

### Consequences

- The measurement is pinned with `toBe` in `broadcastGraphicsModeConfig.test.ts` in two arrangements — grouped (3,713,744, `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES`) and flat (3,711,076) — so "which worst case" stays a checked choice.
- A ticket that adds vocabulary extends that builder and moves a visible constant. Moving the cap means re-deriving it here, not in a docblock.
- `MAX_GRAPHIC_ITEM_ID_LENGTH` is also an import constraint: a Template Package document is proved against the Screen write-path schema, so ids over 64 characters are refused on install. Accepted — one bound on both paths keeps "a document that installs is one the write path accepts", and copy paths mint fresh uuids anyway.
- `MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN` (60) binds first for any package whose graphics declare Live Control (two inputs each covers 30 of 50 graphics). Move that before this cap, and re-measure when you do.
- Making the worst case fit means cutting `MAX_GRAPHIC_TEXT_LENGTH` or the Style Set override vocabulary — questions about what an author may express, not budget questions. Open for whoever owns Style Sets: should a reference be able to override every property of its group, or only the ones the author changed?

## ADR-0009: The current page of a Page Rotation is a clock projection, not persisted state

Accepted · 2026-08-12 · [#312](https://github.com/KeeprDigital/stream-keepr/issues/312)

### Decision

The current page of a paginated Screen Mode (standings, metagame, player history) is a **pure projection of (Rotation Anchor, page duration, page count, server time)**, computed identically by every rendering — Screen Output, Program monitor, operator settings — from one shared function in `shared/modules/page-rotation/`. Nothing writes as the rotation runs; a rendering re-evaluates exactly at each flip boundary.

- **Only operator surfaces write `rotationAnchor`**, on three occasions: enabling auto-page; an edit that changes the rotation's shape (page duration, page size); and a manual page selection while rotating, written so the chosen page is current for one full duration. It rides the existing config write and `screen:updated` announcement.
- **A missing anchor projects from epoch zero**, still deterministic, so older configs rotate without migration.
- **An unsynced rendering shows the first page statically** — never project on an unknown clock. With auto-page off, the persisted `currentPage` is the manually selected page.

### Why

Every rendering used to run a timer that persisted the next page. A freshly opened output could not persist at all and silently stalled; two renderings of one Screen (a fill/key pair, a redundant machine) each advanced the page, at double rate. Every tick cost a realtime fan-out plus a Screen re-fetch by every client (the pattern ADR-0004 rejects), and outputs writing contradicted the invariant that a Screen Output only enters presence and answers commands, which race-safety arguments in the code rely on. Synchronisation instead falls out of the shared RTT-compensated clock (`useServerTime`), the way outputs already agree on animation phases, and paging continues through a realtime outage.

### Consequences

- Screen Outputs are pure consumers again; the paging persist was the only output-originated server write.
- Flips land within clock-sync tolerance across renderings (tens of milliseconds); frame-atomic flips across independent browsers were never achievable.
- When the row set changes mid-rotation the projected page can jump, identically everywhere. Nothing re-anchors on data changes — determinism, not continuity, is the invariant.
- The metagame toggle is the canonical `autoPageEnabled` (migration 0024 rewrote stored blobs).

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

**Deny-by-default over `/api/**`.** `server/middleware/api-session.ts` requires a session on every `/api/**` route that `apiPathRequiresSession` (`server/utils/apiBoundary.ts`) does not exempt, so a new route is private until consciously allowlisted. The exempt surface, exhaustively: `/api/auth/**`; `/api/time` (output drift correction); `/api/realtime/token` (scoped below); `/api/screen-output/**` (capability-authorised); `/api/bootstrap/ensure-admin`; `/api/admin/**`; and the SPA shell and static assets, unavoidably public under `ssr: false`.

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

A rotating Talent identity is a named **Social Profile Projection**, not an opaque all-in-one Graphic Item or a collection-valued Graphic Input. The projection references a Talent Graphic Source Selection, atomically supplies read-only network and profile values, and transitions one explicitly associated Social Profile Presentation Group, whose ordinary Text, Social Network Icon and decorative Graphic Items keep the compositor's layout, styling, animation and Style Set capabilities.

Rotation is a pure projection of authoritative Broadcast Graphics Live Session state, the accepted populated profile set, and synchronised server time (as ADR-0009). Operator actions write the projection's selection, automatic mode and rotation anchor; Screen Outputs never write as it advances. A rendering without trustworthy synchronised time holds its last accepted or anchored profile rather than blanking or writing. An accepted profile-set change preserves and re-anchors the current network when it still exists, so adding a profile cannot make program jump because catalogue indexes moved. The Feature Match Overlay is out of scope.

### Rejected alternatives

- **An opaque Social Profile Graphic Item** — duplicates a weaker subset of Text Item, Graphic Group and styling controls in a bespoke widget.
- **A collection-valued Graphic Input** — puts collection and clock behaviour into the scalar binding catalogue, which deliberately excludes it, and still yields no independently styled icon and text consumers.
- **Timer-driven accepted-value updates** — a write per profile change, competing outputs or a writer election, and the loss of ADR-0009's output purity.

## ADR-0012: Environment-dependent library behaviour is stated, tested, or recorded

Accepted · 2026-08-20 · [#438](https://github.com/KeeprDigital/stream-keepr/issues/438)

### Decision

Every test runs against libraries told they are under test: Vitest sets `NODE_ENV ??= 'test'`, `@nuxt/test-utils` never forces `production` here, and `@better-auth/core` captures `NODE_ENV` into a module constant at import, so nothing in-process can un-see it. Better Auth's origin check being off under test let a defect only a built Worker refused ship (#410, #397). For each site where the environment decides behaviour, in order of preference:

1. **State the option** when one value is right in every environment, taking the decision away from `NODE_ENV`.
2. **Construct the library under an environment the test controls** when no option exists — given the frozen constant, a child process.
3. **Record the blindness with its reason** when neither is worth its cost.

**The suite's `NODE_ENV` is not globally overridden.** It would change everything at once in a suite that has never run under another setting; stating options is reversible per site.

### The census

A grep of the pinned `better-auth@1.6.29`, `@better-auth/core` and `@better-auth/telemetry` dists for `isTest`, `isDevelopment`, `isProduction` and `NODE_ENV`. It did not audit Nitro, h3, Nuxt, Drizzle, Ably or anything else — a floor, not a ceiling. Stated options live in `server/utils/authOptions.ts`, each with its reason.

| Site                                                 | Under test                                                                  | Decision                                                                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Origin check defaults off                            | CSRF defence disabled                                                       | **Stated**: `advanced.disableOriginCheck: false` (#410)                                                                                                                 |
| `validateSecret` returns early                       | Weak or default secrets admitted silently                                   | **Tested**: `test/unit/server/utils/authSecretValidation.test.ts` constructs the library in a child process with `NODE_ENV=production`                                  |
| `rateLimit.enabled ?? isProduction`                  | Rate limiter off outside production                                         | **Accepted blindness**                                                                                                                                                  |
| Client IP: header walk, then loopback under test/dev | Caller-writable `x-forwarded-for` read; header-less callers all `127.0.0.1` | **Split**: header stated as `advanced.ipAddress.ipAddressHeaders: ['cf-connecting-ip']`, pinned by `test/unit/server/utils/authClientIp.test.ts`; loopback **accepted** |
| Secure-cookie prefix falls back to `isProduction`    | Cookies unprefixed locally, `__Secure-` in production                       | **Accepted blindness**                                                                                                                                                  |
| Telemetry publishes only when `!isTest()`            | Suppressed                                                                  | **Stated**: `telemetry.enabled: false`                                                                                                                                  |
| `/error` page blanked in production                  | Suite sees a dev page                                                       | **Accepted blindness** — response shape only                                                                                                                            |
| Dev-only log lines                                   | Log output differs                                                          | **No action**                                                                                                                                                           |

### Why the blindnesses are accepted

- **Rate limiting**: no value preserves behaviour on both sides — `false` disables production's limiter, `true` enables it locally, where every header-less caller shares one `127.0.0.1` bucket and the suite gains flake, not coverage. What the limiter keys on is stated and tested; observing it refuse is a built-Worker job ([#437](https://github.com/KeeprDigital/stream-keepr/issues/437)).
- **Loopback for header-less callers** is inside the library past every option; nothing keyed on client IP is distinguishable locally. The last case in `authClientIp.test.ts` pins the residual and fails if a bump changes it.
- **Secure-cookie prefix**: the fallback is right on both sides (a `__Secure-` cookie cannot be set over `http`), and no option means "secure exactly when the request is https" — `useSecureCookies` would be wrong on one side, and pinning `protocol` was measured and rejected on #410. The suite never sees the prefixed names; a built-Worker probe does.
- **Blanked error page**: cosmetic; nothing about admission rides on it.

### Consequences

- A Better Auth bump has two tripwires: `authSecretValidation.test.ts` and `authClientIp.test.ts`. Re-run the census (same grep) when an audited package moves majorly; the table is version-pinned, not evergreen.
- Sessions record the Cloudflare-vouched client IP, not whatever `x-forwarded-for` said, and the production limiter's key survives a caller sending their own forwarding header.
- Anyone noticing the untested limiter, the loopback collapse or the unprefixed cookie names should land here before building a workaround.

## ADR-0014: Animation Effects are rebuilt in-house on three.js

Accepted · 2026-08-23 · [#473](https://github.com/KeeprDigital/stream-keepr/issues/473)

### Decision

Animation Effects are built in-house behind a typed, **host-agnostic** contract (`create/setParams/resize/render(t)/dispose`) with per-effect configuration, in `app/utils/animation-effects/`. The nine effects of the vendored, `@ts-nocheck` Vanta.js fork were ported under their existing names and the fork is gone; the vocabulary is `ANIMATION_EFFECT_VALUES` in `shared/animationEffects.ts`. Rendering stays on three.js: five of the original nine are mesh-based (waves, rings, dots, net, globe) and three.js was already a dependency. Shader-only effects use a fullscreen `ShaderMaterial` base; a Canvas2D backend remains possible under the same contract. Effects animate autonomously from elapsed time — the fork's synthetic mouse drift, needed to move on a headless browser source, is retired.

Two hosts use the renderer: the Feature Match Overlay Frame and the Background Screen's animation layer (ADR-0016), so the renderer must not assume either.

### Consequences

- Effect names are a closed vocabulary pinned by the Feature Match Layout format version, so Template Packages and stored configs keep resolving. Per-effect config changed what a `frame.animation` capability payload carries without a format-version bump — no payload half-parses under the wrong shape: a new-shape payload fails an older installation's strict schema; a pre-rebuild bag (recognised by its `mouseDrift*` fields) resets to no animation; and a package declaring an effect this installation does not ship is refused at capability preflight. A bump would also have refused older packages carrying no animation at all; the reasoning sits beside `FEATURE_MATCH_LAYOUT_FORMAT_VERSION`.
- Saved frame-animation settings from before the rebuild reset rather than migrate (small install base).

### Rejected alternatives

- **Extend the Vanta fork** — untyped, mouse-driven motion, and a flat config whose parameter ranges already diverged across three copies (Zod, runtime clamp, editor).
- **A hand-rolled WebGL2 fragment harness** — cannot host the mesh-based effects, forcing a second GL stack beside three.js.
- **An offline WebCodecs → looping-video pipeline** — effects render live in the OBS browser source with no replay, so loop-seamlessness and determinism machinery buys nothing.

## ADR-0015: Live overlay show/hide rides feature-match session state

Accepted · 2026-08-24 · [#486](https://github.com/KeeprDigital/stream-keepr/issues/486) (decided under spec #485 / #479, #480, #481)

### Decision

Revealing or hiding a player's sideboard on the Feature Match Overlay is **live match data**: a per-player `sideboardRevealed` boolean in `FeatureMatchState`, set by a `SetSideboardRevealed` session command, read by the deck-list Graphic Item through `GraphicsFeatureMatchContext` exactly as `player-life` reads life totals.

### Why

An operator needs a sub-second toggle from the control surface between games. Writing the item's `visible` through graphics config is compositor-only UI, ~600 ms of stacked debounce plus announce-then-refetch, and would turn an authoring field into an operator gesture. The live flag preserves the Graphic Item invariant that items are not taken on or off air independently of their composition: the item stays on air and a hidden sideboard renders nothing, like an absent life total or empty sideboard. The Feature Match Overlay's Host Contract declares no Graphic Inputs, so Broadcast Graphics Live Control was not a carrier.

### Consequences

- The authored `visible` field ANDs with the live flag; the flag cannot resurrect an item its author hid.
- Show/hide motion reuses the item's authored `enter`/`exit` Graphic Animation Recipes; the flag edge is a small, reusable per-item phase trigger in the overlay host.
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

- The mode key renamed end to end: `SCREEN_MODE_VALUES`, registries, component directories, the D1 `screens.current_mode` default, and stored rows (migration 0028). OBS URLs address Screens by slug, so nothing external broke.
- The old `mediaBackground` configuration reset rather than mapping onto a video layer (small install base, as ADR-0014). New Background Screens start empty: black until configured.
- **At most one animation layer per Screen**, enforced on the `layers` field in the schema: each is its own WebGL context and an OBS browser source is memory-tight. Liftable.
- Opacity belongs to the layer, never to the stack or the renderer behind it.
- Image and video layers use the standard media source shape — a Graphics Asset Library reference or a remote URL — adopted app-wide by #484. Asset-sourced layers join Graphic Asset Reference indexing under the `layers.` owner-slot namespace.

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

## ADR-0019: `pnpm verify` is a gate graph, and the integration suite runs one server per worker

Accepted · 2026-09-23

### Decision

**`pnpm verify` runs every gate it ran before, as a dependency graph (`scripts/verify.mjs`) rather than a chain.** `nuxt prepare` first; lint, typecheck, the unit and Nuxt suites and the build next; the server-backed suites, browser gates and the Worker tail once the cheap gates pass. The first failure stops the rest. **The integration suite starts one `nuxt dev` per vitest worker**, each over its own Wrangler state, build, NuxtHub and Vite directories, and pins each worker to one server by `VITEST_POOL_ID`, so files run in parallel but never two against one database.

### Why

Measured on a 10-core machine: the chain took about 14½ minutes, and the integration suite alone was 410s of it, serial because its files share library-wide state (capacity, retention, reconciliation). Isolating databases is the only way to parallelise it; four servers ran it in 102s. The graph brings the whole of `verify` to about four minutes, and lint and type errors arrive within the first half-minute.

### Consequences

- **Only `nuxt prepare` may write `.nuxt`.** The root tsconfig extends `.nuxt/tsconfig.json`, so every Vite and TypeScript consumer reads it; a gate that rewrote it mid-run broke the others. The Nuxt suite, each server, and `verify`'s build (`STREAM_KEEPR_BUILD_DIR`) write their own.
- **Servers sharing one Vite dep-optimizer cache break each other's pages** when they start together; `nuxt.config.ts` gives each its own.
- The integration servers are launched by `test/integration/servers.ts`, not `@nuxt/test-utils`' `createTest`: in dev mode `createTest` loaded and built Nuxt in the setup process before `nuxi _dev` did it all again, and its context is a singleton that cannot start two servers.
- "Run integration suites one at a time" still holds across invocations: the suite already uses the machine.
- ESLint and `vue-tsc` caches make an unchanged tree cheap. The per-file ESLint cache can miss a type-aware finding in an unchanged file; CI starts cold and is the backstop.

### Rejected alternatives

- **Test files in parallel against one server** — files assert library-wide state and would interfere.
- **`vitest --shard` across processes** — no load balancing between shards, and concurrent `createTest` boots raced on `.nuxt` and `.data`.
- **`--no-isolate` for the Nuxt suite** — about 4× faster, but 83 files fail on leaked state.
- **ESLint `--concurrency` or `projectService`** — each worker rebuilds the type-aware program (slower), and `projectService` exhausted the heap.

## ADR-0020: Changes land as squash-merged PRs with Conventional Commit titles

Accepted · 2026-09-23

### Decision

**`main` takes changes only as squash merges of PRs, with the PR title as the commit title and a Conventional Commit PR title** (`.github/workflows/pr-title.yml` checks it). The repository allows no merge commits or rebase merges. CI runs on ready-for-review PRs, not on drafts, pushes to `main`, or PRs changing only docs or other workflows.

### Why

release-please builds the changelog and version from the commits on `main`. Branches were landing through merge commits, some twice (merged locally, then again by their PR), so Release PR #400 listed several changes two and three times; commits pushed straight to `main` also skipped CI, which runs only on PRs. One PR, one conventional commit, one changelog line.

### Consequences

- Nothing enforces it server-side: branch protection and rulesets need GitHub Team or a public repository. AGENTS.md and README § Releases carry it as a convention.
- The default workflow token is read-only; each workflow declares its own write scopes.
- A branch's individual commits no longer reach `main`; the PR body is the squash commit's message.
