# Melee Live Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll Melee.gg for the Current Round's Match Results while an operator has Live Results on, store Round Standings only for complete Rounds, and replace the noisy `melee:roundSynced` with change-only granular messages.

**Architecture:** Melee Sync loses its `H3Event` dependency so a cron-driven tick can call it. The Round snapshot write diffs against stored rows and reports what changed; workflows publish one message per kind of change. A per-minute cron runs due Live Results ticks; pure functions decide the Current Round and the next check time; poll state lives in new `events` columns.

**Tech Stack:** Nuxt 4 / Nitro on Cloudflare Workers, D1 via Drizzle, Ably, Vitest (`createSqliteD1Harness`, Nuxt suite).

**Spec:** `docs/superpowers/specs/2026-10-27-melee-live-results-design.md`

## Global Constraints

- Follow `AGENTS.md` § Writing tests: `it.each` tables, fake only network/Ably/clock, persistence on `createSqliteD1Harness` with real migrations, assert outcomes.
- Use `CONTEXT.md` terms: Current Round, Live Results, Match Result, Round Standings, Melee Sync. Never "external fields"/"sync metadata".
- Rounds considered: Melee-managed only (`isMeleeManagedRound`), in Event Round order (`server/services/round.ts:42-52`: Phase sortOrder, roundNumber, id).
- A Round is complete when every Match has `hasResult` or `isBye`, **or** the next Round in Round order has stored Melee Matches.
- Round Standings are stored only for a complete Round, on every sync path.
- Cadence: results every 60 s; every 5 min after 30 min with no change; probe/failure backoff 60 s × 2^step capped at 15 min; auto-stop after 12 h with no change or on Melee 401/403.
- Live Results default off; turning Melee Sync off turns it off.
- Polling never blocks an operator: operator commands wait up to 10 s for a `live-results` lease before answering 409.
- No `event:updated` on a quiet tick; only when Live Results error or stop state changes.
- Publish `melee:roundSynced` (unchanged payload) alongside any new message for one release; new client code never listens to it.
- Realtime-touching tasks need `pnpm test:integration --run` green locally before the PR is marked ready. One integration suite at a time.
- Worktree setup: `cp ../../../.env .env && pnpm install --frozen-lockfile` before first test run.

## Review Focus

1. **Operator acts mid-tick** (presses Update from Melee, or turns sync off, while a tick holds the lease): it waits and succeeds, no 409. Test in Task 6.
2. **Melee un-reports or corrects a result** (`HasResult` true→false, or 2-0→2-1): Match Results changed names that Match; a Round that was complete becomes incomplete, its stored standings stay untouched. Tests in Tasks 2 and 3.
3. **Graphics jobs after the minute cron is added**: retention and reconciliation still run hourly only, not every minute. Test in Task 8.
4. **One Event's tick throws** (Melee 500, deleted Event, sync turned off between query and lease): other due Events still tick; the failing Event gets a Live Results error and backoff, no Match deleted. Test in Task 8.
5. **Completion across a Phase boundary**: the last Swiss Round becomes complete when the first Top Cut Round is paired, and its standings get stored (Seeds depend on it). Tests in Tasks 3 and 7.

---

### Task 1: Melee Sync runs without a request

Pure refactor: replace `H3Event` with a context object so a scheduled tick can call workflows and status recording.

**Files:**
- Modify: `server/modules/melee-sync/workflows.ts` (every `requestEvent: H3Event` parameter)
- Modify: `server/modules/melee-sync/index.ts` (commands build the context)
- Modify: `server/utils/meleeSyncState.ts:33-85`
- Modify: `server/modules/melee-sync/configuration.ts` (calls into state/publication)
- Test: `test/unit/server/modules/meleeSyncCommand.test.ts`, `meleeSyncWorkflows.test.ts`, `meleeSync.sqlite.test.ts`, `test/unit/server/utils/meleeSyncState.test.ts`

