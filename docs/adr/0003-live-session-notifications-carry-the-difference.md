# ADR-0003: A Broadcast Graphics Live Session notification carries the difference, not the state and not only a name

- **Status**: Accepted
- **Date**: 2026-08-02
- **Issue**: [#168](https://github.com/KeeprDigital/stream-keepr/issues/168)
- **Depends on**: [#95](https://github.com/KeeprDigital/stream-keepr/issues/95) (which fixed the Screen publication path and added the oversize diagnostic and `MAX_REALTIME_MESSAGE_BYTES`)

## Context

`broadcastGraphicsLiveSession:commandApplied` published the whole `BroadcastGraphicsLiveState` on every accepted command. Live state carries five Graphic Input value maps per placed Broadcast Graphic, so at the sizes the authoring caps admit that message measured **457,780 bytes** — seven times the documented realtime per-message floor of 64 KiB — and it failed silently, because publication logs and swallows. The write landed; only the notification stopped, on the largest shows and nowhere else.

`screen:updated` had exactly this defect and #95 fixed it the obvious way: carry `{ screenId }`, let every client reload the authoritative Screen. That is spec [#60](https://github.com/KeeprDigital/stream-keepr/issues/60)'s settled rule — realtime is notification, snapshots are authority — applied literally, and #168 was filed expecting the same treatment.

It is not the same case. A Screen changes when an author saves. Live state changes on **every accepted command**: every Set Input an operator commits, every Take, every Update Graphic. Notification-plus-reload therefore costs a snapshot round trip per command, per client, on the path an operator uses to put graphics on air.

## Decision

**The notification carries what the command changed** — the entries of `playout`, `inputs`, and `sources` that differ, keyed by Broadcast Graphic id, with `null` for a removal — measured against the live state the command was reduced onto. `BroadcastGraphicsLiveStateChange` is that description; `changedBroadcastGraphicsLiveState` applies it.

**When the difference does not fit, it is dropped and the peer reloads.** A payload over `MAX_REALTIME_MESSAGE_BYTES` is published without its change, and a client given no change does what it already does for a sequence gap: fetch the authoritative snapshot. So is a client given a notification the publisher could not describe — a recognised command replay, answered with a snapshot that may be newer than the command being replayed, and a live state carrying a field this build does not recognise.

That fallback is what makes the message bounded **by construction** rather than by argument: the part that scales with the show is the part that can be left out.

## Why not notification-only

Two costs, and the second is the decisive one.

A reload per command is a snapshot fetch per client per command. Every Live Control and every Screen Output watching that Screen fetches at once, on a message that fires several times a second while an operator prepares a lower third.

More seriously, it is not merely late. Every output projects a Graphic Animation phase from **one authoritative effective start time**, and the projection is monotone in the current instant. An output that spends a round trip fetching does not delay the entrance — it joins it already part-played. A 500 ms enter fetched in 80 ms starts 16% in; a 200 ms one starts 40% in. Making the on-air path pay that on every Take is the opposite of what this feature is for.

## Why not a whole Broadcast Graphic per change

The first shape named whole Broadcast Graphics: "this graphic changed, here is its live state". It is simpler, and it is wrong in the one place that matters. A Take and an Out change a playout record of a few hundred bytes; pairing that with the graphic's Graphic Input state put a show's worth of accepted text behind every on-air action, and at the worst case an Out fell back to a reload. Measured: naming entries keeps an Out at **280 bytes at the largest live session that exists**, where naming graphics dropped it entirely.

## Why not finer than an entry

Naming individual values inside a Graphic Input state would buy one further case — an edit to a Broadcast Graphic holding more than eleven Graphic Inputs with every value map full at maximal length — and would cost a second description, with its own removal rules, over a shape the reducer is explicitly free to grow. Map entries are the granularity live state is keyed at, so no reducer can drift away from it and no reader needs to know what is inside an entry.

## The measured cost

All figures are pinned in `test/unit/server/broadcastGraphicsCommandApplied.test.ts`, against a worst case driven through the real reducer rather than written down.

|                                                                    | before    | after       |
| ------------------------------------------------------------------ | --------- | ----------- |
| worst case the caps admit, whole live state                        | 457,780 B | —           |
| worst case after the `MAX_GRAPHIC_INPUT_VALUE_LENGTH` trim         | 361,780 B | —           |
| Out at the worst case                                              | 361,780 B | **280 B**   |
| realistic show (6 graphics, 8 inputs, 60-char values), whole state | 7,906 B   | —           |
| Set Input on that show                                             | 7,906 B   | **1,355 B** |
| Out on that show                                                   | 7,906 B   | **189 B**   |

**The round trip introduced is zero on any show anyone runs.** It is paid only when a notification carries no change, and where that boundary sits is measured: a Broadcast Graphic with eleven Graphic Inputs, every one of their five value maps full at maximal length, still carries its change (62,260 B); the twelfth falls back. That is 65 KB of text on a single graphic — and the snapshot such a client then fetches is larger again, so the reload is the cheaper of the two things that could happen, and the alternative is the message not arriving at all.

`MAX_GRAPHIC_INPUT_VALUE_LENGTH` moves 2,000 → 1,200 with it, as #95's thread suggested. Its stated purpose is only to exceed the 1,000-byte authored cap so an over-long value is storable and therefore showable as unavailable; the extra margin bought nothing and was paid twice per Graphic Input in every durable live state. It removes 96,000 bytes from the worst case.

## Consequences

- `MAX_REALTIME_MESSAGE_BYTES` is still the documented **floor** (64 KiB on Free and Standard), not this account's confirmed ceiling — nothing in the repository records the plan, and #95 said the same. Measuring against the floor can only cost a reload that was not needed; measuring against a ceiling nobody established would cost a notification that never arrives.
- `realtime_publish_oversized` can no longer fire for this message type: the payload is measured against the same limit before publication, and shrinks below it.
- The shared sequenced live-state port's `publish` now receives a publication context carrying the aggregate the command was reduced onto, absent on a recognised replay. Only that module knows which aggregate a merge retry re-reduced onto, and a difference measured against the wrong one would leave every peer holding a state the store does not have — silently, since nothing downstream re-checks it.
- A client now has two ways to fall behind rather than one — a sequence it did not see, and a notification with no difference to apply. Both resolve by reloading, which is the path that was already built and tested.
