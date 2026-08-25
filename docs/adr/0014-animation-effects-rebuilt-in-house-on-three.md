# ADR-0014: Animation Effects are rebuilt in-house on three.js, replacing the vendored Vanta fork

- **Status**: Accepted, except for its background-hosting wording, which [ADR-0016](./0016-one-polymorphic-background-screen-replaces-idle.md) supersedes — this record pencilled the Idle mode in as the second Animation Effect host by adding `animation` to a background type union, and ADR-0016 replaced that mode with a layer stack. The host-agnostic effect contract below is unaffected and stands
- **Date**: 2026-08-23
- **Issue**: [#473](https://github.com/KeeprDigital/stream-keepr/issues/473)

## Context

The animated backgrounds behind the Feature Match Overlay Frame come from a vendored, `@ts-nocheck` Vanta.js fork (`app/utils/animation-effects/`) that needs synthetic mouse drift to move on a headless browser source and shares one flat config bag across all nine effects. We decided to rebuild the effects in-house behind a typed, host-agnostic Animation Effect contract (`create/setParams/resize/render(t)/dispose`) with per-effect configuration, port all nine existing effects onto it under their existing names, and delete the fork as ports land. Rendering stays on three.js rather than a hand-rolled WebGL2 harness because five of the nine effects are mesh-based (waves, rings, dots, net, globe) and three.js is already a dependency; shader-only effects use a fullscreen `ShaderMaterial` base, and a Canvas2D backend remains possible under the same contract.

## Considered Options

- **Extend the Vanta fork** — rejected: untyped, mouse-driven motion model, and a flat config whose param ranges already diverge across three copies (Zod, runtime clamp, editor).
- **Hand-rolled WebGL2 fragment harness** (per the originating spec) — rejected: cannot host the five mesh-based effects that must survive the port, so it would force a second GL stack alongside three.js.
- **Offline export pipeline (WebCodecs → looping video)** — rejected: effects render live in the OBS browser source; there is no replay, so loop-seamlessness and frame determinism machinery buys nothing.

## Consequences

- Effect names stay a closed vocabulary pinned by the Feature Match Layout format version; ports keep their names so Template Packages and stored configs keep resolving. Per-effect config changes what a `frame.animation` capability payload carries — checked when the shape landed (#473): no format-version bump. The effect terms' meanings are unchanged and no payload half-parses under the wrong shape: a new-shape payload fails a pre-rebuild installation's strict schema, a pre-rebuild bag (recognised by its required `mouseDrift*` fields) resets to no animation under the stored-payload schema — the reset accepted below, not a refusal — and a package declaring an unshipped effect is refused at capability preflight on the identity. A bump would also refuse older packages that carry no animation at all; the reasoning is recorded beside `FEATURE_MATCH_LAYOUT_FORMAT_VERSION`.
- Until each port lands, the vocabulary is exactly the effects the in-house system ships (`caustics`, `fog` after the first slice): a current-shape config or a package capability naming a not-yet-ported effect is refused rather than approximated, and a pre-rebuild stored config resets — accepted alongside the settings reset below.
- Existing saved frame-animation settings are reset, not migrated (accepted; small install base).
- Synthetic mouse drift retires with the fork: new effects animate autonomously from elapsed time.
- The Idle background becomes a second Animation Effect host (`animation` joins the background type union), so the renderer component must not assume the Feature Match Overlay. _The union wording is superseded by ADR-0016: the second host is the Background Screen's layer stack, with the Idle mode itself renamed. The host-agnostic renderer rule stands._
