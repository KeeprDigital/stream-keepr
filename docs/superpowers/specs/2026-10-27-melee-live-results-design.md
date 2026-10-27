# Melee Live Results: design

Status: draft, builder-checked · 2026-10-27

## Intent

Today Melee Sync runs only when an operator presses a button. Match Results
reported on Melee.gg mid-Round don't reach Stream Keepr until someone syncs.

**Live Results** polls Melee.gg for the **Current Round's** Match Results while
an operator has it switched on, so results land as they are reported. It is a
nice-to-have now and a base for later features built on real-time results.
Screens that show results (Pairings, Top Cut Bracket) fill in live; nothing new
is added on screen.

It also makes Melee Sync's realtime messages granular. Today every Round sync
publishes `melee:roundSynced` whether or not anything changed, so polling
would make every results-reading Screen re-read every tick.

## Goals

- Poll Melee.gg for the Current Round's Matches while Live Results is on.
- Work out the Current Round from data, with no operator pointer.
- Publish a message only when something it describes changed, split by what
  changed: Match Results, pairings, Round Standings.
- Pairings and Top Cut Bracket Screens show new results within about a minute
  of Melee reporting them, with no operator action.
- Poll cheaply: one paginated Melee request per tick, D1 writes only for rows
  that changed, no Event-row churn.

## Non-goals

- No new Screen Mode, and no "follow Current Round" option on Pairings
  (builder's call to revisit later; not in this work).
- Polling does not refresh Players, deck lists or Event structure each tick.
- A reported result never changes a Feature Match Slot's game wins or any
  Feature Match Session state; the operator keeps control there.
- Standings do not change mid-Round. Melee's Round Standings for Round N
  include Round N's results (verified on local data: Round N records sum to at
  most N Matches), so they are stored only once Round N completes. While Round
  N is played, the Standings Screen shows Round N−1's standings, the board as
  it stood at the start of Round N.

## Anti-goals (a failure even if it works)

- Polling blocks or delays an operator's manual sync.
- Polling causes Screens on program to flicker or re-read on ticks where
  nothing changed.
- An Event left with Live Results on hammers Melee.gg indefinitely, or keeps
  retrying a failure every minute.
- A tick writes after the operator turned Melee Sync off (the data reset must
  win).

## Domain rules (decided)

### Current Round

Rounds run strictly in sequence: a Round is complete before the next is paired.
So:

- Consider Melee-managed Rounds only (`isMeleeManagedRound`,
  `shared/utils/roundControl.ts`; skips `manual_override`), in the Event's
  Round order (Phase sortOrder, roundNumber, id: `server/services/round.ts`).
- **Current Round** = the latest such Round that has pairings (at least one
  Match stored from Melee).
- A Round is **complete** when every Match in it has a result (`hasResult` or
  `isBye`), **or** when the next Round in Round order has pairings (Rounds run
  strictly in sequence, so pairing Round N+1 means Round N is done; this also
  covers a Round stuck on a Match that never gets a result). Completion is
  derived from synced data only; no operator ever completes a Round.
- When the Current Round is complete, polling also probes the **next** Round
  in Round order. When Melee returns pairings for it, it becomes the Current
  Round.
- With no Round holding pairings yet, the first Melee-managed Round is the one
  probed.

Add **Current Round** to `CONTEXT.md` with this definition.

### Live Results setting

- New per-Event boolean, **Live Results**, shown on the Sync page only when
  Melee Sync is enabled. Default off, existing Events included.
- On means polling runs for that Event. Off stops polling and touches no data.
- Turning Melee Sync off stops polling and sets Live Results off, so
  re-enabling sync later starts with Live Results off.

### What a tick does

1. Skip if Live Results is off, Melee Sync is off, or another Melee Sync
   command holds the Event's lease (`server/utils/meleeSyncState.ts`). Polling
   never takes priority over an operator.
2. If the Current Round is incomplete: fetch its Matches only
   (`GET /match/list/round/{meleeRoundId}`). No standings, Event or Player
   calls.
3. If the Current Round is complete: probe the next Round's Matches. On
   pairings found, that Round becomes current; run its first sync (see below).
4. Diff fetched Matches against stored ones; write only changed rows.
5. Re-check Melee Sync and Live Results are still on at commit; abort the
   write otherwise.
6. Publish only the messages whose content changed.

**When a Round becomes current** (first pairings seen): store its Matches and
refresh Players once so any new Player in the pairings resolves. No standings
fetch.

**When a Round becomes complete** (last result arrives): fetch its Round
Standings once and store them. This is the only point polling touches
standings, and the only time it publishes Round Standings changed. A later
result correction on a completed Round is not polled for; a manual sync picks
it up.

### Cadence and backoff

- Results polling: every minute while the Current Round is incomplete; slows
  to every 5 minutes after 30 minutes with no change; back to every minute on
  the next change.
- Probing for the next Round's pairings: starts at every minute, slows while
  nothing is found, capped at about every 15 minutes. Resets to every minute
  once pairings appear.
