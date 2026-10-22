# Decisions

One section per settled architectural decision, numbered in the order taken; read the sections that touch an area before working in it, and surface a contradiction rather than silently overriding one. A new decision goes at the end under the next unused number — take it from `origin/main` at merge time, because parallel branches otherwise pick the same one. When a decision changes, edit its section to state what is now true and say in a line what changed; git history keeps the old text, so there are no separate superseded records. Numbers 0003, 0008 and 0013 were superseded and folded into ADR-0010 (0003, 0008) and ADR-0017 (0013); they are not reused.

## ADR-0001: Graphic Style Sets reference application fonts only

Accepted · 2026-08-01 · [#143](https://github.com/KeeprDigital/stream-keepr/issues/143)

### Decision

A Graphic Style Set's typography entries reference **application fonts only**. The entry's font is typed `GraphicApplicationFontSelection` and its wire schema accepts only the `application` arm. A Graphic Item's own typography is unrestricted and takes either arm of `GraphicFontSelection`. The `.skstyle` exporter's `undeclared-graphic-asset-dependency` refusal stays, as enforcement against a document that reached the exporter by some route other than the write path.

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

- **Storage cannot tell an over-broad pin from a deliberate one.** Both are the same eight keys. The only candidate signal — "this override agrees with what the entry resolves to" — is wrong: a pin the republished entry happens to land on is still the author's, and dropping it lets the next republish take the property. Losing a real override is worse than keeping one the author did not mean to make.
- The same wrong reading used to run on the live path: recapture re-derived overrides from where the composition deviates and discarded the recorded set, so a deliberate pin vanished once the Style Set's value coincided with it — triggered by an edit to _any_ owner in the composition. #229 removed that discard; this is why recapture and apply now share one rule.
- A fully pinned slot resolves to what the owner already holds, so it never produces a review row and no later Keep mine can narrow it.
- No such document reaches production: spec #60 wipes the database before ship and puts data migration out of scope.

### Consequences

- A pre-#162 document keeps its over-broad pin, and editing a pinned property re-pins it rather than releasing it. The author cannot read the target value off the screen, since a pinned slot shows no review row. The answer to "this property inherits nothing" is **rebind the slot**.
- **A value typed onto the entry's own value records nothing (#240).** Capture is a diff against the entry, so the document stays byte-identical and a later publish moving that entry takes the property under the review row's default answer. Accepted: nothing recorded is lost, and the failure is visible — an unpinned property gets a review row (`30 → 99`) where Keep mine records the pin the typing did not. Both halves are pinned in `test/unit/shared/graphicStyleSetBindings.test.ts` under _when the author types the value the entry already resolves to_.
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

The worst case populates every construct `broadcastGraphicsModeConfigSchema` admits at its own maximum — all seven Graphic Item types including groups, maximal-length ids, Style Set references in every slot, animation and staggers on items, groups and shells, every Graphic Input, binding, Graphic Source Selection and Graphic Channel slot. One named exception: a Style Set link's `revision` is `int().nonnegative()` with no upper bound, so the fixture uses six digits. The claim is qualified deliberately; four earlier corrections each came from an unqualified one. It costs **11,443 bytes per Graphic Item on 282,564 bytes of fixed shell cost**, reaching 3,715,514 bytes at 300. (#539 widened a Graphic Placeholder Style's font weight to 1–1000 and populated every font weight at 1000, which base typography and its override already admitted: 6 bytes more per maximal Text Graphic Item. The lowering-the-cap figures below predate that and were not re-measured; at 6 bytes an item they move by at most 132, which leaves 21 as the cap that fits.)

- **Lowering the cap until it fits** gives 21 (521,272 bytes; 22 is 532,755). That clears the 19-item acceptance set, but the objection is volume: it would leave most of a Screen's 50 Broadcast Graphics unable to carry a single item, while the spec asks for commentator and player lower thirds, slates and brand bugs concurrently.
- **Narrowing further cannot close it.** At 300 the budget left after fixed cost is 241,724 bytes, 806 per item, and `MAX_GRAPHIC_TEXT_LENGTH` is 1,000 — a maximal text template alone overshoots before anything else is counted. Removing the largest remaining axis (a Style Set reference in every slot, ~6,100 bytes per item) is not enough. Only cutting vocabulary the spec settles would be.
- **The overshoot is safe** because the byte total is enforced on the editors' write path (#85), refusing an oversized configuration legibly at authoring time, and because realtime no longer publishes mode configurations (#95), so anything storable is notifiable. The live-session message is keyed by graphic and input, never by item, so this cap does not touch it (ADR-0004).

What is given up is "the named cap binds first", only for configurations nobody authors: they read a byte count instead of a limit name. One non-pathological shape crosses the line — a Screen at the cap where every item carries a 1,000-character template (300,000 characters) is refused by byte count.

### Consequences

- The measurement is pinned with `toBe` in `broadcastGraphicsModeConfig.test.ts` in two arrangements — grouped (3,715,514, `MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN_WORST_CASE_BYTES`) and flat (3,712,876) — so "which worst case" stays a checked choice.
- A ticket that adds vocabulary extends that builder and moves a visible constant. Moving the cap means re-deriving it here, not in a docblock.
- `MAX_GRAPHIC_ITEM_ID_LENGTH` is also an import constraint: a Template Package document is proved against the Screen write-path schema, so ids over 64 characters are refused on install. Accepted — one bound on both paths keeps "a document that installs is one the write path accepts", and copy paths mint fresh uuids anyway.
- `MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN` (60) binds first for any package whose graphics declare Live Control (two inputs each covers 30 of 50 graphics). Move that before this cap, and re-measure when you do.
- Making the worst case fit means cutting `MAX_GRAPHIC_TEXT_LENGTH` or the Style Set override vocabulary — questions about what an author may express, not budget questions. Open for whoever owns Style Sets: should a reference be able to override every property of its group, or only the ones the author changed?