**Interfaces:**
- Produces: `export interface MeleeSyncContext { originConnectionId?: string }` in `server/modules/melee-sync/context.ts`; `meleeSyncContextFrom(requestEvent: H3Event): MeleeSyncContext`.
- Produces: `createMeleeSyncWorkflows()` functions take `ctx: MeleeSyncContext` where they took `requestEvent`.
- Produces: `recordMeleeSyncSuccess(ctx, eventId, data, leaseToken?)`, `recordMeleeSyncFailure(ctx, eventId, error, data?, leaseToken?)`.
- `meleeSyncModule()` route-facing signatures stay `(requestEvent: H3Event, …)`.

- [ ] **Step 1:** Change signatures; no behaviour change. Workflows read `ctx.originConnectionId` where they called `getOriginConnectionId(requestEvent)`.
- [ ] **Step 2:** Update tests' call sites (pass `{ originConnectionId: 'origin-1' }`); keep one assertion per suite that the origin connection id reaches `publishMessage` unchanged.
- [ ] **Step 3:** Run `pnpm vitest run test/unit/server/modules/melee test/unit/server/utils/meleeSyncState.test.ts`. Expected: PASS.
- [ ] **Step 4:** Run `pnpm verify:quick`. Expected: PASS.
- [ ] **Step 5:** Commit `refactor(melee-sync): workflows take a sync context, not a request`.

---

### Task 2: Round snapshot writes only what changed

**Files:**
- Create: `server/services/meleeRoundDiff.ts`
- Modify: `server/services/meleeRoundSnapshot.ts`
- Test: `test/unit/server/services/meleeRoundDiff.test.ts` (new), `test/unit/server/services/meleeRoundSnapshotD1.test.ts`

**Interfaces:**
- Produces in `meleeRoundDiff.ts`:
  - `MATCH_RESULT_FIELDS = ['hasResult','player1GameWins','player2GameWins','gameDraws','isBye'] as const`
  - `MATCH_PAIRING_FIELDS = ['roundId','tableNumber','player1Id','player2Id','player1Data','player2Data','sortOrder'] as const` (`*Data` compared structurally)
  - `diffRoundMatches(stored: DbMatch[], incoming: MatchUpsertInput[]): { toWrite: MatchUpsertInput[]; resultChangedExternalIds: string[]; pairingsChanged: boolean }` — `pairingsChanged` true on any added, removed, or pairing-field change.
  - `standingsDiffer(stored: RoundStandingInput[], incoming: RoundStandingInput[]): boolean` — keyed by `playerId`, compares wins/losses/draws/position/points.
- Changes `MeleeRoundSnapshotInput.standings` to `RoundStandingInput[] | null` (`null` = leave stored Round Standings alone).
- Extends `MeleeRoundSnapshotResult` with `resultChangedMatchIds: number[]`, `pairingsChanged: boolean`, `standingsChanged: boolean`.

