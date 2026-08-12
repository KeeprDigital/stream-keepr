# ADR-0007: The Broadcast Graphics Graphic Item cap is set from what a show needs, and the worst case is allowed not to fit

- **Status**: Accepted
- **Date**: 2026-08-01
- **Amended**: 2026-08-11, the decision unchanged. The fidelity prototype document was removed from the repository, so the reconstruction inventory it supplied is carried in _Where 300 comes from_ below rather than cited. Nothing about the cap or its derivation moved; the evidence simply lives here now.
- **Issue**: [#99](https://github.com/KeeprDigital/stream-keepr/issues/99)
- **Depends on**: [#85](https://github.com/KeeprDigital/stream-keepr/issues/85) (the byte total is enforced on the editors' write path) and [#95](https://github.com/KeeprDigital/stream-keepr/issues/95) (realtime no longer publishes mode configurations)

## Context

`MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN` bounds how many Graphic Items one Broadcast Graphics Screen may carry in total, counting Graphic Group children. It exists because the per-graphic and per-Screen caps bound each list independently and their product — 50 Broadcast Graphics × 100 Graphic Items × 50 Graphic Group children — is 255,000 Graphic Items against a 512 KiB `modeConfigs` budget shared by all ten Screen Modes.

It had been repriced three times, by three tickets, each measuring its own vocabulary correctly and each blind to the others: 200 with the item and style vocabulary, 110 when Graphic Inputs arrived, left alone when animation landed because re-deriving it a third time from one vocabulary's arithmetic would have repeated the mistake. The sequence only ever decreased, and nothing said where it stopped.

Issue #99 was filed to make the decision once, from one composed measurement, and forbade any single feature ticket from picking the number.

### What the composed measurement says

The worst case is built from every construct `broadcastGraphicsModeConfigSchema` admits, each populated at its own maximum — all seven members of the Graphic Item union including Graphic Groups and their `sizing`-bearing children, maximal-length ids, Graphic Style Set references in every slot, animation and staggers on items, groups and Broadcast Graphic shells, and every Graphic Input, binding, Graphic Source Selection and Graphic Channel slot filled.

**With one exception, named rather than glossed:** a Graphic Style Set link's `revision` is `int().nonnegative()` with no upper bound, so there is no longest legal value to write and the fixture uses a six-digit one. It is the only field in the worst case whose schema states no maximum, which is itself worth knowing in a byte-budgeted document.

That qualification is deliberate. Reaching this figure took four separate corrections, each found by asking why a number had not moved — animated shells, the whole `styleRefs` block, maximal-length ids, and finally the Graphic Group, absent from a builder whose own comment claimed it spanned everything the schema accepts. An unqualified claim is what made each of those a surprise rather than a known gap, so this one states its exception instead.

Measured against the schema itself, at four cap values:

| Graphic Item cap | worst case (bytes) |
| ---------------- | ------------------ |
| 51               | 865,762            |
| 102              | 1,449,138          |
| 204              | 2,615,890          |
| 300              | 3,713,744          |

That is **11,437 bytes per Graphic Item on 282,564 bytes of fixed cost** — the 50 Broadcast Graphic shells with their inputs, bindings, Graphic Source Selections, channel membership, Graphic Style Set links and container references, none of which any item cap touches.

## Decision

**`MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN = 300`, and the worst case is allowed not to fit the byte budget.**

### Where 300 comes from

`MAX_BROADCAST_GRAPHICS_PER_SCREEN` is 50 — the authored stack a Screen may carry. The fidelity prototype the spec designates as acceptance evidence is no longer in the repository, so its reconstruction inventory is reproduced here rather than cited — this table is the surviving record of it:

| reconstruction                              | Graphic Items                                                 |
| ------------------------------------------- | ------------------------------------------------------------- |
| Split angular commentator lower-third       | 6 (two shape beds, two accent rules, two text items)          |
| Full-width animated commentator lower-third | ~6 (media bed, rules/decorations, two text items, brand item) |
| Full-screen branded slate                   | 4 (three image items, one text item)                          |
| Derived persistent brand bug                | 2–3 (shape bed, brand image, optional text)                   |

Nineteen Graphic Items across the whole set; **six** in the richest one.

**50 × 6 = 300**: every Broadcast Graphic the Screen admits, authored at the richest shape the acceptance document contains. Two inputs, both already owned elsewhere — a cap this schema sets, and a document the spec designates — and one multiplication.

Checked rather than asserted: a realistic Screen filled to this cap measures **248,734 bytes**, 47% of the shared budget, leaving the other nine Screen Modes room on the same Screen. `broadcastGraphicsModeConfig.test.ts` pins that figure exactly.

### Why not lower the cap until the worst case fits

Because it is unreachable at any cap a show needs, and not by a small margin.

The worst case first fits 524,288 bytes at **21** Graphic Items — measured, not extrapolated: 521,272 at 21 and 532,755 at 22. An earlier draft of this decision argued that 21 was below the acceptance set and therefore that the rule's fixed point broke the spec. **That argument was wrong** — the acceptance set is 19 Graphic Items, so 21 clears it — and it is recorded here because it was the sole stated reason for the decision and it did not survive being checked.

The correct objection is about volume, not expressiveness. The fidelity prototype is evidence that a constrained compositor can _reproduce_ four representative graphics; it is not evidence of how many a show runs. A cap of 21 would leave a Screen that may carry 50 Broadcast Graphics unable to give most of them a single item, making `MAX_BROADCAST_GRAPHICS_PER_SCREEN` unreachable, and the spec's problem statement asks for lower thirds for commentators _and_ players, full-screen slates and persistent brand bugs concurrently on one output.

### Why narrowing the remaining axes cannot close it either

Requirement (b) of #99 is to constrain the pathological axes until the worst case fits. Three were narrowed (below). The largest remaining is a maximal Graphic Style Set reference in every slot of every Graphic Item, about 6,100 bytes — more than half of an item's 11,437.

Removing it entirely would still not be enough, and the arithmetic is short. At a cap of 300 the whole budget left for items after the fixed shell cost is 524,288 − 282,564 = 241,724, which is **806 bytes per Graphic Item**. `MAX_GRAPHIC_TEXT_LENGTH` is 1,000, so at this cap a maximal Graphic Text Template alone exceeds the per-item budget before an id, a label, a position or a typography is counted.

At the old cap of 110 the per-item budget is 2,197 bytes against roughly 5,300 for a maximal Text Graphic Item with its Style Set references stripped out — so it does not fit there either, but the text template is not what makes the difference at that cap. Getting under 2,197 would mean cutting Graphic Font Selections and Graphic Placeholder Styles as well, which are three separate spec-level questions rather than one.

So the fixed point is not reachable by narrowing anything short of the vocabulary the spec settles — at this cap, specifically the Graphic Text Template. Saying so with the arithmetic is more useful than narrowing an axis and still overshooting.

### What makes accepting the overshoot sound

- **The byte total is enforced on the editors' write path** (#85). An oversized configuration is refused at authoring time with a legible message rather than written and truncated later. Per-field caps are no longer the only enforcement.
- **Realtime no longer publishes mode configurations** (#95). `screen:updated` names the Screen and clients reload the authority, so a storable configuration is always a notifiable one. That closes the defect that made _reducing_ this cap the only safe direction: a larger cap used to buy storable configuration that could never reach a client.

Issue #99 recorded a second realtime source as part of the same blocker — `broadcastGraphicsLiveSession:commandApplied`, which carries the whole live state on every accepted command and is now filed separately as [#168](https://github.com/KeeprDigital/stream-keepr/issues/168). **That sequencing note is wrong and should not be carried forward.** The live-state payload is keyed by Broadcast Graphic and by declared Graphic Input, never by Graphic Item, so this cap changes it by zero bytes in either direction. #168 is a real defect and it does not gate this decision; the Screen publication half of #95 is the part that did.

The property that is given up is _the named cap binds first_, and only for configurations nobody authors. An author who filled every cap at once — 300 Graphic Items each with a 1,000-character template, four maximal Graphic Placeholder Styles, every animation channel on all four phases and a Graphic Style Set reference in every slot, alongside 60 maximal choice Graphic Inputs — reads a byte count rather than a limit name. Realistic authoring at the cap is under half the budget.

One non-pathological shape moved across the line with the cap, and it is stated rather than left to be discovered: a Screen at the cap where _every_ Graphic Item carries a 1,000-character Graphic Text Template exceeds the total and is refused by byte count. At the old cap of 110 it did not. That shape is 300,000 characters of template on one Screen.

### The three axes that were narrowed

None costs realistic authoring anything, and each was unbounded relative to its own meaning rather than merely large:

1. **A Graphic Animation Stagger** named up to 100 Graphic Item ids regardless of how many items its container held. It now names no more than the container's own direct items. Removes about 2 MB from the worst case, which no item cap could have reached. Stale ids stay legal — the count is bounded, membership is not — and `deleteGraphicItem` already removes a deleted id from its container's staggers, as does the template copy path, so no authoring operation can produce one.
2. **A Graphic Item id** was capped at 100 characters where every id this application writes is a 36-character uuid. It is now `MAX_GRAPHIC_ITEM_ID_LENGTH = 64`, and the same bound applies to the ids a stagger names, which is where most of a stagger's cost sat.
3. **A Feature Match Layout's** Graphic Item cap bounded only its top-level list, so one layout could carry 100 Graphic Groups of 50 children — 5,100 Graphic Items — into this same shared budget, against 110 for a whole Broadcast Graphics Screen. It now carries the same total the other host of the same compositor does.

## Consequences

- The one measurement lives in `broadcastGraphicsModeConfig.test.ts` and is pinned with `toBe`, in two arrangements: Graphic Groups holding children (3,713,744, the worst) and the same budget flat (3,711,076). Both are asserted, so "which worst case" stays a checked choice — a single-shape fixture reported the cheaper one and looked comfortable twice before.
- A ticket that adds to the vocabulary extends that builder and moves a visible constant. If it also wants to move the cap, it re-derives it here rather than in its own docblock.
- **`MAX_GRAPHIC_ITEM_ID_LENGTH` is an import constraint, deliberately.** A Broadcast Graphic Template Package's document is proved against the same schema the Screen write path uses, so a package whose Graphic Item ids exceed 64 characters is refused on install. That is accepted rather than worked around: one bound on both paths is what keeps "a document that installs is a document the write path accepts" true, and every copy path — placing a template, installing a package — mints fresh uuids anyway. #99 flagged that this window closes once Template Packages carry ids authored elsewhere; it is closed knowingly, and the database is wiped before ship, so no stored document predates it.
- `MAX_GRAPHIC_INPUTS_PER_BROADCAST_GRAPHICS_SCREEN` (60) now binds well before this cap for any package whose graphics declare Live Control: at two inputs per graphic only 30 of the 50 Broadcast Graphics can carry any. Anyone finding a package too small to author should move that number before this one, and re-measure the worst case when they do.
- Reversing this decision — making the worst case fit — means cutting `MAX_GRAPHIC_TEXT_LENGTH` or the Graphic Style Set override vocabulary, both of which are spec-level questions about what an author may express rather than budget questions. The Style Set one is the larger and is left open for whoever owns Graphic Style Sets: _should a Style Set reference be able to override every property of the group it names, or only the ones an author actually changed?_ Answering it from a byte budget is the practice this decision exists to have ended.
