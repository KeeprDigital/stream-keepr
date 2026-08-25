# ADR-0015: Live overlay show/hide rides feature-match session state, not graphics config

- **Status**: Accepted
- **Date**: 2026-08-24
- **Issue**: [#486](https://github.com/KeeprDigital/stream-keepr/issues/486) (recording it here), decided under spec [#485](https://github.com/KeeprDigital/stream-keepr/issues/485) / decisions [#479](https://github.com/KeeprDigital/stream-keepr/issues/479), [#480](https://github.com/KeeprDigital/stream-keepr/issues/480), [#481](https://github.com/KeeprDigital/stream-keepr/issues/481)
- **Related**: `docs/feature-match-overlay-capability-parity.md` (the Deck List Graphic Item row, which is where the two hosts first diverge in behaviour)

## Context

An operator revealing or hiding a player's sideboard on the Feature Match Overlay
between games needs a sub-second, control-surface-driven toggle. The graphics
config path could express it today (write the item's `visible`), but it is
compositor-only UI, ~600 ms of stacked debounce plus announce-then-refetch, and
it would make an operator gesture out of an authoring field. We decided the
toggle is **live match data**: a per-player `sideboardRevealed` boolean in
`FeatureMatchState`, set by a `SetSideboardRevealed` session command, read by the
deck-list Graphic Item through `GraphicsFeatureMatchContext` exactly as
`player-life` reads life totals.

This preserves the Graphic Item invariant ("items are not taken on or off air
independently of their containing composition"): the item stays on air and a
hidden sideboard is a data-driven renders-nothing state, the same idiom as an
absent life total or an empty sideboard. It also respects the Feature Match
Overlay's Host Contract, which deliberately declares no Graphic Inputs — so the
Broadcast Graphics Live Control system was rejected as the carrier, along with
any new bespoke live-control channel.

## Consequences

- The compositor-authored `visible` field ANDs with the live flag; the flag
  cannot resurrect an item its author hid.
- Show/hide motion reuses the item's ordinary authored `enter`/`exit`
  Graphic Animation Recipes; the live flag edge is a new (small, reusable)
  per-item phase trigger in the overlay host — the one genuinely new mechanism.
- A host without the Feature Match context (Broadcast Graphics) treats the item
  as revealed; visibility there stays an authoring concern.
