import type { BroadcastGraphicConfig } from '../../types/graphics';
import type {
	GraphicStyleEntryKind,
	GraphicStyleRefs,
	GraphicStyleSetEntry,
	GraphicStyleSlot,
} from '../../types/graphicStyleSet';
import type { GraphicStyleSetResolution } from './entries';
import type { GraphicStyleOwnerNode } from './slots';
import {
	GRAPHIC_STYLE_ENTRY_SCHEMA_VERSION,
	GRAPHIC_STYLE_SLOT_VALUES,
} from '../../types/graphicStyleSet';
import { squareShapeGeometry } from '../graphics/shapeGeometry';
import {
	applyGraphicStyleSet,
	authoredGraphicStyleOverrides,
	GRAPHIC_STYLE_SLOT_OWNED_KEYS,
	graphicStyleSlotDeviates,
	graphicStyleSlotInStep,
} from './apply';
import { GRAPHIC_STYLE_SLOT_KINDS, graphicStyleOwnerSupportsSlot, readGraphicStyleSlot } from './slots';

/**
 * Authoring operations for Graphic Style Sets and for the references a composition
 * makes to them.
 *
 * Pure, like the compositor's own authoring module: each returns the next draft or
 * the next composition and never mutates its input, so the editor hands the result
 * straight to a write and the same rules hold wherever they run.
 */

/**
 * A new entry of one kind, with a value an author can immediately see the effect of.
 *
 * The kinds that involve colour need a palette entry to point at, because a preset
 * stores a reference rather than a colour. An author creating one before any palette
 * entry exists is asking for something that cannot be represented, so this returns
 * null rather than inventing a dangling reference the next publish would refuse.
 */
export function createGraphicStyleEntry(options: {
	id: string;
	kind: GraphicStyleEntryKind;
	name: string;
	/** The palette entry a colour-bearing preset starts out referencing. */
	paletteEntryId?: string;
}): GraphicStyleSetEntry | null {
	const base = { id: options.id, name: options.name, schemaVersion: GRAPHIC_STYLE_ENTRY_SCHEMA_VERSION };
	const palette = options.paletteEntryId;

	switch (options.kind) {
		case 'palette':
			return { ...base, kind: 'palette', value: { color: '#ffffff' } };

		case 'typography':
			return palette
				? {
						...base,
						kind: 'typography',
						value: {
							font: { kind: 'application', fontId: 'inter' },
							fontSize: 48,
							fontWeight: 700,
							fontStyle: 'normal',
							textTransform: 'none',
							letterSpacing: 0,
							lineHeight: 1.2,
							colorEntryId: palette,
						},
					}
				: null;

		case 'fill':
			return palette
				? { ...base, kind: 'fill', value: { type: 'solid', colorEntryId: palette } }
				: null;

		case 'surface-style':
			return { ...base, kind: 'surface-style', value: { fillOpacity: 1 } };

		case 'media-treatment':
			return {
				...base,
				kind: 'media-treatment',
				value: { fit: 'cover', focalPosition: { horizontal: 0.5, vertical: 0.5 }, opacity: 1 },
			};

		case 'shape-geometry':
			return { ...base, kind: 'shape-geometry', value: squareShapeGeometry() };

		case 'animation-recipe':
			return {
				...base,
				kind: 'animation-recipe',
				value: { duration: 300, easing: 'ease-out', delay: 0, fade: { opacity: 0 } },
			};
	}
}

/** The entries of one kind, which is what a slot's picker offers. */
export function graphicStyleEntriesOfKind(
	entries: readonly GraphicStyleSetEntry[],
	kind: GraphicStyleEntryKind,
): GraphicStyleSetEntry[] {
	return entries.filter(entry => entry.kind === kind);
}

/** The entries a slot can reference. */
export function graphicStyleEntriesForSlot(
	entries: readonly GraphicStyleSetEntry[],
	slot: GraphicStyleSlot,
): GraphicStyleSetEntry[] {
	return graphicStyleEntriesOfKind(entries, GRAPHIC_STYLE_SLOT_KINDS[slot]);
}

