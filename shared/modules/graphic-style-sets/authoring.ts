import type { BroadcastGraphicConfig } from '../../types/graphics';
import type {
	GraphicStyleEntryKind,
	GraphicStyleRefs,
	GraphicStyleSetEntry,
	GraphicStyleSlot,
} from '../../types/graphicStyleSet';
import type { GraphicStyleSetResolution } from './entries';
import {
	GRAPHIC_STYLE_ENTRY_SCHEMA_VERSION,
	GRAPHIC_STYLE_SLOT_VALUES,
} from '../../types/graphicStyleSet';
import { squareShapeGeometry } from '../graphics/shapeGeometry';
import {
	applyGraphicStyleSet,
	captureGraphicStyleOverrides,
	GRAPHIC_STYLE_SLOT_OWNED_KEYS,
	graphicStyleSlotDeviates,
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
							fontId: 'inter',
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
 * It is a diff against the Style Set revision the composition was *reconciled to*,
 * which is the one its values were produced from. That is what makes it correct: an
 * override is by definition where the author's value and the preset's disagree, and
 * both sides of that comparison are in front of it. An author who edits a value and
 * puts it back is left with no override rather than one pinning it.
 *
 * A slot with no owned keys has nowhere to record a deviation, so an author who edits
 * one has unbound it — the same answer review's "keep as an override" gives for the
 * same reason. That is not a weaker outcome than an override: the value is already
 * stored inline and does not move, only the provenance does. Keeping the reference
 * would leave the composition reporting an available update that no later apply could
 * ever settle, which is a badge that misreports rather than a design that is protected.
 *
 * ## Why the revisions have to agree first
 *
 * The editor holds the Style Set's *published* entries, so between a republish and
 * the author reviewing it, it is holding entries this composition was never
 * reconciled to. Every difference derivable from them is then the Style Set's own
 * change wearing the author's name. Recording one — as an override, or by letting go
 * of a reference — settles a pending update that nobody reviewed, which is the single
 * thing story 20 exists to prevent. So while the two disagree this is the identity:
 * the author's edited values are already stored inline and stay exactly where they
 * are, and review is where they are shown that their edit and the Style Set's differ.
 * Deviations start being recorded again the moment an applied update brings the
 * composition back onto the published revision.
 */
export function recaptureGraphicStyleOverrides(
	graphic: BroadcastGraphicConfig,
	resolution: GraphicStyleSetResolution,
	/** The published revision `resolution` was built from. */
	publishedRevision: number,
): BroadcastGraphicConfig {
	if (graphic.styleSet?.revision !== publishedRevision)
		return graphic;

	function recaptured<T extends { styleRefs?: GraphicStyleRefs }>(owner: T): T {
		if (!owner.styleRefs)
			return owner;

		const next: GraphicStyleRefs = {};
		for (const slot of GRAPHIC_STYLE_SLOT_VALUES) {
			const ref = owner.styleRefs[slot];
			if (!ref)
				continue;
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

			const overrides = captureGraphicStyleOverrides(resolution, slot, ref.entryId, current);
			(next as Record<string, unknown>)[slot] = overrides
				? { entryId: ref.entryId, overrides }
				: { entryId: ref.entryId };
		}
		return { ...owner, styleRefs: next };
	}

	return {
		...recaptured(graphic as BroadcastGraphicConfig & { styleRefs?: GraphicStyleRefs }),
		items: graphic.items.map((item) => {
			const updated = recaptured(item);
			if (updated.type !== 'group')
				return updated;
			return { ...updated, children: updated.children.map(child => recaptured(child)) };
		}),
	};
}
