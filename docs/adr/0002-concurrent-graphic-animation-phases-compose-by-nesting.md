# ADR-0002: Concurrent Graphic Animation phases compose by nesting

- **Status**: Accepted
- **Date**: 2026-08-01
- **Issue**: [#110](https://github.com/KeeprDigital/stream-keepr/issues/110)
- **Builds on**: [#70](https://github.com/KeeprDigital/stream-keepr/issues/70) (interruption reversal for the enter/exit pair)

## Context

`CONTEXT.md` requires that "Exit interrupts an active enter, update, or on-screen Graphic Animation Recipe and continues smoothly from the currently rendered state". #70 delivered that for the enter/exit pair, where reversal plays the interrupted recipe backwards from where it had reached. Two cases it could not deliver:

- **Exit interrupting an update.** An update cross-transitions a _pair_ of renderings. The glossary discards the _pending_ visual update, which leaves the transition already travelling free to finish underneath the exit — but finishing it means an update phase and an exit phase are in play for one Broadcast Graphic at the same instant.
- **Exit interrupting on-screen cycling.** A cycling excursion is somewhere between the Graphic Resting State and its authored extreme when exit arrives.

Neither is a position on the enter/exit axis, so neither can be reversed. Both are a _second_ phase running at the same instant. `broadcastGraphicPhaseProjection` answered `{ phase, elapsed } | null` — exactly one phase — and `GraphicsCompositionRenderModelInput.animation` was keyed one projection per graphic, so the compositor could only ask about one and had to choose. Every choice snapped.

## Decision

**A Broadcast Graphic projects an ordered set of concurrent lifecycle phases, and the compositor composes their projected values rather than selecting one.**

The set is bounded at two and the pairing is structural: at most one _content_ phase — an update crossing its pair, or a cycling excursion — plus at most one _enter/exit_ phase. The order is part of the answer: the content phase is innermost and moves the rendering; the enter/exit phase is outermost and moves the result.

Composition is per channel, and each channel composes the way that channel means:

- **Fades multiply.** `opacity` is one number, and an element at `a` inside a parent at `b` contributes `a * b` — the same arithmetic the glossary already gives whole-graphic and item fades.
- **Slides add.** Both are canvas-space offsets applied outside the authored Graphic Rotation.
- **Scales apply in turn.** Each keeps its own `translate(shift) scale(s)` pair in one transform list, written outermost-first, rather than being folded into a single factor. Two scales about different Graphic Animation Origins are a scale _plus_ a translation, and they degenerate when the factors cancel.
- **Reveals intersect, on separate elements.** CSS allows one mask per element, so a second wipe gets an element of its own — the owner's own box, so the gradient still resolves across the bounds the reveal was authored across.

Two things additionally need an _enclosing_ element rather than a merged style: a second wipe, as above, and any phase that moves _every_ rendering a graphic draws while an update moves them separately. The enclosure appears only when one of those is true, so a Broadcast Graphic in one lifecycle phase resolves to exactly the descriptor it did before concurrency existed.

## Why the Key Output survives it

The alpha matte's rule is that every painted element is pure white at its own alpha, with no `mix-blend-mode` and no filter that is not plain source-over. Composition adds no property beyond the three animation already used: `opacity`, `transform`, and `mask-image`. Nesting opacity multiplies alpha; nesting masks intersects them by multiplying alpha; a transform moves what is painted without changing it. Nothing new paints, so nothing new can be the wrong colour, and the guard in `graphicsRenderModel.test.ts` walks the new elements for the same reason it walks the cross-transition pair.

## What was rejected

- **A reveal as a second `clip-path`.** A Graphic Group already spends its clip on Shape Geometry clipping, and CSS allows one clip path per element, so this would silently replace clipping the vocabulary guarantees.
- **`mask-image` layers with `mask-composite: intersect`.** One element, no nesting — but `mask-composite` is not uniformly available to the browsers these outputs are captured in, and the default composite is a _union_, which fails open by revealing content that should be hidden.
- **Folding two reveals into one gradient.** Two wipes from parallel edges do reduce to one gradient; two from perpendicular edges intersect to a rectangle, which no single `linear-gradient` expresses. A rule that worked for half its inputs is worse than one element more.
- **Applying the enclosing phase to each rendering instead.** An exit fade on each half of a cross-dissolve composites differently from the same fade on the pair, because two half-opaque copies of one graphic are not one half-opaque copy of the pair. The enclosure is the only shape that composites correctly.
- **A second compositor pass, or a per-owner animation state.** Both would end the property that makes late-loading outputs agree: every frame is a pure projection of one authoritative instant, with nothing accumulated between frames.

## The durable field this needed

The update case needed nothing durable — keeping `updateStartedAt` across an Out costs nothing. The on-screen case did need one, and #110 predicted it would not.

Cycling's origin is ordinarily derived: it is the instant the entrance settled, or the instant the last update completed. An Out overwrites the record those are derived from, so an exit can no longer locate the cycle it is running over — and an exit that cannot locate it starts from the Graphic Resting State, which is exactly the snap this ticket exists to remove. `cyclingStartedAt` is therefore stored, and only on an intent that actually interrupted cycling in progress, so the durable record grows for the same reason and on the same terms `reversalCompletesAt` and `updateStartedAt` do.

It keeps the property those two keep. It is an _origin_ rather than a frozen excursion, so it is read forwards and monotone in the reader's instant; cycling neither accumulates nor drifts, so a reader four hours late finds an indefinite recipe somewhere in a cycle and a finite one long since stopped at rest. Nothing validates it, nothing clears it, and it names no phase — so recovery still settles every target graphic at its Graphic Resting State without anything detecting that it had to.

## Consequences

- The projection seam is `broadcastGraphicPhaseProjections`, plural, returning `[]` where it used to return `null`. Every reader — both Screen Output hosts, Live Control, the Program monitor, the Graphic Animation Preview — speaks the set.
- The bound of two is load-bearing rather than incidental: it is what lets the compositor commit to one enclosing element instead of an unbounded nest. It is stated and tested in `broadcastGraphicPhaseProjections`, and a third concurrent phase would need a third element before it needed anything else.
- A Broadcast Graphic leaving with a pending visual update discarded holds the rendering the interrupted update was travelling towards until it leaves, rather than falling back to the accepted set. Snapping to the accepted set as the transition completed would be the discarded update happening after all, without even an animation. The accepted values are not lost: they are what the graphic's next Take enters with.