function patchOwnerRefs(
	graphic: BroadcastGraphicConfig,
	itemId: string | null,
	update: (refs: GraphicStyleRefs) => GraphicStyleRefs,
): BroadcastGraphicConfig {
	function patched<T extends { styleRefs?: GraphicStyleRefs }>(owner: T): T {
		const next = update(owner.styleRefs ?? {});
		const applied = { ...owner };
		if (Object.keys(next).length > 0)
			applied.styleRefs = next;
		else
			delete applied.styleRefs;
		return applied;
	}

	if (itemId === null)
		return patched(graphic as BroadcastGraphicConfig & { styleRefs?: GraphicStyleRefs });

	return {
		...graphic,
		items: graphic.items.map((item) => {
			if (item.id === itemId)
				return patched(item);
			if (item.type !== 'group')
				return item;
			return {
				...item,
				children: item.children.map(child => child.id === itemId ? patched(child) : child),
			};
		}),
	};
}

/**
 * Point one slot at a Graphic Style Set entry, and take the entry's value.
 *
 * Binding starts with no overrides: the author has just said "this property comes
 * from there", so nothing about it is theirs yet. Their next edit to it is what
 * becomes a deviation, captured by `recaptureGraphicStyleOverrides`.
 */
export function bindGraphicStyleRef(
	graphic: BroadcastGraphicConfig,
	itemId: string | null,
	slot: GraphicStyleSlot,
	entryId: string,
	resolution: GraphicStyleSetResolution,
): BroadcastGraphicConfig {
	const bound = patchOwnerRefs(graphic, itemId, refs => ({ ...refs, [slot]: { entryId } }));
	return applyGraphicStyleSet(bound, resolution);
}

/**
 * Stop inheriting one slot, keeping the value it currently holds.
 *
 * The property does not move. A composition stores its resolved values inline, so
 * unbinding is removing the provenance and nothing else — which is what makes it a
 * safe thing to offer next to the picker rather than a destructive one.
 */
export function unbindGraphicStyleRef(
	graphic: BroadcastGraphicConfig,
	itemId: string | null,
	slot: GraphicStyleSlot,
): BroadcastGraphicConfig {
	return patchOwnerRefs(graphic, itemId, (refs) => {
		const next = { ...refs };
		delete next[slot];
		return next;
	});
}

/**
 * Re-derive every reference's local overrides from what the composition now holds.
 *
 * This is what turns an ordinary property edit into the explicit property-level
 * override the glossary requires. The editor's controls write values, not
 * provenance — an author drags a font size slider on an item whose typography is
 * inherited — and running this after an edit records exactly which owned keys no
 * longer match the preset.
 *
 * What one slot ends up recording is what {@link authoredGraphicStyleOverrides} names,
 * so an ordinary edit and review's "Keep mine" leave the identical record: the pins
 * already recorded that this composition still holds, plus every owned key that now
 * deviates from the preset. It is deliberately not the deviation alone. Deriving the
 * whole record that way discarded any pin the Style Set had since caught up with — the
 * author's value and the preset's agreed, so nothing looked like a deviation — and the
 * next republish moving that preset away then took the property (#229).
 *
 * The derived half is a diff against the Style Set revision the composition
 * was *reconciled to*, which is the one its values were produced from. That is what
 * makes it correct: an override is by definition where the author's value and the
 * preset's disagree, and both sides of that comparison are in front of it. An author
 * who edits a value and puts it back is left with no override rather than one pinning
 * it.
 *
 * A slot with no owned keys has nowhere to record a deviation, so an author who edits
 * one has unbound it — the same answer review's "keep as an override" gives for the
 * same reason. That is not a weaker outcome than an override: the value is already
 * stored inline and does not move, only the provenance does. Keeping the reference
 * would leave the composition reporting an available update that no later apply could
 * ever settle, which is a badge that misreports rather than a design that is protected.
 *
 * ## What a slot has to be clear of before a deviation is derived from it
 *
 * The editor holds the Style Set's *published* entries, so between a republish and
 * the author reviewing it, it is holding entries this composition may never have been
 * reconciled to. Where that is so, a difference derivable from them is the Style Set's
 * own pending change wearing the author's name. Recording one — as an override, or by
 * letting go of a reference — settles a pending update that nobody reviewed, which is
 * the single thing story 20 exists to prevent.
 *
 * The test for that is per slot and is made against `stored`, the composition as it
 * was before this edit: a slot whose stored value is already what the published
 * entries resolve it to has no pending change to absorb, so a deviation appearing in
 * it now is the author's and nothing else's. A slot that is *not* in step is left
 * exactly as recorded, and review is where the author is shown that their edit and
 * the Style Set's differ.
 *
 * A matching revision skips the test, which is the ordinary case and the cheap one.
 * What it is no longer allowed to be is the *only* way through, because a publish that
 * changes entries a composition never references offers it nothing to review and so
 * never moves its number. Reading that lagging number as a pending change stranded the
 * template: it recorded no overrides at all, and the next republish that did reach one
 * of its slots destroyed the author's inline work under the review row's default
 * answer (#198).
 */
