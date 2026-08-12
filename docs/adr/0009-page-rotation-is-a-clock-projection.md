# ADR-0009: The current page of a Page Rotation is a clock projection, not persisted state

- **Status**: Accepted
- **Date**: 2026-08-12
- **Issue**: [#312](https://github.com/KeeprDigital/stream-keepr/issues/312)

## Context

The paginated Screen Modes (standings, metagame, player history) auto-paged by having every non-interactive rendering run a timer that persisted the next page number to the Screen's mode config. That made every Screen Output a writer, and both observed failure modes were failures of that ownership: a freshly opened output could not persist at all (its client never populates the store's screen collection) and silently stalled, while two simultaneous renderings of one Screen — a fill/key pair, a redundant machine, an operator checking the output URL — each ran their own timer and advanced the page at double rate. Each tick also cost a realtime fan-out plus a full Screen re-fetch by every connected client, the pattern ADR-0004 rejects for the graphics path. And the write itself contradicted the documented invariant that a Screen Output only enters presence and answers commands; two race-safety arguments in the code cite "outputs issue no writes" as their premise.

## Decision

**The current page is a Page Rotation: a pure projection of `(Rotation Anchor, page duration, page count, server time)`**, computed identically by every rendering — Screen Output, Program monitor, operator settings — from one shared function. Nothing writes as the rotation runs; a rendering re-evaluates the projection exactly at each flip boundary.

**Only operator surfaces write the Rotation Anchor**, on exactly three occasions: enabling auto-page, an edit that changes the rotation's shape (page duration, page size), and a manual page selection while the rotation runs — written so the chosen page is current and holds one full duration. The anchor is one field in the mode config blob, riding the existing config write and `screen:updated` announcement.

**A missing anchor projects from epoch zero** — still deterministic and identical across renderings — so configs written before the anchor existed rotate without a data migration.

**An unsynced rendering shows the first page statically**, the broadcast-graphics discipline (never project on an unknown clock) applied to paging. With auto-page off, the persisted `currentPage` remains the manually selected page, exactly as before.

## Why not a single elected writer

The alternative that keeps pages persisted is electing one writer (first output in presence, or the server itself) to run the timer. It preserves the stall/double-advance fix but keeps everything else: leader election and failover when the elected output closes mid-show, the per-tick fan-out and per-client re-fetch traffic, and outputs that write. The projection needs none of it — synchronization across fill/key and redundant outputs falls out of the shared clock (`useServerTime`, RTT-compensated) rather than being coordinated, the same way every output already agrees on Graphic Animation phases. Paging even continues rotating through a realtime outage, since nothing about the projection depends on message delivery.

## Consequences

- Screen Outputs are pure consumers again; the paging persist was the sole output-originated server write in the codebase, and the invariant the code comments rely on is true once more.
- Page flips land within clock-sync tolerance across renderings (tens of milliseconds) — tighter than the fan-out path they replace. Frame-atomic flips across independent browsers were never achievable; this is the bound the clock gives us.
- When the row set changes mid-rotation the projected page can jump, but it jumps identically on every rendering. Nothing re-anchors on data changes — determinism, not continuity, is the invariant.
- The metagame mode's toggle was renamed to the canonical `autoPageEnabled` (migration 0024 rewrites stored blobs, which are strict-validated on later writes).
