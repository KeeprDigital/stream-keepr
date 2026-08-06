# ADR-0006: Over-broad Graphic Style Set override pins are not migrated

- **Status**: Accepted
- **Date**: 2026-08-05
- **Amended**: 2026-08-06 under [#229](https://github.com/KeeprDigital/stream-keepr/issues/229). The decision is unchanged; the second argument for it is retracted, because the narrowing it relied on has been removed as a defect. See _Why_ and _Consequences_.
- **Issue**: [#199](https://github.com/KeeprDigital/stream-keepr/issues/199) (recording it here), decided under [#167](https://github.com/KeeprDigital/stream-keepr/issues/167) / PR [#193](https://github.com/KeeprDigital/stream-keepr/pull/193)
- **Related**: [#162](https://github.com/KeeprDigital/stream-keepr/issues/162) (what narrowed "Keep mine"), [#60](https://github.com/KeeprDigital/stream-keepr/issues/60) (story 20, and the data-migration scope), [#198](https://github.com/KeeprDigital/stream-keepr/issues/198)

## Context

A linked graphics template records its local deviations from a Graphic Style Set as explicit property-level overrides, and review's **Keep mine** answer is how an author turns a resolved value into one.

Before #162, answering "Keep mine" on a row recorded the **whole property group** as the override — all eight typography keys, not the one or two the row was actually about. That freezes the slot against every future republish: a commitment far larger than the one the author was asked to make. #162 narrowed it, so "Keep mine" now records the author's prior pins plus the keys the update was about to move, and nothing else.

That leaves documents written by the old behaviour carrying eight-key pins. `heldGraphicStyleOverrides` in `shared/modules/graphic-style-sets/apply.ts` preserves every key of one, because each of those keys genuinely _is_ a recorded override the stored value honours — so the over-pinning #162 was filed about outlives the fix to it, on any document already carrying one.

The question this settles is whether anything should reconcile that.

## Decision

**Nothing does.** No migration, no heuristic narrowing, no one-off reconciliation pass. An over-broad pin is preserved exactly like any other recorded override, and comes off one property at a time as the author moves each of them.

## Why

**The document does not record what a migration would need to know.** An over-broad pin and a deliberate whole-group pin are the same eight keys in storage. The only signal that could separate them is "this override agrees with what the entry resolves to" — and that reading is wrong: a pin the republished preset happens to land on is still the author's, and dropping it would let the next republish take the property away. A migration on that signal would destroy exactly the pins the narrowed rule exists to preserve. Losing an author's real override is a worse failure than keeping one they did not mean to make.

**No later "Keep mine" narrows it, and an author's next edit no longer does either — retracted under #229.** The half of the original argument that still holds: a fully pinned slot resolves to what the owner already holds, so it never produces a review row again, there is no later "Keep mine" on it to narrow anything, and one would preserve the pin anyway by coming back through `heldGraphicStyleOverrides`. (Only a reviewed update can write such a pin at all — `applyGraphicStyleSet` acts on decisions only when its caller passes them, and `bindGraphicStyleRef` passes none.)

What it also claimed is that `recaptureGraphicStyleOverrides` narrows such a pin, by re-deriving each slot's overrides from what the composition deviates in and **discarding the recorded set** — so the first property edit after #162 collapses the eight keys to the author's real deviation. That discard is the same wrong reading this decision rejects for a migration, run on the live path: a pin the republished preset has coincidentally landed on is not a deviation either, so it was discarded too, and the next republish took the property. #229 removed the discard. Recapture now preserves a recorded key the stored value still honours — which is what `heldGraphicStyleOverrides` already did on apply — so the two paths read the recorded set the same way and neither narrows anything.

The decision stands on the first and third arguments, which never depended on this one. An over-broad pin is now permanent until the author moves each property by hand, and that is the smaller failure: losing an author's real override is worse than keeping one they did not mean to make, here as on the migration path.

**No such document reaches production.** Spec #60 settles that the database is wiped before ship and names data migration as out of scope, so the population a migration would serve is empty by construction.

## Consequences

- A pre-#162 document keeps its over-broad pin until an author moves each pinned property by hand. That is visible as properties that go on inheriting nothing, and the answer to a report of it is "edit the property", not "run a migration". Since #229 an edit narrows only the key it moves, so the eight keys come off one at a time rather than together.
- `heldGraphicStyleOverrides` stays a pure function of what is recorded and what is stored. It has no notion of when an override was written, and nothing may give it one — a provenance test there is the discredited heuristic above, wearing a different name. `recaptureGraphicStyleOverrides` is now the same function of the same two facts, reached through `authoredGraphicStyleOverrides`, and the prohibition covers it identically.
- Issue #198 widened when `recaptureGraphicStyleOverrides` runs: its guard is now per slot and turns on whether the stored value is in step with the published entries, rather than on the revision number alone. That widens the set of documents an ordinary edit records deviations on — a template stranded on an older revision it is already in step with now records them, where before only a revision match did.
- **The live path no longer takes the failure this decision refuses to risk in bulk (#229).** It used to. `recaptureGraphicStyleOverrides` derived each slot's overrides from where the composition deviates and discarded the recorded set, so a **deliberate** pin stopped being recorded the moment the Style Set's own value coincided with it, and the next republish took the property — exactly the outcome the _Why_ above rejects a migration for. The trigger was wider than "an edit to that slot": recapture walks every owner in the composition, so a font-size edit on a second Graphic Item carrying no reference at all dropped the first item's pin. That left almost nothing of the distinction between the two acts, since "the author acted in this slot" was doing no work. The fix is the one the _Why_'s own reasoning demands: a recorded override the stored value still honours survives, whether or not the entry has caught up with it, on both paths. What this decision now costs is the bullet above — an over-broad pin that only a hand edit per property narrows — and that is the direction it has always preferred to fail in.

## Alternatives rejected

**Migrate on the "agrees with the entry" signal.** Rejected above: it cannot tell a deliberate pin from an accidental one, and it fails in the destructive direction.

**Ask the author.** A prompt about eight typography keys on a template they have not opened is a question with no context attached to it. The property they care about is the one they will edit when they do open it, and editing it is the answer to that question — given one property at a time, in the place where it means something.

**Version the override record.** Storing "this pin was written by the pre-#162 rule" would make a migration decidable. It is not worth a stored-schema change for a population that is empty by construction (#60), and it would leave the field in the schema forever afterwards.
