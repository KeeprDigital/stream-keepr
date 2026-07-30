# Feature Match Overlay capability parity

The mapping from each legacy Feature Match Overlay construct to its Shared Graphics Foundation equivalent. It was settled on [issue #14](https://github.com/KeeprDigital/stream-keepr/issues/14) and lived only as a comment there; this file is the versioned copy the work that depends on it can cite.

Two issues consume it. [#78](https://github.com/KeeprDigital/stream-keepr/issues/78) is the rewrite this mapping governs — moving Feature Match Overlay onto the shared compositor — and [#79](https://github.com/KeeprDigital/stream-keepr/issues/79) verifies the result against this table item by item. Anything a legacy layout can express has to land in one of the right-hand column's constructs, or the rewrite has lost capability.

Per-side borders are deliberately dropped rather than carried forward. A Graphic Surface Style has one uniform outline, and an independently styled or animated edge is a Shape Graphic Item created from the rule preset. That is a capability decision, not an omission.

## The mapping

| Legacy construct                                                                   | Shared foundation equivalent                                                                    |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `widget` text with `{token}` template + per-token styles                           | Text Graphic Item with Graphic Text Template, host token binding catalogue, per-segment styling |
| `widget` image                                                                     | Media Graphic Item + Graphics Asset Library reference                                           |
| clock / player-life / game-wins widgets                                            | Shared context-gated Graphic Item Definitions                                                   |
| `widget-group` (row/column/canvas, gap, align, fixed/fill sizing, child overrides) | Graphic Group (carried forward per the settled vocabulary)                                      |
| Numeric `zIndex`                                                                   | Ordered back-to-front sibling lists                                                             |
| Per-side border flags                                                              | **Dropped from Surface Style** — compose with a thin Shape Graphic Item ("rule" preset)         |
| Per-corner radii                                                                   | Shape Geometry per-corner treatment                                                             |
| Box style (fill, gradient, opacity, glow, typography)                              | Graphic Surface Style + Text Graphic Item typography                                            |
| Text overflow clip/ellipsis/shrink/visible                                         | Text Overflow Policy                                                                            |
| Frame, cutouts, source roles                                                       | Feature Match Overlay host layer (unchanged, host-specific)                                     |
| Built-in presets replacing whole layout                                            | Recreated as built-in Feature Match Layouts on the shared schema                                |

## What the shared vocabulary already satisfies

Rows the Shared Graphics Foundation can already express, and where they landed:

- **`widget-group`** — Graphic Group with row, column, and canvas arrangement, gap, padding, alignment, justification, fixed and weighted-fill main-axis sizing, optional clipping, and a local style default each direct child overrides with its own. Groups do not nest, and a group forms one layer among its siblings. (#65)
- **Numeric `zIndex`** — Graphic Layer Order: the back-to-front list order of a Broadcast Graphic's items and of a Graphic Group's children. Nothing authors a z-index. (#63, #65)
- **Per-side border flags** — the replacement exists: Shape Geometry's `rule` preset initialises a thin bed that carries its own Graphic Surface Style. (#65)
- **Per-corner radii** — Shape Geometry configures each corner independently as square, rounded, or cut, and adds bounded left and right edge slants the legacy box style never had. (#65)
- **Box style** — Graphic Surface Style on Text Graphic Items, Shape Graphic Items, and Graphic Groups: a Graphic Fill that is a solid colour or a two-to-four-stop linear gradient, fill opacity, a uniform outline, and glow. Typography stays with the Text Graphic Item. (#65)
- **Text overflow** — Text Overflow Policy: clip, ellipsis, or shrink to an author-set minimum and then ellipsis. The legacy `visible` option is deliberately dropped: text never renders with visible overflow beyond its authored bounds. (#63)

Rows still outstanding, with the work that closes them:

- **`widget` text with `{token}` template and per-token styles** — the Text Graphic Item and its Text Overflow Policy exist, but Graphic Text Templates, the host binding catalogue, and Graphic Placeholder Styles arrive with typed Graphic Inputs (#67).
- **`widget` image** — Media Graphic Items and Graphic Asset References (#66).
- **clock / player-life / game-wins widgets** — context-gated Graphic Item Definitions. The Host Contract already gates a Definition on the context a host declares; the three Definitions themselves are not written.
- **Frame, cutouts, source roles** — host-specific and unchanged by design, so this row closes when Feature Match Overlay adopts the compositor (#78).
- **Built-in presets** — recreated as built-in Feature Match Layouts on the shared schema (#78), which depends on templates and Graphic Style Sets (#73–#76).