export function recaptureGraphicStyleOverrides(
	graphic: BroadcastGraphicConfig,
	resolution: GraphicStyleSetResolution,
	/** The published revision `resolution` was built from. */
	publishedRevision: number,
	/**
	 * The composition as stored before the edit being recaptured.
	 *
	 * It is what says whether a slot had a pending Style Set change in it, which
	 * `graphic` can no longer answer: the author's own edit has just moved one of these
	 * slots away from the entry it follows, and that is precisely the difference this
	 * is here to record.
	 */
	stored: BroadcastGraphicConfig,
): BroadcastGraphicConfig {
	const reconciled = graphic.styleSet?.revision === publishedRevision;
	const storedOwners = reconciled ? null : styleRefOwnerNodes(stored);

	/** Whether this slot's deviations can be read as the author's own. */
	function derivable(itemId: string | null, slot: GraphicStyleSlot): boolean {
		if (reconciled)
			return true;
		const before = storedOwners!.get(itemId);
		if (!before)
			return false;
		// A Broadcast Graphic holds a narrower slot family than a Graphic Item does, and
		// this asks the same question of both — as every traversal over owners here does.
		const ref = (before.styleRefs as GraphicStyleRefs | undefined)?.[slot];
		return ref !== undefined && graphicStyleSlotInStep(resolution, slot, ref, before);
	}

	function recaptured<T extends { styleRefs?: GraphicStyleRefs }>(owner: T, itemId: string | null): T {
		if (!owner.styleRefs)
			return owner;

		const next: GraphicStyleRefs = {};
		for (const slot of GRAPHIC_STYLE_SLOT_VALUES) {
			const ref = owner.styleRefs[slot];
			if (!ref)
				continue;
			if (!derivable(itemId, slot)) {
				// Kept exactly as recorded, overrides and all. Nothing here is decided, and
				// the value the author just wrote stays inline where it is.
				(next as Record<string, unknown>)[slot] = ref;
				continue;
			}
			if (!graphicStyleOwnerSupportsSlot(owner as never, slot)) {
				(next as Record<string, unknown>)[slot] = { entryId: ref.entryId };
				continue;
			}
			const current = readGraphicStyleSlot(owner as never, slot);

			if (GRAPHIC_STYLE_SLOT_OWNED_KEYS[slot].length === 0) {
				// Deviating from the preset is what lets go of the reference. The author's
				// deviation is the only thing that can, which is why the revisions must
				// already agree for this to be reached at all.
				if (graphicStyleSlotDeviates(resolution, slot, ref.entryId, current))
					continue;
				(next as Record<string, unknown>)[slot] = { entryId: ref.entryId };
				continue;
			}

			const overrides = authoredGraphicStyleOverrides(resolution, slot, ref.entryId, ref.overrides, current);
			(next as Record<string, unknown>)[slot] = Object.keys(overrides).length > 0
				? { entryId: ref.entryId, overrides }
				: { entryId: ref.entryId };
		}
		return { ...owner, styleRefs: next };
	}

	return {
		...recaptured(graphic as BroadcastGraphicConfig & { styleRefs?: GraphicStyleRefs }, null),
		items: graphic.items.map((item) => {
			const updated = recaptured(item, item.id);
			if (updated.type !== 'group')
				return updated;
			return { ...updated, children: updated.children.map(child => recaptured(child, child.id)) };
		}),
	};
}

/**
 * Every node of one composition that can carry Graphic Style Set references, keyed the
 * way a reviewable change is: the Broadcast Graphic itself under null, each Graphic
 * Item and group child under its own id.
 */
function styleRefOwnerNodes(graphic: BroadcastGraphicConfig): Map<string | null, GraphicStyleOwnerNode> {
	const owners = new Map<string | null, GraphicStyleOwnerNode>([[null, graphic]]);
	for (const item of graphic.items) {
		owners.set(item.id, item);
		if (item.type === 'group') {
			for (const child of item.children)
				owners.set(child.id, child);
		}
	}
	return owners;
}