- Failures (Melee outage, 429s past the transport's own retries): back off on
  the same curve, record the error in a **Live Results error** of its own
  (not the manual sync's `lastSyncError`, so neither clears the other), and
  clear it on the next successful tick.

### Stopping by itself

Live Results switches itself off (the setting goes off, a stop reason is
stored, the Sync page shows "Live Results stopped: <reason>") when:

- 12 hours pass with no change of any kind (no new result, no new pairings);
- Melee answers an authentication failure (401/403), which waiting won't fix.

The operator turns it back on by hand.

### Round Standings only for complete Rounds

Applies to every Melee Sync path (polling, "Update from Melee", per-Round
Refresh, Re-sync Matches), not just polling:

- A Round's Round Standings are stored only once the Round is complete. A
  sync of an incomplete Round stores its Matches and leaves its standings
  alone, whatever Melee returns for them.
- So the Standings Screen, reading the latest Round holding Round Standings,
  always shows "standings after Round X" for the last complete Round, even
  while Round X+1 is paired and in progress.
- When a Round becomes complete, by either rule, its standings are fetched
  and stored. When Round N+1's pairings arrive, Round N's standings are
  fetched in the same sync if not yet stored.
- Round Standings already stored for a complete Round are refreshed by later
  manual syncs as today.
- `MeleeRoundNotReadyError` for a never-synced Round keys off Matches only,
  since standings are no longer expected for a newly paired Round. Turning it on clears the stop reason
and resets cadence and backoff.
- After the Event's last Round is complete with no next Round in structure,
  polling idles until a structure sync adds one.

### Realtime messages

Replace `melee:roundSynced` with three messages on `event:{eventId}`, each
published only when its content changed. Applies to manual syncs too.

| Message | When | Payload (at least) |
| --- | --- | --- |
| Match Results changed | A stored Match Result in the Round changed (reported, corrected, or un-reported) | `roundId`, changed `matchIds` |
| Pairings changed | Matches in the Round were added, removed, or re-seated (players or table changed) | `roundId` |
| Round Standings changed | The Round's stored Round Standings differ from before | `roundId` |

Listeners:

- **Match Results changed:** Pairings (only for its configured Round), Top Cut
  Bracket (if it holds that Round), Player History, Head-to-Head, the
  operator's Matches page.
- **Pairings changed:** all of the above, plus Feature Match operator data.
- **Round Standings changed:** Standings, Metagame (and Archetype Spotlight,
  Most Played Cards, which share its dependencies), Top Cut Bracket seeds,
  Head-to-Head (reads records from the latest Round Standings).
- Standings does **not** listen to Match Results changed.
- General rule (builder applies it to any Screen missed above): each Screen
  listens to the messages for the data it actually reads.

For one release, also publish `melee:roundSynced` whenever any of the three is
published, so Screen Outputs still on the previous bundle during a deploy keep
updating. Remove it in the following release.

### No Event-row churn

Today every Melee Sync command writes the Event row
(`recordMeleeSyncSuccess`/`recordMeleeSyncFailure`) and publishes
`event:updated`. A tick writes the Event row only when its error state changes
(error appears or clears) or when the poll state the Sync page displays needs
persisting. It must not publish `event:updated` every minute.

### Operator visibility

The Sync page shows, while Live Results is on: the Current Round, when it was
last checked, and the Live Results error if any; when it stopped by itself,
the stop reason. Exact copy and layout: builder's call.

The manual "Update from Melee" Round choice (`lastSyncedAt`-based,
`workflows.ts`) stays as it is.

## Constraints

- Cloudflare Workers + D1 + Ably (see `README.md`). Existing cron:
  `wrangler.jsonc` `"17 * * * *"`, handled via `cloudflare:scheduled` plugins
  (`server/plugins/graphics-*-schedule.ts`).
- Melee transport already retries with backoff and honours `Retry-After`
  (`server/services/meleeTransport.ts`). Credentials are stored encrypted and
  decrypted per call (`server/services/meleeCredentials.ts`).
- One Melee Sync command per Event at a time via the lease
  (`server/modules/melee-sync/index.ts` `runMeleeSyncCommand`).
- Melee Sync commands and workflows currently take an `H3Event` (origin
  connection id, success/failure recording). The poller runs with no request.
- `meleeRoundSnapshotService().replace` (`server/services/meleeRoundSnapshot.ts`)
  rewrites every Match and all Round Standings each run; it needs diffing.
- ADR-0047: only Melee Sync writes a Match Result. Polling is Melee Sync, so
  this holds.
- ADR-0040: never remove a manual Round or Match. Polling's stale-Match
  deletion must keep honouring it.
- Melee.gg publishes no rate limit we have found. Several Events polling at
  once must stay polite.
- Realtime changes need `pnpm test:integration --run` green locally (AGENTS.md).

## Left to the builder

- **Scheduler.** A 1-minute Cloudflare cron fanning out over Events with Live
  Results on is the default. Use a Durable Object alarm only if cron can't meet
  the cadence or backoff cleanly. Record the choice in the ADR.
- Where poll state lives (next-check time, backoff step, last checked, last
  change, Live Results error, stop reason).
  Columns on `events`, a new table, or DO storage.
- How the sync workflows lose their `H3Event` dependency (a context object with
  an optional origin connection id is the obvious shape).
- How the lease is taken for a tick (short lease, or check-and-skip) so a
  manual sync never sees `409` from polling for more than a moment.
- Message names (follow the `melee:*` convention and `CONTEXT.md` terms, e.g.
  `melee:matchResultsSynced`) and exact payloads.
- The Melee-response diff: which fields count as a pairing change versus a
  result change.
- Fan-out limits per cron invocation (subrequests, CPU) when many Events poll.
- The Sync page's Live Results UI.

## Docs to update

- `DECISIONS.md`: new ADR-0049 covering Live Results, Current Round, the
  message split, and the scheduler choice.
- `CONTEXT.md`: **Current Round**, **Live Results**; update **Melee Sync** to
  mention polling.
- `README.md` operations section: what Live Results does and how to switch it
  off.

## Open checks before building

- Confirm against a real Melee.gg tournament response whether Rounds carry a
  status (started, completed), and whether Melee's per-Round standings for an
  in-progress Round are empty, partial, or live (doesn't change this design,
  since standings are fetched only on completion). If they do, prefer it over the
  pairings-and-results inference, keeping the same Current Round definition as
  fallback.
