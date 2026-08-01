# ADR-0001: Graphic Style Sets reference application fonts only

- **Status**: Accepted
- **Date**: 2026-08-01
- **Issue**: [#143](https://github.com/KeeprDigital/stream-keepr/issues/143)
- **Depends on**: [#141](https://github.com/KeeprDigital/stream-keepr/issues/141) (which made the alternative reachable at all)

## Context

`CONTEXT.md` said a Graphic Style Set "may reference application fonts or font assets from the Graphics Asset Library", and [#76](https://github.com/KeeprDigital/stream-keepr/issues/76)'s description said a `.skstyle` archive carries "one Graphic Style Set and its required font assets". The code said something narrower: `resolveGraphicStyleSet` validated a typography preset's font against the application registry, so a Style Set could name only a font that ships with Stream Keepr.

That gap was filed as #143 with two ways to close it:

1. Widen the Style Set's font so it can reference a font Graphic Asset Revision, and let `.skstyle` embed those bytes.
2. Narrow `CONTEXT.md` to application fonts only.

Route (1) was blocked on #141, because until then *no* graphics artifact could reference a library font. #141 has now closed that: a Graphic Item's typography and its Graphic Placeholder Styles take a Graphic Font Selection, either arm, in both graphics hosts. So the choice is live rather than blocked, and this decision is the one #143 asked for.

## Decision

**A Graphic Style Set's typography presets reference application fonts only.** The Style Set entry's font is typed `GraphicApplicationFontSelection` and its wire schema accepts only the `application` arm. A Graphic Item's own typography is unrestricted and takes either arm.

`CONTEXT.md`'s Graphic Style Set entry is narrowed to match, and the `undeclared-graphic-asset-dependency` refusal in the `.skstyle` export path stays exactly where #76 put it — not as a placeholder for unbuilt packaging, but as the enforcement of this decision against a document that reached the exporter by some other route.

## Why

The reason is not "route (1) was too much work". It is that a Graphic Style Set and a font asset want incompatible things from a transfer.

A `.skstyle` package is deliberately data-only, with no staging, no quota reservation, and no asset revalidation — `server/modules/graphic-style-set-package/preflight.ts` says so in as many words, and gives the reason: "A Graphic Style Set carries none of that — it is two JSON files bounded by the number of entries a Style Set may hold — so there is nothing to resume and nothing to reserve." Preflight is a pure read of the received bytes, and installation re-runs it over the same bytes.

Embedding font bytes would take all of that back. A packaged Graphic Asset Revision has to be staged durably, charged against the Graphics Staging Allowance, revalidated under the receiver's own Graphic Asset Compatibility Profile, and given a Graphic Asset Origin; a *font* additionally needs browser-load evidence before this installation will accept it. That is the Template Package asset pipeline in full, and reproducing it inside the Style Set module would mean two implementations of one contract — the thing the Graphics Asset Library's "one export contract" was factored to prevent.

Set against that, what route (1) actually buys is small. A Style Set exists to keep a visual language coherent across independently portable templates; the font *asset* that a template needs still travels with that template, in a Template Package that already embeds it. What a Style Set would add is the ability to say "and this font is part of the house style" — real, but not worth making the lightest package kind in the system carry the heaviest machinery.

The narrower type is also honest about a rule the glossary already states: "It may reference only assets available in the same reusable-library scope." A Style Set that named a library font would be publishable on the installation that authored it and unpublishable everywhere it travelled, which is the failure mode #76 built the refusal to make loud.

## Consequences

- A `.skstyle` package still carries zero packaged assets and one `application-font` capability declaration per distinct font. A receiver missing one refuses with `unsupported-application-capability` rather than installing a Style Set it could never publish.
- An author who wants a library font in a Text Graphic Item selects it on the item. It is not inherited from a Style Set entry, and binding that item's typography slot to a Style Set entry replaces the item's font with the entry's application font — the same way binding replaces every other property the entry owns.
- `undeclared-graphic-asset-dependency` remains reachable in the export path. It is now belt and braces rather than the primary guard: the wire schema refuses an asset-arm font on the way in, so a snapshot carrying one is a document that did not come through the write path.
- Reversing this decision means building `.skstyle` asset embedding, which is its own slice of comparable size to #76. Nothing here forecloses it; the type widens to `GraphicFontSelection` and the schema to the full union on the day that envelope exists.