- [ ] **Step 1: Failing tests** in `meleeRoundDiff.test.ts`, `it.each` over: identical → nothing to write, no changes; `hasResult` false→true → that externalId in `resultChangedExternalIds`, `pairingsChanged` false; result true→false (un-report) → listed; game wins 2-0→2-1 → listed; table number changed → `pairingsChanged` true, not a result change; Match added / removed → `pairingsChanged`; `player1Data` record changed only → `pairingsChanged`. `standingsDiffer`: same rows different order → false; one position changed → true; row added → true.
- [ ] **Step 2:** Run `pnpm vitest run test/unit/server/services/meleeRoundDiff.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `meleeRoundDiff.ts`.
- [ ] **Step 4: Failing D1 tests** in `meleeRoundSnapshotD1.test.ts`: second `replace` with identical input returns empty `resultChangedMatchIds`, `pairingsChanged: false`, `standingsChanged: false`, and leaves every Match's `updatedAt` unchanged; `standings: null` keeps stored Round Standings rows; a result change updates only that row's `updatedAt` and returns its id; stale deletion still keeps manual Matches (ADR-0040).
- [ ] **Step 5:** Change `replace`: read the Round's stored Melee Matches and Round Standings first, diff, then batch only changed/new Match upserts, stale delete, standings delete+insert only when `standings !== null && standingsDiffer`, and mark synced.
- [ ] **Step 6:** Run `pnpm vitest run test/unit/server/services`. Expected: PASS.
- [ ] **Step 7:** Commit `perf(melee-sync): a Round snapshot writes only the rows that changed`.

---

### Task 3: Round Standings only for complete Rounds

**Files:**
- Create: `shared/utils/roundCompletion.ts`
- Modify: `server/modules/melee-sync/roundMatches.ts`
- Modify: `server/modules/melee-sync/workflows.ts` (`syncRoundMatches`)
- Test: `test/unit/shared/utils/roundCompletion.test.ts` (new), `test/unit/server/services/roundMatches.sqlite.test.ts`

**Interfaces:**
- Produces: `isRoundComplete(matches: Array<Pick<DbMatch,'hasResult'|'isBye'>>, nextRoundHasPairings: boolean): boolean` (an empty Round is complete only when the next is paired).
- Produces: `syncMatchesFromMelee(...)` result adds `complete: boolean`, `resultChangedMatchIds`, `pairingsChanged`, `standingsChanged`.
- Produces in `roundMatches.ts`: `syncRoundStandingsFromMelee(eventId, eventData, round): Promise<{ standingsChanged: boolean }>` — fetches and stores one Round's standings (also re-maps its Matches' player records via the snapshot write).

Behaviour in `syncMatchesFromMelee`:
1. Fetch Matches. Decide `complete` from fetched Matches + whether the next Melee-managed Round in Round order has stored Melee Matches.
2. Fetch standings only when `complete`; otherwise mapper gets an empty `standingsMap` and `replace` gets `standings: null`.
3. `MeleeRoundNotReadyError` for a never-synced Round keys off Matches only (404 or zero Matches).

In `workflows.syncRoundMatches`, after a sync that stored pairings for a Round whose previous Melee-managed Round holds no Round Standings, call `syncRoundStandingsFromMelee` for that previous Round.

- [ ] **Step 1: Failing tests** `roundCompletion.test.ts` `it.each`: all reported → true; one pending, next unpaired → false; one pending, next paired → true; byes + reported → true; empty, next unpaired → false.
- [ ] **Step 2: Failing sqlite tests** in `roundMatches.sqlite.test.ts` (Melee faked at `requireMeleeService`): in-progress Round sync stores Matches, stores no Round Standings, never calls `fetchStandingsByRound`; final result arriving stores standings; Round 4 paired while Round 3 lacks standings → Round 3 standings stored; same across a Phase boundary (last Swiss Round, first Top Cut Round); completed Round whose result is un-reported → Match updated, stored standings untouched; never-synced Round with zero Matches → `MeleeRoundNotReadyError` even when Melee returns standings.
- [ ] **Step 3:** Run them. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run `pnpm vitest run test/unit/server test/unit/shared`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(melee-sync): Round Standings are stored only for complete Rounds`.

---

### Task 4: Granular, change-only sync messages (server)

**Files:**
- Modify: `shared/types/messages.ts:338`
- Modify: `server/modules/event-data-publication/index.ts:94, 491, 559`
- Modify: `server/modules/melee-sync/workflows.ts:377-403`
- Test: `test/unit/server/modules/eventDataPublication.test.ts`, `test/unit/server/modules/meleeSync.sqlite.test.ts`

**Interfaces:**
- Produces message types:
  - `'melee:matchResultsSynced': { roundId: number; matchIds: number[] }`
  - `'melee:pairingsSynced': { roundId: number }`
  - `'melee:roundStandingsSynced': { roundId: number }`
  - `'melee:roundSynced'` kept, marked `/** @deprecated Published for one release for Screen Outputs on the previous bundle. */`
