# ADR-0003: `static-font-v1`'s server-side checks are a floor; the browser is the gate

- **Status**: Accepted
- **Date**: 2026-08-02
- **Issue**: [#153](https://github.com/KeeprDigital/stream-keepr/issues/153)
- **Related**: [#28](https://github.com/KeeprDigital/stream-keepr/issues/28) ("reject any font that would silently fall back"), [#38](https://github.com/KeeprDigital/stream-keepr/issues/38) (the validation-runtime pattern), [#39](https://github.com/KeeprDigital/stream-keepr/issues/39), [#50](https://github.com/KeeprDigital/stream-keepr/issues/50)

## Context

`public/fonts/mplantin.ttf` passed every server-side check `static-font-v1` runs — signature, declaration agreement, SFNT directory bounds and per-table checksums, required tables, no variable/bitmap/colour/SVG tables, a non-empty Unicode coverage, inspectable names and metrics, renderable representative outlines — and `test/unit/server/modules/graphicsFont.test.ts` used it as _the_ valid TTF fixture.

Chromium refuses it outright. Driving the face through the acceptance harness gives, from the browser's own log:

```
Failed to decode downloaded font: …/face
OTS parsing error: bad table directory rangeShift
cmap: language id should be zero: 1
cmap: Languages should be 0 (1)
cmap: Failed to parse table
```

and, to script, `FontFace.load()` rejecting with `SyntaxError: Invalid font data in ArrayBuffer`.

Both of the file's cmap subtables — `(1, 0)` format 0 and `(3, 1)` format 4 — declare `language` 1. A font sanitiser treats that as a hard failure of the whole cmap and therefore of the font. (`rangeShift` is wrong too, but a sanitiser corrects that and warns.) Nothing in the profile looked inside a cmap subtable, and `fontkitten` reads the coverage out of one regardless, so the defect was invisible to every check above.

The browser acceptance gate in #50 found this and worked around it by pointing its TTF fixture at `/fonts/mana.ttf`. The discrepancy itself was left open as #153.

## Decision

Two things, and the second is the load-bearing one.

**1. The specific check is added.** `static-font-v1` now rejects any cmap subtable declaring a non-zero language, with the stable code `font-cmap-language-invalid`. It reads the _parsed_ cmap rather than the source bytes, so it holds for TTF, OTF, WOFF, and WOFF2 alike — a WOFF2's cmap lives inside a Brotli stream nothing in the validator decodes.

**2. The server-side checks are a floor, not the gate.** `static-font-v1` acceptance continues to require real browser evidence — `FontFace.load()` plus representative glyph rendering against server-selected code points, bound to the source digest and the challenge digest — and that requirement is what covers this defect class. `reportWithBrowserDecodeEvidence` refuses to publish a font without it.

## Why the browser and not more server-side checks

Because the two are not the same kind of thing, and only one of them is the actual requirement.

A font sanitiser is a large, versioned, adversarially-maintained program whose refusals track browser releases. Reproducing it inside the validator would mean maintaining a second implementation of somebody else's moving contract and being wrong about it silently — the failure mode being closed here, one rule further along. The requirement the profile actually states is not "these bytes have a well-formed cmap"; it is "this face loads and renders in the browser that will show it on air". Only a browser answers that.

This is the same shape as the silent-video decision recorded in #38 and `docs/operations/silent-video-validation-runtime.md`: where the real proof needs a runtime the validator is not, the validator's job is to bound and describe the bytes, and a named runtime's evidence is what publication turns on.

So why add `font-cmap-language-invalid` at all, if the browser gate already refuses these bytes? Because the two gates fail at different times and say different things. Without it, the profile reports a font _accepted_ and hands the author a glyph challenge their browser then cannot answer — a late, confusing failure phrased as a rendering problem. With it, the bytes are refused where they are inspected, with a code naming what is wrong. Each future rule of this kind earns its place the same way: a real observed defect, a cheap deterministic check, and a stable code. None of them widens the claim.

## Consequences

- `public/fonts/mplantin.ttf` is no longer a valid fixture anywhere. Every unit fixture that treated it as an accepted TTF now uses `public/fonts/mana.ttf`, which the browser harness proves loads and renders; one new test pins that MPlantin's TTF is refused with `font-cmap-language-invalid`.
- The file stays in the repository as exactly that negative fixture, and is removed from the `MPlantin` `@font-face` in `app/assets/css/main.css`. It was listed there as a `truetype` fallback behind the WOFF, so no browser ever reached it — but as a fallback it could only ever have produced the silent substitution #28 forbids. MPlantin renders from `mplantin.woff` today, before and after this change.
- The static-font browser acceptance harness now proves both directions. `refusedFaces` in `public/_acceptance/static-font-v1.json` lists faces the profile rejects, and the run fails with `font-refused-face-loaded` if the browser loads one. A unit test can only show that a server-side check fires on the bytes it was written for; whether those bytes are genuinely unloadable is a fact about the browser.
- The bundled `mplantin.eot` and `mplantin.svg` (and `mana.eot`, `mana.svg`) remain unreferenced by anything. Out of scope here and not investigated.