## ADR-0009: The current page of a Page Rotation is a clock projection, not persisted state

Accepted · 2026-08-12 · [#312](https://github.com/KeeprDigital/stream-keepr/issues/312)

### Decision

The current page of a paginated Screen Mode (standings, metagame, top cards, player history, pairings) is a **pure projection of (Rotation Anchor, page duration, page count, server time)**, computed identically by every rendering — Screen Output, Program monitor, operator settings — from one shared function in `shared/modules/page-rotation/`. Nothing writes as the rotation runs; a rendering re-evaluates exactly at each flip boundary.

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
- **Counted in D1 (`storage: 'database'`), not memory.** The default store is a module-level map, which on Workers is per isolate: a client whose requests land on several isolates gets each one's allowance, and an evicted isolate forgets. D1 has one primary, so a client has one count for the installation. The cost is a `rateLimit` table (migration `0001`) and a read and a conditional write on every request to Better Auth's HTTP handler: sign-in, sign-out and the browser app's `get-session`. The server-side `getSession` every `/api/**` request makes does not pass through the limiter, so ordinary API traffic pays nothing. For a small team that is cheap.
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
- The old `mediaBackground` configuration reset rather than mapping onto a video layer (small install base, as ADR-0014). New Background Screens start empty: black until configured.
- **At most one animation layer per Screen**, enforced on the `layers` field in the schema: each is its own WebGL context and an OBS browser source is memory-tight. Liftable.
- Opacity belongs to the layer, never to the stack or the renderer behind it.
- Image and video layers take a Screen Media Source — a Graphics Asset Library reference or a Remote Media URL — whose reach ADR-0021 sets. Asset-sourced layers join Graphic Asset Reference indexing under the `layers.` owner-slot namespace; a plain overlay mode's own stack indexes under `<mode>.backgroundLayers.` (#580).
- Which modes carry their own stack is declared once, on the Screen Mode Definition (`backgroundLayers: true`). The config field and its validation, reset preservation, the editor card, the painting, and reference indexing all derive from that declaration. Every plain overlay mode declares it, Top Cards included.

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

Nothing is live and no database holds data worth keeping, so the history's backfills and data rewrites (0007, 0024, 0025, 0028, 0030) protect nothing, and their per-migration tests only exercised them. Production's `_hub_migrations` records the old names; squashing after ship would mean hand-editing that table, so the window closes at first ship.

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

Accepted · 2026-10-17 · [#604](https://github.com/KeeprDigital/stream-keepr/issues/604) · Amended 2026-10-21 ([#707](https://github.com/KeeprDigital/stream-keepr/issues/707)): a Card's expiry is a clock projection that no read, client or timer writes

### Decision

**Every read a rendering of a Screen makes goes through that Screen**, under `/api/screen-output/events/:id/screens/:screenId/**`, and is admitted by its Screen Output Asset Capability or an operator Session (ADR-0010's dual credential). The family is: `event` (the Event context), `card`, `broadcast-graphics/live-session`, `player-history`, `standings`, `metagame`, `top-cards`, `pairings` (#751), `head-to-head` (#760), `feature-match-slots/:slotId`, `players/:playerId/decks`, and the Screen itself by id (for re-reading it after `screen:updated`), beside the existing slug lookup, `broadcast-deck-list` and asset delivery. Each new read is admitted by `requireScreenOutputRead`, and refuses with its one non-enumerating 404.

**A capability reaches a mode's data only while its Screen is in that mode** (`requireScreenOutputModeRead`): a Screen publishes what it is showing, not every mode it holds configuration for.

**The server derives the resource from the Screen's saved configuration.** No id in the URL names what to read where the configuration already does: Player History reads its configured Player, Standings its Round and watchlist, Pairings its Round's Matches, Head-to-head the two Players its Feature Match Slot seats now or the two it picks (#760), Metagame and Top Cards the breakdown their fields describe (one shared query builder, `shared/utils/metagameQuery.ts`, serves both sides). Two reads take a path id, because a rendering legitimately asks for something the configuration names only indirectly:

- `feature-match-slots/:slotId` — a capability reaches only the Slot the current mode shows; a Session reaches any, because the Feature Match Overlay's editor preview renders a Slot not yet saved.
- `players/:playerId/decks` — a capability reaches only the Deck mode's selected Player or the shown Slot's two Players, so it cannot read the Event's decklists ahead of their broadcast.

**The Event context is an allowlist** (`SCREEN_OUTPUT_EVENT_FIELDS`): name, game, orientation, display formatting, Feature Match defaults and feature flags. A rendering holds it as `eventStore.outputEvent`; components shared with control pages read `eventStore.displayEvent`.

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
- The Feature Match Overlay sideboard follows `player:updated` and `playerDeck:cardsResolved` on the Event channel directly, since an output holds no roster for either message to update (ADR-0031). Deck and Standings hold their reads in Screen Mode Data Freshness, which hears their Event Data messages on the Event channel the same way (#603).
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
- **Every Screen Mode that reads Event data re-reads once its Event channel first attaches too, and a load hears a continuity loss while it reads** (#733). A mode reads as it mounts, which on a first load is before that channel attaches, so the same window stood open for the mode's own data. Reconnect Resync takes an `onFirstAttach` handler beside its resync, told once when the channel it starts listening on first attaches and never when that channel was attached already. Screen Mode Data Freshness (so Standings, Metagame, Top Cards, Player History, Deck, Card, Feature Match and the Feature Match Overlay's Slot), the Feature Match Overlay's sideboard read and the Broadcast Graphics Live Session sync pass it. Freshness treats it like a message heard mid-read, asking for one follow-up rather than superseding the read in flight, but lets a load's answer render first: an attach says only that something may have gone unheard, not that the answer is behind. The display session listens on its load's Event channel from before the first read for both the first attach and a continuity loss, because Reconnect Resync follows only a finished load's Event: a Screen change within one Event loads on a channel already attached, and a loss there mid-load was heard by nothing. Either one heard mid-load asks for one recovery once the load finishes, rather than superseding it; a Screen change supersedes the load and what it asked for. Reasons that arrive together, such as an attach that is both a first attach and a loss, recover once. The cost is one more read per mode on a first load whose channel attaches after the mode read, which is the usual case for a Screen Output.

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

- **Stored params, Animation Effect Presets, and Template Packages naming the old keys stop parsing**: the strict schemas refuse them and the renderer falls back to defaults. That is acceptable before ship only. No format-version bump, for the reason ADR-0014 gives.
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

Accepted · 2026-10-17 · [#599](https://github.com/KeeprDigital/stream-keepr/issues/599)

### Decision

**A glow is composed opacity, so the Key Output paints it like any other paint: white at the glow's own opacity.** That holds for every glow host — a Graphic Item's Graphic Surface Style, a Source Item's framing, and the Feature Match Overlay Frame's border. One module, `app/modules/screen/outputPaint.ts`, owns the Fill-versus-Key paint rules both render models use: a colour at an opacity, a glow on each output, and the flat hosts' glow defaults (the border colour, at three-quarter opacity). The Frame's paint is decided in the pure Feature Match Overlay render model, not its display. `pnpm accept key-matte` rasterises each host in Chromium and requires the Key matte to equal the Overlay alpha.

### Why

Graphic Item glow already reached the Key Output, but Source Item and Frame glow were withheld from it, so the Fill Output showed a glow the Key matte cut away: on air, a glow keyed against black. A glow is a drop shadow composited source-over, so white at its opacity accumulates into the matte by the same identity as every other element.

### Consequences

- A half-opaque glow is grey in the matte.
- A Frame border with no colour paints nothing in the Key Output either, as in the Fill Output.
- A colour that carries its own alpha (`rgba()`, eight-digit hex, `transparent`) still keys at the authored opacity alone; the pickers write opaque hex, so the matte matches what they author.
- The raw CSS Frame gradient stays host-owned and paints in colour only; the Key Output keys the Frame through its white fill.

### Rejected alternatives

- **Keep withholding host glow from the Key Output** — the Fill/Key mismatch is the defect.
- **Key every glow opaque white** — overstates a partial glow, so the matte would no longer match the Fill Output.

## ADR-0028: Reconnect Resync re-reads the Event Data its consumers name, and a revisit re-reads what was missed

Accepted · 2026-10-20 · [#610](https://github.com/KeeprDigital/stream-keepr/issues/610)

### Decision

**A consumer names the Event Data it reads, and Reconnect Resync re-reads exactly that.** Event Data Resync (`app/modules/event-data/resync.ts`) counts consumers per dataset: the Event, Players, Phases, Rounds, Matches, Feature Match Slots, Archetypes, Player Lists, Player Decks, Screens, and the selected Screen's Card. A page consumes each `useEventPageLoading` entry while it is mounted, and names what it loads outside them. The default layout consumes the Event and Screens, and Live Control consumes the Event Data it resolves Graphic Input Bindings from. The Realtime Event Session runs the resync beside the Feature Match Assignment and Broadcast Deck List reloads. It does so once the Event channel is attached again having lost continuity (#641), and when its subscriptions stop waiting on a token (ADR-0023). A token wait missed what was published meanwhile too, and a first attach over an unbroken connection reports no continuity loss. Each dataset is re-read once, however many consumers share it, in place and only if its store already holds it. Its scope is kept: a Round's Matches stay a Round's Matches. A re-read that fails or does not land leaves its dataset behind.

**What nobody consumed at the resync is behind.** A store outlives the page that loaded it, and `useEventPageLoading` skips a loaded store. So the next consumer to name a behind dataset re-reads it instead of trusting it. `resetAllEventStores()` forgets what is behind, because the reset ends the Event Lifetime and nothing it held survives.

**The Card mode reads through Screen Mode Data Freshness.** The Card store still follows the Card's own messages. The module re-reads it on reconnection, and on the slow cadence while realtime is degraded. Only a change of Screen deselects the old one. A re-read leaves the Card on air until it answers.

### Why

The Realtime Event Session re-read only Assignments and Broadcast Deck Lists on reconnect. An Event Data collection already held stayed as it was when the socket dropped, and so did a Card on program. The Card mode loaded on mount and on a Screen change only, so a Card changed or cleared during the outage stayed on air. Live Control computed latest bound values from stale stores. Re-reading only what is consumed keeps a resync's cost to what is on screen.

### Consequences

- An operator's resync re-reads every consumed collection at once. That is a burst of list reads per open page, once per reconnection.
- Each mode's Settings panel consumes the Event Data its pickers load. A store loaded by a component that does not consume it is not re-read on reconnect. It is behind, and its next consumer re-reads it.
- A consumer that also reads what no store holds passes its own re-read, which runs on every resync until the consumer is disposed. The metagame pages pass their summary and section fetch. That re-read is never behind, since it dies with its page. A metagame page can fetch twice on one resync, once for its own re-read and once more when the Player re-read bumps the roster version.
- A Feature Match Slot re-read offers its Session to the Live State Follower, which holds it when it is newer. So a Session missed in the outage reaches Live Control's bound values through the Slots.
- The Card mode, through Screen Mode Data Freshness, also re-reads on the degraded cadence while disconnected.
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

Accepted · 2026-10-20 · [#607](https://github.com/KeeprDigital/stream-keepr/issues/607)

### Decision

**The Screen write module decides which writes edit a Screen's graphics Edit workspace.** Every Screen write passes through `screenWriteModule()`, and each of its update operations takes the asking browser Session as a required `authoringSessionId`. A route only says who is asking. The protected fields are the Broadcast Graphics stack, and the canvas (`width`, `height`) while the Screen is in Broadcast Graphics mode. The mode configuration write protects the Broadcast Graphics stack. The Screen configuration write protects the canvas when it names it. The generic Screen write protects either one when it would change it.

**The generic Screen write is gated by change, not by presence.** It replaces `modeConfigs` and `screenConfig` whole, and the Edit Screen dialog sends both back as it read them. A rename that carries the protected fields back unchanged stays open to every Session. The comparison ignores object key order.

**The lease is checked again inside the statement that commits.** A write is admitted up front, then commits only while no other Session holds a live lease on the artifact. That condition sits in the same `WHERE` clause as the `stateVersion` guard. It is one Drizzle expression, `graphicsAuthoringLeaseFenceCondition`, and the raw D1 mode configuration write renders the same expression. A write the fence refuses answers the lease's own 409, which the client does not retry as a race.

**Live Control stays outside the lease.** Live Session commands, live state reset, Screen commands, Card writes, and Screen mode changes are not admitted by it.

### Why

The lease was only checked at two routes. The generic Screen write reached the same stack and canvas with no lease check at all, so a second Session's write succeeded with a current `stateVersion`. A check at the door also left a window. A takeover between admission and commit let the displaced author's save land over the new holder.

### Consequences

- A route that edits the workspace cannot forget the lease. Leaving out `authoringSessionId` is a compile error.
- The fence uses the server's clock at commit. A lease that lapses between admission and commit admits the write, which matches the lease's own rule.
- Two takeovers in the same instant still both report success (see the lease module); the fence orders whichever holder the table records.
- Feature Match Layout placement keeps its admission-only lease check. No client takes a lease on a Feature Match Overlay layout, and its mode configuration route has none.
- Broadcast Graphic Template placement is admitted inside the mode configuration write, after the template is read. A non-holder placing a missing template now gets its 404 before the lease's 409. Nothing is written either way.
- Deleting a Screen is not lease-gated. It removes the Screen rather than editing its workspace, and its lease lapses at the holder's next missed heartbeat.
- Deleting a Player writes its Screens outside the Screen write module (ADR-0032). It clears only a Deck Source, which no lease protects.

### Rejected alternatives

- **Refuse the protected fields on the generic Screen write outright.** That would break the Edit Screen dialog, which sends `modeConfigs` back on every rename.
- **Keep the admission check alone and state the race.** The fence costs one `NOT EXISTS` on a uniquely indexed row, and it closes the race outright.

## ADR-0031: A resolved Unresolved Deck Card announces the Deck Lists it rewrote, and re-projects nothing

Accepted · 2026-10-20 · [#648](https://github.com/KeeprDigital/stream-keepr/issues/648)

### Decision

**Resolving an Unresolved Deck Card publishes `playerDeck:cardsResolved`** once its batch commits. The message names every Deck List the resolution rewrote and their Players (`deckIds`, `playerIds`), because one resolution rewrites every Deck List in the Event holding that name, not only the one the operator opened. It publishes plainly: no Graphic Input Binding reads a Deck List's cards.

**No Player revision moves and no Archetype projection re-runs.** The projection reads only a deck's Archetype, review, name and colours, none of which a card changes. Key-card matching is a suggestion in the Archetype assignment UI, not part of the projection.

**Screen Outputs re-read through what they already follow.** The Metagame and Top Cards breakdowns re-read on every resolution. The Deck mode re-reads when the message names its selected Player, and the Feature Match Overlay sideboard when it names either side's Player.

**Operator browsers drop what they cached.** An operator browser drops those Players' cached Deck Lists and invalidates its Metagame pages. The resolving browser does the same itself, since it skips its own message. A read in flight when its Player's entry is dropped is not cached when it lands.

**Reconnect Resync drops the whole Player deck cache.** Contradicts Reconnect Resync's "a resync re-reads and never clears" (CONTEXT.md, ADR-0028) — worth it because the deck cache is a read-through cache, not held Event Data: it renders nothing of its own, and every reader fetches through it. It is keyed by Player revision, which a missed resolution never moves, so nothing else would ever re-read it. Melee sync refreshes already drop it the same way.

### Why

The resolution published nothing. Only the resolving browser cleared its own deck cache. Every other browser and every Screen Output kept the old Deck Lists until some unrelated change made them read again.

### Consequences

- A degraded Deck or sideboard rebuild is compared by what it was built from, not by Player revision. Otherwise a rewritten Deck List could be kept off program as "unchanged" while Scryfall is still failing.
- A surface that already holds a deck read from the cache keeps it until it reads again: Feature Match deck counters and tokens, an open Player deck modal, a Card Screen deck source. Only its next read is fresh. A resolved card that adds a deck counter type reaches the Feature Match counters only then.
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

**Each cleared Screen is announced with `screen:updated`, ahead of the delete's own announcement and without an origin.** The deleting client never received those Screens back, so it must not skip the announcement as its own echo. A Deck Screen Output then follows its Screen to no Player, blanks through the staged swap, and stops reading the Player. A `melee:dataReset` that arrives before the Screen reload lands can still cost one failed read, and its retry stops once the reload lands.

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

Accepted · 2026-10-21 · [#614](https://github.com/KeeprDigital/stream-keepr/issues/614)

### Decision

**A template has no retained-reference path.** Every write of a Broadcast Graphic Template or a Feature Match Layout Template requires each Graphic Asset Reference its stored document holds to name an existing revision, with available content, of an active Graphic Asset whose kind fits its item, input, or typography slot. That covers save, revision, rename, a single-template Style Set update, and the library-wide Graphic Style Set operations that rewrite templates. A write that keeps a reference it already held is held to the same rule as one that introduces it. Anything else is refused with `409`.

**The route asks first and names every refused slot.** `assertGraphicsTemplateReferencesSelectable` (`server/utils/graphicsTemplateReferences.ts`) asks the library once for the whole document and lists each slot with its reason: does not exist, content unavailable, retired, trashed, or the wrong kind. Its several-template form answers for a Graphic Style Set operation, naming each template a refusal belongs to.

**The store asks again in the statement that commits.** The template row's `INSERT` or `UPDATE` carries `REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE`, the rule the Screen write already uses, with no reference allowed to be retired. The reference-index insert reads the same bound array under the same rule. So a template commits only with every reference resolving, and then every reference is indexed. The rule now lives in `server/modules/graphic-asset-reference-resolution.ts`, shared by the Screen and both template stores. A commit the rule refuses answers its own `409`, told apart from a stale `revision` by the revision still standing.

**A Graphic Style Set operation is refused whole.** Deleting an entry or a whole Style Set already stamps one operation only if every participant is at the revision it read. That first statement now also requires every reference of every template it rewrites to resolve, and each rewrite restates its template's reference index under the same stamp. One template referencing an asset that is no longer selectable refuses the whole operation: the Style Set and every template stay as they were. That refusal is `GraphicStyleSetTemplateReferenceConflict`, told apart from a concurrent edit by every revision still standing. The route asks first and names each refused template; the commit-time refusal only happens when the catalogue moved after that, and its `409` names none.

**Retire is refused while a saved template references the asset.** Retiring a Graphic Asset is refused while any Broadcast Graphic Template or Feature Match Layout Template references any of its revisions. It answers `in-use` with those templates' usage, as Trash answers a referenced asset, and the Library Workspace names them. The condition sits in the catalogue's retiring `UPDATE`, so a template saved concurrently either commits first and holds the asset back, or finds the asset retired and is refused. A Screen's reference does not hold Retire back: a Screen keeps an unchanged retired reference resolving, as before. This matches a selected Broadcast Deck List, which cannot be deleted.

**Content availability is checked at the route only.** It is the byte store's state, which no D1 statement can see.

### Why

Both template stores checked only that a revision existed. An image Media Graphic Item could pin a font, and retired or unavailable content was accepted. The check ran only at the route, and the index insert silently skipped a revision it could not find, so a template could be stored with a reference the index never recorded. No template documents with old references exist yet, so there is nothing to keep a retained-reference exemption for.

Without the Retire guard, the rule would turn retiring an asset into making every template that uses it unrevisable, a rename included.

### Consequences

- A template's references cannot become retired, trashed, pruned, or purged under it. Trash, Revision Pruning, and purge each prove no reference points at a revision, and Retire now proves no template does.
- Unavailable content can still appear under a saved template. It refuses that template's writes, and any Style Set operation that rewrites it, until Exact-Byte Repair restores the bytes.
- An Installed Graphics Template does not hold Retire back. It is never revised and cannot be deleted, so counting it would make its assets unretirable for good. Retiring one of its assets leaves it unplaceable until restored, as before.
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
- Docs-only changes still skip CI's gates in the queue. That is sound while nothing bypasses the queue, because the queue's base then passed its own run. If something did, the next Release PR's group still tests the whole tree before a release.
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

Accepted · 2026-10-21 · [#587](https://github.com/KeeprDigital/stream-keepr/issues/587), [#588](https://github.com/KeeprDigital/stream-keepr/issues/588), [#589](https://github.com/KeeprDigital/stream-keepr/issues/589) · Amended 2026-10-21: a contract field carries its editor control's metadata, and a stored value outside a bound reads clamped · [#498](https://github.com/KeeprDigital/stream-keepr/issues/498)

### Decision

**A Screen Mode's config is defined once, as a config contract on its Screen Mode Definition** (`config` in `shared/screenModes.ts`, built with `defineScreenModeConfigContract` in `shared/screenModeConfigs/`). The contract holds the mode's own fields as a zod shape and a complete `defaults` value. The config type is inferred from the shape (`ScreenModeConfigOf`, the schema's input, so a nested value a reader re-proves keeps its authored form), and `defaults` is typed by it, so a type that disagrees with its schema, or a default of the wrong type, is a compile error. `getDefaultConfigForMode` reads the contract's `defaults`.

**A default lives only in the contract's `defaults`.** A contract field may not carry a zod `.default()` or `.prefault()`; the type refuses one. A schema default was a second copy, and zod 4 applies it even through `.optional()`, so it leaked into every PATCH that left the field out.

**A field whose schema reaches server-only Graphic Asset ids is server-validated.** The Background Screen's `layers`, the Broadcast Graphics `graphics` stack and the Feature Match Overlay `layout` are declared in the contract as `serverValidatedField<T>()`, which fixes the field's type and default and refuses every value in the contract's own schema. The server supplies the field's schema when it derives the mode's forms, typed so that what it produces is a `T`, the check a `satisfies z.ZodType<T>` made before; a server-validated field left without a server schema fails to compile and refuses to boot. `T` is the hand-written `BackgroundLayer[]`, `BroadcastGraphicConfig[]` or `FeatureMatchLayoutConfig`, which the server schema is checked against. Everything else these modes carry, such as Broadcast Graphics channels and background, is an ordinary contract field.

**An authored stack is declared on the contract** (`authoredStacks`): a list field holding authored content with no recovery path, the Background Screen's `layers` and the Broadcast Graphics `graphics`. A display reset leaves it, and its PATCH form is only `.optional()`, so `null` cannot delete it and empty it. Every other field's `null` deletes the stored key, which then reads as the default.

**The write forms are derived on the server without special cases** (`configContractModeForms`). The complete schema is the contract's fields, with the server's schema for each server-validated one, plus `backgroundLayers` when the mode declares a Background Layer stack. Screen create and full update accept a fragment of it, because storage holds fragments. The PATCH form is every field `.nullable().optional()`, except each authored stack, with no wrapper peeled and no default stripped. The server's schema maps are built from one per-mode list of these forms.

**Every Screen Mode is on its contract.** Metagame moved first (#587), then the other plain overlay modes (#588), then Background, Feature Match, Feature Match Overlay and Broadcast Graphics, after which the old form was deleted: the hand-written mode config types, the separate defaults objects, and `createModeConfigPatchSchema` with its wrapper-peeling (#589). A contract module holds the mode's own sub-shapes and the defaults its readers complete a nested fragment from, such as Deck's board layouts and `resolveDeckBoards`; a sub-shape several modes repeat, such as a table column, the header, or the Page Rotation fields, lives once in `subShapes.ts`. `test/unit/server/schemas/screenModeConfigContracts.test.ts` parses every contract's defaults against its complete schema and both write paths, round-trips them through a PATCH, takes each field alone and `null`, and checks each authored stack refuses `null`.

**A contract field may carry its editor control's metadata, and its editor reads the control from the contract** (#498). A field edited by a scalar control (a number, toggle, select, colour or text input) is declared with `editorField(schema, meta)` in `shared/screenModeConfigs/fields.ts`, which puts the meta on the field through zod's `.meta()`: the label, a step, a control hint where the schema cannot say (a colour rather than text), and a display scale for a field edited in another unit (Page Rotation's milliseconds, edited in seconds). The bounds are not in the meta: they are the schema's own inclusive `.min()` and `.max()`, read back. The default is not in it either: it stays in `defaults`, and `FieldsWithoutDefaults` still refuses a `.default()` or `.prefault()` under an editor field. The contract derives `fields`, the editor-facing view of every editor field, through `screenModeConfigFields`, as `animationEffectParamFields` does for an Animation Effect's params, except that it reads no default from the schema. A sub-shape several modes repeat carries its meta once, in `subShapes.ts`; a nested block derives its own view, as Deck's board layout does (`DECK_BOARD_LAYOUT_FIELDS`). Rich controls stay bespoke and carry no editor meta: an authored stack, a server-validated field, an Event Reference picker (ADR-0038), a column list, and a preset choice. A Page Rotation field's label and bounds come from the contract, but its edit still goes through `useRotationConfigWrites` (ADR-0039).

**Where an editor and its contract disagreed, the editor's range was the product range, and the contract now holds it.** A stored value outside a tightened bound is clamped into range when read, never reset to the defaults and never refused: `contract.clampStored` pulls each stored number outside its field's inclusive bounds to the nearest bound, nested blocks included, and leaves everything else to the reader as before. `resolveScreenModeConfig` applies it for every rendering and server reader, and `mapScreenToResponse` (`clampStoredModeConfigs`) for every Screen a client receives, so an editor that writes a value back, such as Deck's whole board block or the Edit Screen dialog's full write, sends one in range. Storage keeps what it held until a write replaces it. Writes outside the bounds are refused as before.

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
- An editor offers exactly its contract's range, since the bound has one copy. `test/nuxt/components/Screen/Modes/settingsEditorFields.test.ts` runs over `SCREEN_MODES`: it mounts every mode's settings editor, drives each scalar control, and fails if the contract field it writes carries no editor meta, or if its label, bounds, step or select options differ from the contract's. A select must offer exactly its field's values, less any listed there as not offered: an enum value cannot be clamped to a nearest one, so a contract wider than its editor is left for a decision rather than tightened. It also fails if an editor field is never rendered. A mode whose editor has no scalar control is listed there with its reason.
- The bounds #498 tightened are listed in its PR, each with the editor range it adopted. A Screen storing a value outside one renders and edits it as the nearest bound until its next write of that field, or of the block holding it, stores the clamped value.
- The clamp reads only inclusive number bounds. A string over its length cap, a list over its count cap, or a number under an exclusive bound such as `.positive()` reads as stored, as before, because no nearest allowed value exists to clamp to.

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

**Every Screen Mode Definition declares its Event References** (`eventReferences` in `shared/screenModes.ts`, next to `config`): each config field naming something that must belong to the Screen's Event, and the kind it names. The kinds are a Round, a Player, a Player List and a Feature Match Slot, each by id, and a whole Deck Source. A mode with none declares `{}`. The declaration is required, so a mode added without one fails to compile. A declared field that is not one of the mode's contract fields, or does not hold what its kind names, also fails to compile.

**The Screen write path derives its Event checks from the declaration alone.** `validateScreenModeConfigReferences` checks each declared field of the written config by its kind, through one check per kind (`EVENT_REFERENCE_CHECKS`, exhaustive over the kinds). Every Screen write runs it: create, full update and a mode config PATCH. The per-mode switch it replaces is deleted.

**The checks are unchanged.** An id outside the Event is refused with 404, as before. A Deck Source naming another Event's Player is refused with 404, and a Broadcast Deck List that is not selectable with 409 `SCREEN_DECK_SOURCE_CONFLICT`. The Deck Source guard triggers (`screens_deck_source_insert_guard` and `screens_deck_source_update_guard`) stay. They prove the Deck Source again inside the Screen write's own statement, so a Player or Broadcast Deck List that goes away between the check and the write still cannot be saved.

The declarations are Card, Feature Match and Feature Match Overlay `featureMatchId` (Feature Match Slot), Deck `deckSource`, Standings `roundId` and `playerListId`, Metagame and Top Cards `playerListId`, Player History `playerId`, Pairings `roundId` (#751), and Head-to-head `featureMatchId` (Feature Match Slot), `player1Id` and `player2Id` (#760). Background, Top Cut and Broadcast Graphics declare none. A Broadcast Graphics stack declares only which kind each Graphic Source Selection picks; the pick itself is Live Session state.

### Why

The switch had no exhaustiveness check, so a mode it forgot was skipped without anyone noticing. It had forgotten Top Cards, whose Player List was never checked against the Event. Declaring the references on the Screen Mode Definition puts the question to every mode when it is defined, as the Background Layer declaration does for its stack.

### Consequences

- Saving a Top Cards Screen whose Player List belongs to another Event is now refused, as for Metagame. Screens already storing one are not repaired; their next write of Top Cards config must name a Player List in the Event, or none.
- `test/unit/server/modules/screenModeEventReferences.sqlite.test.ts` runs over every declared field, against real SQLite. It shows that create, full update and PATCH all refuse another Event's entity and accept the Screen's own. A new kind fails to compile there until it has samples. The test also lists the declarations, so adding or dropping one is a visible test change. It also checks that a display reset keeps every declared Event Reference, which `MODE_RESET_PRESERVED_KEYS` still lists by hand, among other preserved keys.
- The type-level check proves only that each declared field exists and holds an id or a Deck Source. Whether a new id field is an Event Reference is still the author's call, but they now have to make it on the definition.

### Rejected alternatives

- **Declare the references on the config contract** (as `authoredStacks` is). The key check would come for free. But what a field names in the Event is a capability of the mode, not part of its config's shape or defaults (ADR-0037). The Background Layer stack is declared on the definition for the same reason.
- **Infer references from field names** (`*Id`, `deckSource`). Nothing would have to be declared, but naming would become load-bearing. `presetId` and Graphic Asset ids would match the pattern without being Event References.
- **Keep the switch and add a `never` default.** That would catch a new mode but not a forgotten field. The ticket asks for the switch to go, not to be wrapped.

## ADR-0039: A paginated Screen Mode Definition declares its Page Rotation, and one rule decides its shape changes

Accepted · 2026-10-21 · [#586](https://github.com/KeeprDigital/stream-keepr/issues/586) · Amended 2026-10-22: Top Cards declares a Page Rotation over its grid rows · [#757](https://github.com/KeeprDigital/stream-keepr/issues/757)

### Decision

**A paginated Screen Mode Definition declares its Page Rotation** (`pageRotation` in `shared/screenModes.ts`, next to `eventReferences`), naming the config field holding how many rows a page holds: Standings `rowsPerPage`, Metagame `pageSize`, Top Cards `rowsPerPage` (#757), Player History `rowsPerPage` and Pairings `rowsPerPage` (#751). A mode that is not paginated leaves it out. The declaration is optional, as `backgroundLayers` is, because the compile check runs both ways: a declaring mode whose config lacks the shared Page Rotation fields (`pageRotationShape`) or a numeric page size field fails to compile, and so does a mode whose config carries any rotation field without declaring one (`PAGE_ROTATIONS_FIT_THEIR_CONFIG`). So a mode cannot rotate without declaring it, and the other eight need not write "not paginated".

**The rotation fields and their validation are written once**, in `shared/screenModeConfigs/subShapes.ts`: `pageRotationShape` with `DEFAULT_PAGE_ROTATION`, and `pageRotationPageSize` for the page size field each mode names itself. Each paginated contract spreads them (ADR-0037), so the server's write forms validate them identically. The type an operator surface reads them through (`PageRotationConfig`) is inferred from that shape, replacing the hand-written copy.

**One rule decides which edits change the rotation's shape** (`pageRotationEdit` in `shared/modules/page-rotation`): an edit of the declared page size field or of `autoPageIntervalMs`. While auto-page is on, such an edit restarts the rotation from page 1 by writing a Rotation Anchor of now. A page size edit also writes `currentPage: 1`, whether or not auto-page is on, because every page then holds different rows. Any other edit is written as it is, so nothing else re-anchors (ADR-0009).

**Every consumer reads the declaration.** A paginated mode's settings editor writes every edit through `useRotationConfigWrites({ mode, config, rowCount, saveConfig })`, whose `updateConfig` applies the rule and whose `totalPages` counts pages by the declared field; its `updateRotationShape`, which each editor had to remember to call, is deleted. A paginated mode's rendering pages through `usePaginatedScreenMode({ mode, config, rows })`, which reads the page size from the declared field and writes a page selection or Rotation Anchor only from an interactive surface. The three hand-wired copies of that paging and its writes are deleted. A display reset writes through the rule as well (`getDisplayResetForMode`). Screen Outputs still never write the Rotation Anchor.

### Why

Each paginated editor decided the rule separately, and the copies disagreed: a Standings page size edit re-anchored but left the manually selected page alone, while Metagame and Player History reset it to 1. The rotation's paging was also wired by hand into three renderings and its fields into a fourth type, each naming the page size field anew.

### Consequences

- A Standings page size edit now resets the manually selected page to 1, as Metagame's and Player History's did. Nothing else changes: a page duration edit re-anchors while rotating and leaves the manually selected page, on every paginated mode, as before.
- **Top Cards pages its grid by whole grid rows** (#757): its rows are the grid's rows of `columns` cards, so `rowsPerPage` counts grid rows and a page holds `rowsPerPage × columns` cards, each keeping its rank across the whole ranking. Its default `rowsPerPage` is the most cards a Screen can rank (60), so a Screen that never set it, at any card count and column count, shows every card on one page as before. An operator turning auto-page on lowers it to get more than one page. A `columns` edit changes which cards each page holds, not the rotation's shape, so it resets the manually selected page to 1, like the Top Cards data edits, and never re-anchors.
- Edits that change the row set rather than the rotation's shape, such as a Metagame scope or a Standings Round, still reset the manually selected page in each editor where they did, and never re-anchor.
- A display reset of a paginated mode goes through the rule too (`getDisplayResetForMode` in `shared/screenModeDefinitions.ts`, which `useModeConfigUpdate`'s `resetConfig` writes): it restores the default page size and duration, a shape change, so it restarts the rotation from page 1 and writes a Rotation Anchor of now only if auto-page is on once reset. The defaults turn auto-page off, so today a reset writes `currentPage: 1` and no anchor; neither `currentPage` nor `rotationAnchor` is a display default or a preserved key. The reset is written from the Screen's settings page, so Screen Outputs still never write the Rotation Anchor.
- `test/unit/shared/screenModePageRotation.test.ts` lists the declarations, checks that every other mode carries no rotation field, and runs over every declaring mode from `SCREEN_MODES`: it carries the shared fields, validation and defaults, a page size or page duration edit re-anchors only while auto-page is on, and a page size edit resets the manually selected page to 1. `test/nuxt/modules/rotationConfigWrites.test.ts` shows a settings editor's `updateConfig` applies the rule, and `test/nuxt/composables/screen/useModeConfigUpdate.test.ts` that a display reset does.

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
4. a scoped Phase that still holds a Round (a manual one, or one kept in step 2) is kept the same way, and the other scoped Phases are deleted. A kept Phase keeps its `formatExternalId`, because that is still the format it was played in and Deck Lists are matched to its Matches by it.

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

**The client shows a Screen as its newest server revision with every unsettled write's fields laid over it** (Field Ownership, in `app/modules/screen/runtime.ts`). Each write owns the fields it names: an ordinary Screen update its top-level fields, a mode-configuration or Screen-configuration write the config fields it patches. A revision from any door — a write's answer, a conflict refresh, an announced reload, a load — replaces only the revision underneath, and only when it is not older than the one held, so nothing moves a Screen's `stateVersion` backwards. A write that settles drops only its own fields. A failed write therefore rolls back to what the server holds now, keeping a remote change that landed meanwhile, and never over a newer local edit. A write answers its caller with the newer of its answer and the server revision held, never with another write's unsettled fields. A Screen deleted while a write to it was out stays deleted, whichever way the write ends.

**Every write of one Screen runs in one queue**, whichever part of the Screen it names, and is sent at the revision the write before it was answered with. Independent settings edited at once no longer race each other into a conflict.

**A Screen write keeps what it needs to finish for its own Event after that Event Lifetime ends.** The lifetime records the newest revision of each Screen it held or a write in it was answered with, and a write still queued when the operator moves on is sent, and its conflict retried, at that revision. Its store effects stay gated by the lifetime, as ADR-0024 decided: an answer, rollback or error from a finished lifetime touches nothing of the next one's. The caller is still answered, and a refusal still rejects it. This amends ADR-0024, whose "anything it starts afterwards" read as covering the write and its conflict refresh too: those now run for the ended lifetime, against its own record of revisions, and only their effects are gated.

**A settings surface hands off every queued edit when it ends**, whether or not its debounce has fired and whether or not a save is in flight (`useConfigUpdate`). An edit made during a save used to wait for that save's continuation, which ran after the reset had emptied the store, so it was lost.

**A field an edit names with `undefined` is sent as the `null` that deletes it** (`toModeConfigPatch`, `toScreenConfigPatch`). JSON omits `undefined`, and the server reads an omitted field as unchanged (ADR-0037), so clearing an Archetype filter, custom header or Player List kept the old value. An authored stack named with `undefined` is left out instead, so a clear never empties one. Omission still means unchanged. The edit types (`ScreenModeConfigPatch`, `ScreenConfigPatch`) take `null` for every field without changing the complete config type, and the settings editors write `null` when an optional field is cleared. A cleared field reads as its contract default at once, so it does not snap back.

### Why

A write's v2 answer replaced a v3 the client already held. A failed write restored a whole snapshot from before it, erasing whatever had landed since. Resetting the Event stores during a save dropped the edit queued behind it, and a write retried after the reset was sent at version 0. A cleared optional field reached the server as nothing.

### Consequences

- Every write of a Screen waits its turn, so a mode-configuration and a Screen-configuration write to one Screen no longer run concurrently. Writes to different Screens still do.
- A loader's revision is laid under unsettled edits too, so a page load cannot take back an edit still out.
- A display reset now clears a default that is `undefined`, such as a custom header, where it used to leave the stored one.
- An edit queued behind a save is sent once, by the hand-off, rather than by that save's continuation.
- `test/nuxt/stores/screenWriteOwnership.test.ts` orders every answer by hand against the store; `test/nuxt/composables/screen/screenSettingsSaves.test.ts` drives the configuration composable through an Event reset and a server that answers through JSON with the real PATCH schema and merge; `test/nuxt/components/Screen/Modes/clearingOptionalSettings.test.ts` clears each optional field in the Metagame, Top Cards, Standings, Player History, Pairings and Head-to-head editors.

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