- Produces publication functions `meleeMatchResultsSynced`, `meleePairingsSynced`, `meleeRoundStandingsSynced` (via `publishSyncMessage`).
- `syncRoundMatches` returns `{ ...result, published: Array<'matchResults'|'pairings'|'roundStandings'> }` (Task 8 reads `published.length > 0` as "changed").

Publishing rule: each message only when its flag is set (`resultChangedMatchIds.length > 0`, `pairingsChanged`, `standingsChanged`, including the previous-Round standings fill, which publishes `melee:roundStandingsSynced` with that Round's id). If any was published, also publish `melee:roundSynced` once with the old payload.

- [ ] **Step 1: Failing tests** in `meleeSync.sqlite.test.ts` `it.each` over sync outcomes → published types: nothing changed → none (and no `melee:roundSynced`); one result → `matchResultsSynced{matchIds:[id]}` + `roundSynced`; new pairings → `pairingsSynced` + `roundSynced`; completion → `matchResultsSynced` + `roundStandingsSynced` + `pairingsSynced` (player records re-mapped) + `roundSynced`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; update `eventDataPublication.test.ts`'s function/message table for the three additions.
- [ ] **Step 4:** Run `pnpm vitest run test/unit/server/modules`. Expected: PASS.
- [ ] **Step 5:** Run `pnpm test:integration --run`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(melee-sync): publish what a Round sync changed, only when it changed`.

---

### Task 5: Screens and operator follow the new messages

**Files:**
- Modify: `app/composables/screen/usePairingsModeData.ts:28`, `useTopCutModeData.ts:54`, `usePlayerHistoryModeData.ts:58`, `useHeadToHeadModeData.ts:55`, `useStandingsModeData.ts:53`, `app/modules/metagame/screenDependencies.ts:42`
- Modify: `app/modules/realtime-event-session/meleeHandlers.ts:54-60`
- Test: matching files under `test/nuxt/composables/screen/`, `test/unit/app/composables/workflows/useEventRealtimeSession.test.ts`

**Interfaces:**
- Consumes: Task 4 message types.

Dependency table (remove every `'melee:roundSynced'` key):

| Consumer | matchResultsSynced | pairingsSynced | roundStandingsSynced |
| --- | --- | --- | --- |
| Pairings | own Round | own Round | — |
| Top Cut Bracket | holds Round | holds Round | `shows.seeds()` |
| Player History | ✓ | ✓ | — |
| Head-to-Head | ✓ | ✓ | ✓ |
| Standings | — | — | ✓ |
| Metagame (+ Archetype Spotlight, Most Played Cards via shared deps) | — | — | ✓ |

Operator handlers: `matchResultsSynced` → `useMatchStore().applyRemoteMatchesRefreshed({ eventId, roundId })`; `pairingsSynced` → rounds + matches + feature matches (today's `roundSynced` body); `roundStandingsSynced` → `useRoundStore().loadRoundsByEventId`; no `roundSynced` handler.

- [ ] **Step 1: Failing tests:** in each screen test, replace `roundSynced` deliveries with an `it.each` over the three messages asserting re-read vs no re-read per the table; add `deliver('melee:roundSynced', …)` → no re-read. Standings: `matchResultsSynced` → no re-read.
- [ ] **Step 2:** Run `pnpm test:nuxt --run test/nuxt/composables/screen`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm verify:quick`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(screens): Pairings and Top Cut Bracket fill in Match Results as they sync`.

---

### Task 6: Live Results setting and status

**Files:**
- Modify: `server/db/schema.ts:91-104`; generate `server/db/migrations/sqlite/0007_melee_live_results.sql` via `pnpm db:generate`
- Modify: `server/mappers/event.ts` (strip internal columns)
- Modify: `server/modules/melee-sync/configuration.ts` (disabling sync clears Live Results)
- Modify: `server/utils/meleeSyncState.ts` (`MeleeSyncCommandName` gains `'live-results'`; operator wait)
- Create: `server/api/events/[id]/melee/live-results.put.ts`
- Create: `server/modules/melee-sync/liveResultsSetting.ts`
- Test: `test/unit/server/api/events/[id]/melee/live-results.sqlite.test.ts` (new), `test/unit/server/utils/meleeSyncState.test.ts`, `test/unit/server/api/events/[id]/melee-config.put.test.ts`

**Interfaces:**
- Columns (Drizzle name / SQL): `meleeLiveResultsEnabled` bool not null default false; `meleeLiveResultsNextCheckAt` ts; `meleeLiveResultsBackoffStep` int not null default 0; `meleeLiveResultsLastCheckedAt` ts; `meleeLiveResultsLastChangeAt` ts; `meleeLiveResultsError` text; `meleeLiveResultsStopReason` text enum `'idle' | 'auth'`.
- Event response exposes Enabled, LastCheckedAt, LastChangeAt, Error, StopReason; strips NextCheckAt, BackoffStep.
- `PUT /api/events/:id/melee/live-results` body `{ enabled: boolean }`: 400 `MELEE_SYNC_DISABLED` when Melee Sync is off; on enable sets error/stopReason null, backoff 0, nextCheckAt null, lastChangeAt now; publishes `event:updated`.
- `acquireMeleeSyncLease(eventId, command, options)`: when the active lease's command is `'live-results'` and the caller is not, retry every 500 ms up to `OPERATOR_LEASE_WAIT_MS = 10_000` before the 409.

- [ ] **Step 1: Failing tests:** enable with sync off → 400; enable → row state reset + `event:updated`; disable → enabled false, data untouched; turning Melee Sync off via config → `meleeLiveResultsEnabled` false; event GET response has no NextCheckAt/BackoffStep; lease: `live-results` lease released after 1 s → operator `acquireMeleeSyncLease(…,'update')` succeeds (fake clock); `live-results` held past 10 s → 409; another operator command held → immediate 409 (unchanged).
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; `pnpm db:generate`, rename the file to `0007_melee_live_results.sql` and its journal entry.
- [ ] **Step 4:** Run `pnpm verify:quick`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(melee-sync): a Live Results setting beside Melee Sync`.

---

### Task 7: Current Round and cadence rules

**Files:**
- Create: `server/modules/melee-sync/liveResults/currentRound.ts`, `liveResults/schedule.ts`
- Test: `test/unit/server/modules/meleeLiveResultsRules.test.ts` (new)

**Interfaces:**
- `type LiveResultsTarget = { kind: 'results'; round: DbRound } | { kind: 'probe'; round: DbRound } | { kind: 'idle' }`
- `resolveCurrentRound(orderedRounds: DbRound[], stats: Map<number, { matchCount: number; complete: boolean }>): { current: DbRound | null; target: LiveResultsTarget }` — rounds pre-filtered to Melee-managed and in Round order. Current = last Round with `matchCount > 0`. Target: current incomplete → results; current complete (or none) → probe next (or first); no next → idle. `idle` schedules on the probe curve.
- `loadCurrentRound(eventId): Promise<ReturnType<typeof resolveCurrentRound>>` — reads Rounds + Match stats (uses `isRoundComplete`).
- Constants: `LIVE_RESULTS_INTERVAL_MS = 60_000`, `LIVE_RESULTS_QUIET_AFTER_MS = 1_800_000`, `LIVE_RESULTS_QUIET_INTERVAL_MS = 300_000`, `LIVE_RESULTS_BACKOFF_BASE_MS = 60_000`, `LIVE_RESULTS_BACKOFF_CAP_MS = 900_000`, `LIVE_RESULTS_IDLE_STOP_MS = 43_200_000`.
- `nextLiveResultsSchedule(input: { now: Date; target: LiveResultsTarget['kind']; outcome: 'changed' | 'unchanged' | 'failed' | 'auth-failed'; backoffStep: number; lastChangeAt: Date }): { nextCheckAt: Date; backoffStep: number; lastChangeAt: Date; stop: 'idle' | 'auth' | null }`

- [ ] **Step 1: Failing tests**, `it.each` tables. `resolveCurrentRound`: no pairings → probe Round 1; R3 incomplete → results R3; R3 complete, R4 exists → probe R4; last Swiss complete, Top Cut R1 exists in next Phase → probe it; last Round complete, nothing next → idle. `nextLiveResultsSchedule`: results changed → +60 s, step 0, lastChange=now; results unchanged 10 min quiet → +60 s; 31 min quiet → +5 min; probe unchanged steps 0..5 → +1,2,4,8,15,15 min; failed → same curve; auth-failed → stop 'auth'; unchanged with lastChange 12 h + 1 ms ago → stop 'idle'; idle unchanged → probe curve.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm vitest run test/unit/server/modules/meleeLiveResultsRules.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(melee-sync): Current Round and Live Results cadence rules`.

---

### Task 8: The Live Results tick, runner and cron

**Files:**
- Create: `server/modules/melee-sync/liveResults/tick.ts`, `liveResults/runner.ts`
- Create: `server/utils/cronSchedules.ts`
- Create: `server/api/events/[id]/melee/live-results.get.ts`
- Create: `server/plugins/melee-live-results-schedule.ts`
- Modify: `server/plugins/graphics-retention-schedule.ts`, `graphics-reconciliation-schedule.ts` (gate on `GRAPHICS_CRON`)
- Modify: `wrangler.jsonc:43-45` (`"crons": ["17 * * * *", "* * * * *"]`)
- Modify: `DECISIONS.md` (append ADR-0049), `CONTEXT.md` (Current Round, Live Results; Melee Sync mentions polling; Round complete rule), `README.md` operations
- Test: `test/unit/server/modules/meleeLiveResults.sqlite.test.ts` (new), `test/unit/server/utils/cronSchedules.test.ts` (new)

**Interfaces:**
- `cronSchedules.ts`: `GRAPHICS_CRON = '17 * * * *'`, `LIVE_RESULTS_CRON = '* * * * *'`.
- `runLiveResultsTick(eventId: number, now: Date): Promise<{ outcome: 'skipped' | 'changed' | 'unchanged' | 'failed' | 'stopped' }>`
- `GET /api/events/:id/melee/live-results` → `{ enabled, currentRound: { id, name, phaseName } | null, lastCheckedAt, lastChangeAt, error, stopReason }`, `currentRound` from `loadCurrentRound`.
- `runDueLiveResultsTicks(now: Date): Promise<void>` — Events with Melee Sync and Live Results on and `nextCheckAt` null or ≤ now, ordered by `nextCheckAt`, at most `LIVE_RESULTS_MAX_EVENTS_PER_RUN = 25`, sequential, each in its own try/catch.

Tick steps:
1. `acquireMeleeSyncLease(eventId, 'live-results', { durationMs: 120_000 })`; 409 → `skipped`. Always release in `finally`.
2. Re-read the Event under the lease; Melee Sync or Live Results off → `skipped`.
3. `loadCurrentRound`. `results` → `workflows.syncRoundMatches(ctx = {}, …)`. `probe` → `fetchMatchesByRound`; 404/empty → `unchanged`; paired → `workflows.syncPlayers` then `syncRoundMatches`. `idle` → `unchanged`.
4. `changed` when `published.length > 0`.
5. `nextLiveResultsSchedule` → write poll columns + `meleeLiveResultsLastCheckedAt = now`. Error text from `toPublicOperationalError` into `meleeLiveResultsError`; cleared on success. Stop → `meleeLiveResultsEnabled = false`, stop reason set.
6. Publish `event:updated` only when error presence or stop state changed.
7. `MeleeTransportError` with `upstreamStatus` 401/403 → `auth-failed`.

The plugin hooks `cloudflare:scheduled`, returns unless `controller.cron === LIVE_RESULTS_CRON`, calls `runDueLiveResultsTicks(new Date())`, logs failures like the graphics plugins. Verify `db` and Ably resolve in the scheduled context; if `globalThis.__env__` is unset there, set it from `env` at the top of the hook.

- [ ] **Step 1: Failing tests** in `meleeLiveResults.sqlite.test.ts` (Melee, Ably, clock faked): in-progress Round, new result → Match updated, `matchResultsSynced` published, no `event:updated`; quiet tick → no publish, `lastCheckedAt` written, `nextCheckAt` +60 s; complete Round, next paired → Players refreshed, pairings stored, previous Round standings stored; probe 404 → backoff step +1; Melee 500 → error stored + `event:updated` once, next failure no second `event:updated`, success clears it; 401 → enabled false, stopReason 'auth'; lease held by operator → `skipped`, nothing written; runner: three due Events where the second throws → first and third ticked; Event not due → untouched; GET status returns the Current Round's name and the stored error.
- [ ] **Step 2: Failing test** `cronSchedules.test.ts`: parse `wrangler.jsonc` (strip comments) and assert `triggers.crons` equals `[GRAPHICS_CRON, LIVE_RESULTS_CRON]`; invoke each graphics plugin hook with `LIVE_RESULTS_CRON` → its library is not called.
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement code, then the docs: ADR-0049 records polling, the lease as what keeps a tick from writing after sync is turned off (configuration takes the same lease), Current Round, completion rule, standings-only-when-complete, message split + one-release `roundSynced`, cron as scheduler, operator lease wait.
- [ ] **Step 5:** Run `pnpm verify` (includes Worker build and workerd smoke). Expected: PASS.
- [ ] **Step 6:** Run `pnpm test:integration --run`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(melee-sync): Live Results polls the Current Round every minute`.

---

### Task 9: Sync page Live Results panel

**Files:**
- Modify: `app/pages/event/[eventId]/sync.vue` (new `UCard` after "Update from Melee", ~line 482)
- Modify: `app/stores/melee.ts` (`setLiveResults(enabled)`, `loadLiveResultsStatus()`)
- Create: `app/components/Sync/LiveResultsCard.vue`
- Test: `test/nuxt/components/Sync/LiveResultsCard.test.ts` (new)

**Interfaces:**
- Consumes: Task 6 routes and Event response fields.
- Card shown only when Melee Sync is enabled and setup is complete. `USwitch` labelled "Live Results". While on: Current Round name, "Checked <relative time>", Live Results error as `UAlert`. When `stopReason` set: "Live Results stopped: no changes for 12 hours" (`idle`) / "Live Results stopped: Melee.gg rejected the credentials" (`auth`). Status re-read every 30 s while mounted and on.
- Expose state as `data-live-results="on|off|stopped"`.

- [ ] **Step 1: Failing tests** `it.each`: off → switch unchecked, `data-live-results="off"`; toggling sends `PUT {enabled:true}` and shows the switch on while pending (`test/helpers/deferred.ts`); on with status → Current Round name and error visible; stopReason `auth` → stop copy, `data-live-results="stopped"`.
- [ ] **Step 2:** Run `pnpm test:nuxt --run test/nuxt/components/Sync`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `pnpm verify:quick`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sync): Live Results switch and status on the Sync page`.

---

### Task 10: Remove the legacy message (follow-up release)

Not in this PR. Open an issue after the release ships: "Stop publishing `melee:roundSynced`", body pointing at ADR-0049. Command:

```bash
gh issue create --title "chore(melee-sync): stop publishing melee:roundSynced" --body "One release after Live Results (ADR-0049). Remove the type, publication function and the publish in workflows.syncRoundMatches." --label ready-for-agent
```
