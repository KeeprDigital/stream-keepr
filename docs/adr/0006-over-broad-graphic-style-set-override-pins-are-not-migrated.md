# ADR-0006: Over-broad Graphic Style Set override pins are not migrated

- **Status**: Accepted
- **Date**: 2026-08-05
- **Issue**: [#199](https://github.com/KeeprDigital/stream-keepr/issues/199) (recording it here), decided under [#167](https://github.com/KeeprDigital/stream-keepr/issues/167) / PR [#193](https://github.com/KeeprDigital/stream-keepr/pull/193)
- **Related**: [#162](https://github.com/KeeprDigital/stream-keepr/issues/162) (what narrowed "Keep mine"), [#60](https://github.com/KeeprDigital/stream-keepr/issues/60) (story 20, and the data-migration scope), [#198](https://github.com/KeeprDigital/stream-keepr/issues/198)

## Context

A linked graphics template records its local deviations from a Graphic Style Set as explicit property-level overrides, and review's **Keep mine** answer is how an author turns a resolved value into one.

Before #162, answering "Keep mine" on a row recorded the **whole property group** as the override — all eight typography keys, not the one or two the row was actually about. That freezes the slot against every future republish: a commitment far larger than the one the author was asked to make. #162 narrowed it, so "Keep mine" now records the author's prior pins plus the keys the update was about to move, and nothing else.

That leaves documents written by the old behaviour carrying eight-key pins. `heldGraphicStyleOverrides` in `shared/modules/graphic-style-sets/apply.ts` preserves every key of one, because each of those keys genuinely _is_ a recorded override the stored value honours — so the over-pinning #162 was filed about outlives the fix to it, on any document already carrying one.

The question this settles is whether anything should reconcile that.

## Decision

**Nothing does.** No migration, no heuristic narrowing, no one-off reconciliation pass. An over-broad pin is preserved exactly like any other recorded override until an ordinary edit re-derives it.

## Why

**The document does not record what a migration would need to know.** An over-broad pin and a deliberate whole-group pin are the same eight keys in storage. The only signal that could separate them is "this override agrees with what the entry resolves to" — and that reading is wrong: a pin the republished preset happens to land on is still the author's, and dropping it would let the next republish take the property away. A migration on that signal would destroy exactly the pins the narrowed rule exists to preserve. Losing an author's real override is a worse failure than keeping one they did not mean to make.

**An author's next edit already narrows it, and no later "Keep mine" could.** A fully pinned slot resolves to what the owner already holds, so it never produces a review row again — there is no later "Keep mine" on it to narrow anything, and one would preserve the pin anyway by coming back through `heldGraphicStyleOverrides`. What narrows it is `recaptureGraphicStyleOverrides`, which re-derives each slot's overrides from what the composition deviates in and discards the recorded set. Its guard is already satisfied on a document that could hold such a pin: the same call that writes one also moves the composition onto the published revision, because `applyGraphicStyleSet` records a revision only when its caller passes one, and the only caller that acts on decisions — `server/api/graphics-templates/broadcast-graphics/[templateId]/style-update.post.ts`, applying a reviewed update — passes the decisions and the revision together. (`bindGraphicStyleRef` passes neither, so it cannot write one of these pins in the first place.) The first property edit after that collapses the eight keys to the author's real deviation.

**No such document reaches production.** Spec #60 settles that the database is wiped before ship and names data migration as out of scope, so the population a migration would serve is empty by construction.

## Consequences

- A pre-#162 document keeps its over-broad pin until an author edits the slot. That is visible as properties that go on inheriting nothing, and the answer to a report of it is "edit the property", not "run a migration".
- `heldGraphicStyleOverrides` stays a pure function of what is recorded and what is stored. It has no notion of when an override was written, and nothing may give it one — a provenance test there is the discredited heuristic above, wearing a different name.
- Issue #198 widened when `recaptureGraphicStyleOverrides` runs: its guard is now per slot and turns on whether the stored value is in step with the published entries, rather than on the revision number alone. That strictly widens the set of documents an ordinary edit narrows, so the argument above holds under it — the revision-passing caller named here still satisfies the guard, and now so does a template stranded on an older revision it is already in step with.
- **That narrowing has a cost, and it is the cost this decision refuses to pay on the migration path.** `recaptureGraphicStyleOverrides` derives each slot's overrides from where the composition deviates, so a **deliberate** pin stops being recorded the moment the Style Set's own value coincides with it — and any later edit to the slot drops it, including an edit to a key the entry does not own. The next republish then takes the property, which is exactly the outcome the _Why_ above rejects a migration for. The two are not the same act: recapture runs on an author's own edit to that slot, while a migration would run over documents nobody touched, and #162's per-row values let an author who sees the change hit **Keep mine** again. But the distinction is thinner than the _Why_ alone suggests, and this decision is not a claim that the live path is free of the failure it declines to risk in bulk. #229 tracks it, with the four-step construction that proves it — and proves it pre-existing, since the reconciled path behaved identically before #198 widened the population reaching it.

## Alternatives rejected

**Migrate on the "agrees with the entry" signal.** Rejected above: it cannot tell a deliberate pin from an accidental one, and it fails in the destructive direction.

**Ask the author.** A prompt about eight typography keys on a template they have not opened is a question with no context attached to it. The narrowing already happens silently and correctly the moment they do open it and edit the property they care about.

**Version the override record.** Storing "this pin was written by the pre-#162 rule" would make a migration decidable. It is not worth a stored-schema change for a population that is empty by construction (#60), and it would leave the field in the schema forever afterwards.
