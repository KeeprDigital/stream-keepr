# Broadcast Graphics fidelity prototype

> Throwaway prototype for [Validate the constrained editor against existing graphics](https://github.com/KeeprDigital/stream-keepr/issues/8). This is acceptance evidence, not an implementation plan or production code.

## Question

Can a constrained compositor based on the existing Feature Match Overlay capabilities reproduce the representative acceptance set closely enough, without becoming a general design tool?

## How to run

```sh
pnpm dev
```

Open `/prototype/broadcast-graphics-fidelity`. Use the floating arrows or `?variant=split`, `?variant=strip`, `?variant=slate`, and `?variant=bug` to switch reconstructions. Press `R` to replay the current recipe.

## Reconstruction inventory

| Reference | Bounded Graphic Items | Recipe-shaped motion |
| --- | --- | --- |
| Split angular commentator lower-third | Two shape beds, two accent rules, two text items | Paired outside-edge slides; rule wipes; delayed name fades/rises; reversed exit |
| Full-width animated commentator lower-third | One clipped animated-media bed, foreground rules/decorations, two text items, central brand item | Bed and rules reveal; brand scales; names slide; staged reverse exit |
| Full-screen branded slate | Three image items and one text item | Central scale/fade; delayed partner marks; delayed message; coordinated exit |
| Derived persistent brand bug | One shape bed, one brand image, optional text | Short slide/fade on take; indefinite hold; explicit take-out |

The original source fonts and media were not available to this prototype. Placeholders deliberately preserve layout hierarchy, geometry, motion character, and editable boundaries instead of pretending to prove pixel identity.

## Capability verdict

The existing Feature Match Overlay is a viable foundation, but its capability set cannot reproduce the acceptance set as-is. Static placement and styling are already close enough. A small bounded extension covers the missing fidelity without introducing a general design tool.

### Existing base that carries forward

- Canvas-relative geometry, anchors, visibility, and explicit Graphic Layer Order.
- Positioned text and image items.
- Text styling, solid and gradient surfaces, opacity, borders, per-corner radius, glow, and overflow control.
- Canvas groups with row, column, or free placement and clipping.
- Full-frame image/video media and decorative animation effects.
- Overlay, Fill Output, and Key Output rendering precedent.

### Fidelity-critical gaps

1. **Graphic Animation lifecycle** — a Broadcast Graphic and its Graphic Items need explicit enter, on-screen, and exit phases. The current decorative Frame animation and value-change animations do not provide playout lifecycle motion.
2. **Bounded motion recipes and choreography** — provide fade, slide, scale, and wipe/reveal recipes with duration, delay, easing, and direction. Allow ordered or offset item participation within enter and exit phases. The prototype requires no authored keyframes.
3. **Item-scoped animated media** — an image or looping video must be usable as a Graphic Item or surface fill with fit, opacity, playback rate, and looping controls. Media must clip to its item's bounds instead of only filling the whole Frame.
4. **Bounded shape geometry** — add rectangle, line/rule, and a small family of corner-cut or slanted-edge presets. The split lower-third cannot retain its visual identity with rounded rectangles alone.
5. **Independent Broadcast Graphic playout** — the persistent bug must enter once, hold without a timer, and leave only on operator action, independently from other on-air Broadcast Graphics.

### Useful bounded extensions, but not new design-system primitives

- Reuse one recipe across a Graphic group so coordinated items share motion parameters.
- Let a template expose palette, font, media, geometry, and recipe parameters as author-editable settings.
- Permit static decorative media or ordinary Graphic Items to create diagonal/grid texture; no procedural effect authoring is required.

### General-design features the acceptance set does not justify

- Arbitrary path or Bézier drawing.
- A keyframe timeline or graph editor.
- Scripting, general expressions, or executable plugins.
- Arbitrary nested masks, blend graphs, or unrestricted filters.
- General-purpose video editing, audio, or non-real-time rendering.
- A taxonomy of hard-coded lower-third, slate, or bug component types.

## Decision boundary for review

Approve the prototype if the reconstructions preserve the references' identity and motion character closely enough that the five fidelity-critical gaps describe the minimum missing vocabulary. Reject or revise it if a visible characteristic requires another bounded Graphic Item, style, clipping, or animation primitive.
