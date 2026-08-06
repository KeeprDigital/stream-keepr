import type {
	BroadcastGraphicConfig,
	GraphicGroupChildConfig,
	GraphicItemConfig,
	GraphicSurfaceStyle,
} from '../../types/graphics';
import type {
	GraphicStyleRef,
	GraphicStyleRefs,
	GraphicStyleSlot,
	GraphicStyleUpdateChange,
	GraphicStyleUpdateDecision,
} from '../../types/graphicStyleSet';
import type { GraphicStyleSetResolution } from './entries';
import type { GraphicStyleOwnerNode } from './slots';
import { GRAPHIC_STYLE_SLOT_VALUES } from '../../types/graphicStyleSet';
import {
	GRAPHIC_STYLE_SLOT_APPLICATION_ORDER,
	graphicStyleOwnerSupportsSlot,
	readGraphicStyleSlot,
	resolvedValueFitsSlot,
	writeGraphicStyleSlot,
} from './slots';

/**
 * Turning Graphic Style Set references into the values a graphics document holds,
 * and turning a republished Style Set into a reviewable offer.
 *
 * Everything here is pure and works on one composition at a time. The three
 * operations it exists for are the three the glossary names:
 *
 * - **Apply.** Rebuild every inherited property group from the published entries,
 *   keeping the author's local overrides. Used when an entry is first referenced,
 *   and again when an author accepts an update.
 * - **Compare.** Say which property groups an apply *would* change. An update is
 *   available exactly when that list is non-empty, which is why a rename, a new
 *   unused entry, and an edit to an entry this composition never references all
 *   produce nothing: none of them changes a resolved value here.
 * - **Detach and replace.** Drop a reference while keeping the value it produced,
 *   or repoint it at another entry. Deleting an entry is these two operations run
 *   across every affected template at once.
 *
 * ## Why the comparison is against the document rather than against a revision
 *
 * A composition stores its resolved values inline, so "has the style changed" is
 * answerable by resolving the published entries and comparing with what is stored.
 * No history of Style Set revisions is needed, and the answer stays right even if a
 * composition's values were reached some other way — an import, a hand edit, a
 * restored backup. The alternative, diffing two published revisions, would report an
 * update on a template whose values already happened to match the new ones.
 */

/**
 * Structural equality over the JSON shapes a property group is made of.
 *
 * Written out rather than compared through `JSON.stringify`, because the values
 * being compared come from two different places — one built here, one read back out
 * of storage — and their keys are not in the same order. A stringify comparison
 * would report every unchanged property as changed the first time a document made a
 * round trip.
 */
export function sameGraphicStyleValue(left: unknown, right: unknown): boolean {
	if (left === right)
		return true;
	if (typeof left !== typeof right || left === null || right === null)
		return false;
	if (Array.isArray(left) || Array.isArray(right)) {
		if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
			return false;
		return left.every((entry, index) => sameGraphicStyleValue(entry, right[index]));
	}
	if (typeof left !== 'object')
		return false;

	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	// Keys whose value is `undefined` are absent as far as a stored document is
	// concerned: they vanish through JSON and reappear as nothing.
	const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]
		.filter(key => leftRecord[key] !== undefined || rightRecord[key] !== undefined));
	for (const key of keys) {
		if (!sameGraphicStyleValue(leftRecord[key], rightRecord[key]))
			return false;
	}
	return true;
}

/**
 * The property keys each slot's entry owns.
 *
 * Applying a preset replaces exactly these and nothing else, which is what keeps a
 * Text Graphic Item's alignment, content, and overflow policy local while its
 * typography is inherited.
 */
export const GRAPHIC_STYLE_SLOT_OWNED_KEYS: Record<GraphicStyleSlot, readonly string[]> = {
	'typography': ['font', 'fontSize', 'fontWeight', 'fontStyle', 'textTransform', 'letterSpacing', 'lineHeight', 'color'],
	'surfaceStyle': ['fill', 'fillOpacity', 'outline', 'glow'],
	// A Graphic Fill is a discriminated union with no meaningful partial, so this slot
	// takes no overrides at all: deviating from a Graphic Fill preset is unbinding it.
	'surfaceStyle.fill': [],
	'defaultChildSurfaceStyle': ['fill', 'fillOpacity', 'outline', 'glow'],
	'boxSurfaceStyle': ['fill', 'fillOpacity', 'outline', 'glow'],
	'wonBoxSurfaceStyle': ['fill', 'fillOpacity', 'outline', 'glow'],
	'geometry': ['topLeft', 'topRight', 'bottomRight', 'bottomLeft', 'leftSlant', 'rightSlant'],
	'clipGeometry': ['topLeft', 'topRight', 'bottomRight', 'bottomLeft', 'leftSlant', 'rightSlant'],
	'boxGeometry': ['topLeft', 'topRight', 'bottomRight', 'bottomLeft', 'leftSlant', 'rightSlant'],
	'media': ['fit', 'focalPosition', 'opacity', 'clipGeometry', 'playbackRate', 'loop'],
	'animation.enter': ['duration', 'easing', 'delay', 'fade', 'slide', 'scale', 'reveal'],
	'animation.on-screen': ['duration', 'easing', 'delay', 'fade', 'slide', 'scale', 'reveal', 'pause', 'repeat'],
	'animation.update': ['duration', 'easing', 'delay', 'fade', 'slide', 'scale', 'reveal'],
	'animation.exit': ['duration', 'easing', 'delay', 'fade', 'slide', 'scale', 'reveal'],
};

function pick(source: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, unknown> {
	const picked: Record<string, unknown> = {};
	if (!source)
		return picked;
	for (const key of keys) {
		if (source[key] !== undefined)
			picked[key] = source[key];
	}
	return picked;
}

/**
 * The property group one slot's reference resolves to, ready to be written.
 *
 * `base` is what the owner currently holds, and it contributes only the keys the
 * entry does not own — a Text Graphic Item's alignment, a Graphic Surface Style's
 * fill when the preset carries none. `overrides` are the author's own deviations and
 * are applied last, so an override always wins over the preset.
 *
 * Returns null when the resolved entry is not the kind this slot takes, which leaves
 * the owner's current value untouched rather than writing a shape it cannot hold.
 */
export function resolveGraphicStyleSlotValue(
	resolution: GraphicStyleSetResolution,
	slot: GraphicStyleSlot,
	entryId: string,
	base: unknown,
	overrides: Record<string, unknown> | undefined,
): unknown {
	const resolved = resolution.resolved.get(entryId);
	if (!resolved || !resolvedValueFitsSlot(resolved, slot))
		return null;

	const baseRecord = (base ?? undefined) as Record<string, unknown> | undefined;
	const owned = GRAPHIC_STYLE_SLOT_OWNED_KEYS[slot];
	const deviations = pick(overrides as Record<string, unknown> | undefined, owned);

	switch (resolved.kind) {
		case 'typography':
			// Unowned keys — text alignment — come from the item and stay there.
			return { ...baseRecord, ...resolved.value, ...deviations };

		case 'fill':
			return structuredClone(resolved.value);

		case 'shape-geometry':
			return { ...structuredClone(resolved.value), ...deviations };

		case 'surface-style': {
			const surface = resolved.value;
			const next: GraphicSurfaceStyle = {
				// A Graphic Surface Style always has a fill, so a preset that names no
				// Graphic Fill preset leaves the one the item already had rather than
				// clearing it to nothing renderable.
				fill: structuredClone(surface.fill ?? (baseRecord?.fill as GraphicSurfaceStyle['fill'])),
				fillOpacity: surface.fillOpacity,
				...(surface.outline ? { outline: { ...surface.outline } } : {}),
				...(surface.glow ? { glow: { ...surface.glow } } : {}),
			};
			return { ...next, ...deviations };
		}

		case 'media-treatment': {
			const treatment = resolved.value;
			return {
				fit: treatment.fit,
				focalPosition: { ...treatment.focalPosition },
				opacity: treatment.opacity,
				// Absent clears the item's clipping; the write path deletes the key.
				clipGeometry: treatment.clipGeometry ? structuredClone(treatment.clipGeometry) : undefined,
				// Video-only defaults. A preset that states none leaves the item's own,
				// exactly as a Media Graphic Item keeps its playback while its kind changes.
				playbackRate: treatment.playbackRate ?? baseRecord?.playbackRate,
				loop: treatment.loop ?? baseRecord?.loop,
				...deviations,
			};
		}

		case 'animation-recipe': {
			const recipe = { ...structuredClone(resolved.value) } as Record<string, unknown>;
			// Repetition is on-screen-only. Carrying it onto an enter recipe would store
			// fields the wire schema refuses.
			if (slot !== 'animation.on-screen') {
				delete recipe.pause;
				delete recipe.repeat;
			}
			return { ...recipe, ...deviations };
		}

		case 'palette':
			return null;
	}
}

/* ────────────────────────────────────────────────
 * Walking a composition's style references
 * ──────────────────────────────────────────────── */

/** One owner of Graphic Style Set references inside a composition. */
export interface GraphicStyleRefOwner {
	/** Null for the Broadcast Graphic itself. */
	itemId: string | null;
	label: string;
	refs: GraphicStyleRefs;
}

/** Every Graphic Item of a composition, groups before their children. */
function ownedItems(graphic: BroadcastGraphicConfig): GraphicItemConfig[] {
	return graphic.items.flatMap(item => item.type === 'group' ? [item, ...item.children] : [item]);
}

/** Every owner in a composition that references at least one Graphic Style Set entry. */
export function graphicStyleRefOwners(graphic: BroadcastGraphicConfig): GraphicStyleRefOwner[] {
	const owners: GraphicStyleRefOwner[] = [];
	if (graphic.styleRefs && Object.keys(graphic.styleRefs).length > 0)
		owners.push({ itemId: null, label: graphic.name, refs: graphic.styleRefs });
	for (const item of ownedItems(graphic)) {
		if (item.styleRefs && Object.keys(item.styleRefs).length > 0)
			owners.push({ itemId: item.id, label: item.label, refs: item.styleRefs });
	}
	return owners;
}

/** Every Graphic Style Set entry id this composition references. */
export function graphicStyleSetEntryIdsInDocument(graphic: BroadcastGraphicConfig): Set<string> {
	const ids = new Set<string>();
	for (const owner of graphicStyleRefOwners(graphic)) {
		for (const slot of GRAPHIC_STYLE_SLOT_VALUES) {
			const ref = owner.refs[slot];
			if (ref)
				ids.add(ref.entryId);
		}
	}
	return ids;
}

/**
 * Rewrite every owner in one composition that carries Graphic Style Set references.
 *
 * The Broadcast Graphic and its Graphic Items are different shapes but reference
 * entries the same way and share one slot family, so the traversal exists once and
 * every operation that touches references — apply, detach, replace — is written as a
 * function of one owner. An owner left with no references loses the key entirely,
 * because an empty object is a difference a stored document can see.
 */
function mapStyleRefOwners(
	graphic: BroadcastGraphicConfig,
	update: <T extends GraphicStyleOwnerNode>(owner: T, refs: GraphicStyleRefs, itemId: string | null) => T,
): BroadcastGraphicConfig {
	function updateOwner<T extends GraphicStyleOwnerNode>(owner: T, itemId: string | null): T {
		if (!owner.styleRefs)
			return owner;
		const next = { ...update(owner, owner.styleRefs as GraphicStyleRefs, itemId) };
		if (!next.styleRefs || Object.keys(next.styleRefs).length === 0)
			delete next.styleRefs;
		return next;
	}

	// Copied unconditionally, because `updateOwner` returns its input untouched when
	// there is nothing to update — and assigning `items` onto that would rewrite the
	// caller's own composition. Every operation here is pure, and this is the one
	// place that could quietly stop being.
	const next = { ...updateOwner(graphic, null) };

	next.items = next.items.map((item) => {
		const updated = updateOwner(item, item.id);
		if (updated.type !== 'group')
			return updated;
		return {
			...updated,
			children: updated.children.map(child =>
				updateOwner(child as GraphicItemConfig, child.id) as GraphicGroupChildConfig,
			),
		};
	});

	return next;
}

/* ────────────────────────────────────────────────
 * Apply
 * ──────────────────────────────────────────────── */

export interface ApplyGraphicStyleSetOptions {
	/**
	 * Per reference, what the author decided during review. Keyed by
	 * `graphicStyleChangeKey`. A slot with no decision inherits, which is what an
	 * un-reviewed application — first binding an entry, or a caller that offers no
	 * review — does for every slot.
	 */
	decisions?: Record<string, GraphicStyleUpdateDecision>;
	/** The published revision the composition is being reconciled to. */
	revision?: number;
}

/** The stable key one reviewable change is decided under. */
export function graphicStyleChangeKey(itemId: string | null, slot: GraphicStyleSlot): string {
	return `${itemId ?? ''}::${slot}`;
}

/**
 * The overrides already recorded on a slot that the owner's stored value still holds.
 *
 * An override is a claim about a property — "this one is mine" — and the stored value
 * is what the owner actually renders. Where the two agree the claim still describes
 * something real and survives. Where they disagree the claim is stale: it names a value
 * this owner is not holding, so honouring it would move the property rather than keep
 * it, and it is dropped. That is what lets an owner whose stored value has gone back to
 * matching its entry end up pinning nothing at all rather than pinning a whole property
 * group on the strength of provenance the document itself contradicts.
 *
 * ## Why an over-broad pin from before #162 is not migrated
 *
 * "Keep mine" used to record the whole property group, and this preserves every key of
 * one that does — correctly, because each of those keys genuinely is a recorded
 * override the stored value honours. So a document written by the old behaviour keeps
 * its eight-key typography pin, and the over-pinning #162 was filed about outlives the
 * fix to it. Nothing reconciles that, deliberately: an over-broad pin and a deliberate
 * whole-group pin are the same eight keys in storage, and the one signal that could
 * separate them is the reading {@link applyGraphicStyleSet} below explains is wrong.
 * Nothing narrows one either, since #229 — an ordinary edit used to, and what it
 * actually narrowed was any pin the entry had caught up with, the author's included.
 * What clears one is unbinding the slot and binding it again, which starts over with no
 * overrides at all. Editing a pinned property does not: it re-pins it at the new value.
 *
 * The decision, the two alternatives rejected with it, and why no population needs it
 * are in `docs/adr/0006-over-broad-graphic-style-set-override-pins-are-not-migrated.md`
 * (#167, recorded under #199, amended under #229). Nothing here may acquire a notion
 * of *when* an override was written — that is the discredited heuristic wearing a
 * different name.
 */
function heldGraphicStyleOverrides(
	overrides: unknown,
	slot: GraphicStyleSlot,
	current: unknown,
): Record<string, unknown> {
	const recorded = (overrides ?? {}) as Record<string, unknown>;
	const currentRecord = (current ?? {}) as Record<string, unknown>;
	const held: Record<string, unknown> = {};
	for (const key of GRAPHIC_STYLE_SLOT_OWNED_KEYS[slot]) {
		if (recorded[key] !== undefined && sameGraphicStyleValue(recorded[key], currentRecord[key]))
			held[key] = recorded[key];
	}
	return held;
}

/**
 * What one slot records as the author's own, given what it already recorded and what
 * the owner now holds: the pins the stored value still honours, plus every owned key
 * that now deviates from the entry.
 *
 * Both paths that rewrite an override record go through here, and that is the point of
 * it existing. Review's "Keep mine" and an ordinary property edit are asking the same
 * question of the same two facts — what is recorded, and what this owner holds — and
 * answering it differently is how a pin was lost. `recaptureGraphicStyleOverrides`
 * used to derive the whole record from the deviation alone, so a pin the republished
 * preset had *coincidentally* landed on was no longer a deviation and stopped being
 * recorded; the next republish moving that preset away then took the property, which
 * is exactly the failure {@link heldGraphicStyleOverrides} exists to prevent on the
 * apply path (#229).
 *
 * So a pin is released by the author moving the property, never by the Style Set
 * arriving at it. An edit away from a pinned value replaces the pin with the deviation
 * it created, and an edit that lands back on what the entry resolves to leaves nothing
 * recorded at all — which is the same escape it has always had, and the only one.
 *
 * The other reading of that last act is what this cannot express: a value typed *onto*
 * the preset's own value is not a deviation either, so it records no pin and the next
 * republish takes the property. Accepted rather than fixed (#240) — the reasoning, and
 * the edit-time signal that would fix it at a cost this decision refuses, are in
 * ADR-0006 under "Record a pin whenever the author edits an owned key", which is the
 * authority to amend if that trade is ever revisited. What it rejects is the
 * unconditional form: recording a pin *because* an owned key was touched. An explicit
 * authoring gesture is a different proposal and is filed as #244.
 *
 * An entry the resolution cannot honour contributes no deviations, because there is no
 * preset in front of it to disagree with. What is already recorded survives, for the
 * reason a Style Set that failed to load must not be why a composition quietly goes
 * local.
 */
export function authoredGraphicStyleOverrides(
	resolution: GraphicStyleSetResolution,
	slot: GraphicStyleSlot,
	entryId: string,
	/** What this reference already records as the author's. */
	recorded: unknown,
	/** What the owner holds in this slot now. */
	current: unknown,
): Record<string, unknown> {
	return {
		...heldGraphicStyleOverrides(recorded, slot, current),
		...captureGraphicStyleOverrides(resolution, slot, entryId, current),
	};
}

/**
 * Rebuild every inherited property group of one composition from a resolved Graphic
 * Style Set.
 *
 * Local overrides survive by construction: they are re-applied on top of the newly
 * resolved preset. A slot the author decided to keep as an override instead has its
 * current* value recorded as the override, so the property does not move and the
 * reference stays — which is the one thing review can do that a plain application
 * cannot.
 *
 * A reference the resolution cannot honour — the entry is gone, or is now of another
 * kind — is left exactly as it is, value and reference together. Publish validation
 * and the replace-or-detach deletion flow are what stop those existing; silently
 * dropping one here would turn a Style Set that failed to load into a composition
 * that quietly went local.
 */
export function applyGraphicStyleSet(
	graphic: BroadcastGraphicConfig,
	resolution: GraphicStyleSetResolution,
	options: ApplyGraphicStyleSetOptions = {},
): BroadcastGraphicConfig {
	const decisions = options.decisions ?? {};

	const applied = mapStyleRefOwners(graphic, (owner, refs, itemId) => {
		let next = owner;
		const nextRefs: GraphicStyleRefs = { ...refs };

		for (const slot of GRAPHIC_STYLE_SLOT_APPLICATION_ORDER) {
			const ref = refs[slot] as GraphicStyleRef | undefined;
			if (!ref || !graphicStyleOwnerSupportsSlot(next, slot))
				continue;

			const current = readGraphicStyleSlot(next, slot);
			const resolved = resolveGraphicStyleSlotValue(
				resolution,
				slot,
				ref.entryId,
				current,
				ref.overrides as Record<string, unknown> | undefined,
			);
			if (resolved === null)
				continue;

			if (decisions[graphicStyleChangeKey(itemId, slot)] === 'keep-as-override') {
				// Preserving the previously resolved property means recording it as the
				// author's own: the reference stays and the property does not move, now or
				// on any later republish.
				//
				// What that records is "what in this slot is mine", which is two things and
				// not the whole property group. An author answering one row is answering
				// about the values on it, and pinning the seven typography keys the Style
				// Set and the author already agree on would freeze the slot against every
				// future republish — a commitment far larger than the one they were asked
				// to make (#162).
				//
				// A slot with no owned keys has no partial to deviate in — a Graphic Fill
				// is a discriminated union — so keeping its value means letting go of the
				// reference entirely. The value is already stored inline and does not move;
				// only the provenance does. Recording an empty override instead would leave
				// the reference in place and the change offered again on every later
				// review, which is the one answer this decision must not produce.
				if (GRAPHIC_STYLE_SLOT_OWNED_KEYS[slot].length === 0) {
					delete (nextRefs as Record<string, unknown>)[slot];
					continue;
				}
				(nextRefs as Record<string, unknown>)[slot] = {
					entryId: ref.entryId,
					// The pins the author already had and this owner still holds, plus every
					// key the update was about to move. The same record an ordinary edit to
					// this slot would leave, by the same call (#229).
					overrides: authoredGraphicStyleOverrides(resolution, slot, ref.entryId, ref.overrides, current),
				};
				continue;
			}

			next = writeGraphicStyleSlot(next, slot, resolved);
		}

		return { ...next, styleRefs: nextRefs } as typeof next;
	});

	if (options.revision !== undefined && applied.styleSet)
		applied.styleSet = { ...applied.styleSet, revision: options.revision };

	return applied;
}

/* ────────────────────────────────────────────────
 * Compare
 * ──────────────────────────────────────────────── */

/**
 * Every property group a Graphic Style Set update would change in one composition.
 *
 * Empty means no update is available — the published entries already resolve to what
 * this composition renders. That is the whole test, and it is why renaming an entry,
 * adding one, or editing one this composition does not reference are all silent: none
 * of them changes a value here.
 */
export function graphicStyleUpdateChanges(
	graphic: BroadcastGraphicConfig,
	resolution: GraphicStyleSetResolution,
): GraphicStyleUpdateChange[] {
	const changes: GraphicStyleUpdateChange[] = [];
	const nodesById = new Map<string | null, GraphicStyleOwnerNode>([
		[null, graphic],
		...ownedItems(graphic).map(item => [item.id, item] as [string, GraphicStyleOwnerNode]),
	]);

	for (const owner of graphicStyleRefOwners(graphic)) {
		const node = nodesById.get(owner.itemId);
		if (!node)
			continue;

		for (const slot of GRAPHIC_STYLE_SLOT_APPLICATION_ORDER) {
			const ref = owner.refs[slot] as GraphicStyleRef | undefined;
			if (!ref || !graphicStyleOwnerSupportsSlot(node, slot))
				continue;

			const current = readGraphicStyleSlot(node, slot);
			const next = resolveGraphicStyleSlotValue(
				resolution,
				slot,
				ref.entryId,
				current,
				ref.overrides as Record<string, unknown> | undefined,
			);
			if (next === null || sameGraphicStyleValue(current, next))
				continue;

			changes.push({
				ownerItemId: owner.itemId,
				ownerLabel: owner.label,
				slot,
				entryId: ref.entryId,
				entryName: resolution.byId.get(ref.entryId)?.name ?? ref.entryId,
				current: current ?? null,
				next,
			});
		}
	}

	return changes;
}

/**
 * Whether one owner's slot already holds exactly what the published entries resolve
 * it to.
 *
 * The per-slot form of "no update is available here". {@link graphicStyleUpdateChanges}
 * is this same question asked of every slot in a composition, and the two agree by
 * construction because they resolve through the same call with the same arguments.
 *
 * It is asked of a *stored* composition rather than of a revision number, for the
 * reason the module header gives: a composition holds its resolved values inline, so
 * whether it is in step with a Style Set is answerable from the document alone. A
 * recorded revision that lags one the values already agree with is a number out of
 * date, not a pending change (#198).
 *
 * A slot this owner does not support, and one the resolution cannot honour, are both
 * false — not because they are known to differ but because there is nothing to
 * compare them against. Every caller is asking for permission to derive something
 * from the published entries, and no evidence must not grant it.
 */
export function graphicStyleSlotInStep(
	resolution: GraphicStyleSetResolution,
	slot: GraphicStyleSlot,
	ref: GraphicStyleRef,
	node: GraphicStyleOwnerNode,
): boolean {
	if (!graphicStyleOwnerSupportsSlot(node, slot))
		return false;

	const current = readGraphicStyleSlot(node, slot);
	const next = resolveGraphicStyleSlotValue(
		resolution,
		slot,
		ref.entryId,
		current,
		ref.overrides as Record<string, unknown> | undefined,
	);
	return next !== null && sameGraphicStyleValue(current, next);
}

/**
 * The keys of one reviewable change that actually move.
 *
 * A change is offered per property group, but only some of the group's keys are in
 * it — the rest are values the Style Set and this composition already agree on, and
 * showing them would bury the ones an author is deciding about. This is what a review
 * row states value by value, so the default answer is an informed one rather than a
 * guess about whether a row contains the author's own work (#162).
 *
 * A property group arriving where there was none is every key it carries, which is
 * the honest reading of "nothing became this".
 */
export function graphicStyleChangedKeys(current: unknown, next: unknown): string[] {
	const currentRecord = (current ?? {}) as Record<string, unknown>;
	const nextRecord = (next ?? {}) as Record<string, unknown>;
	return [...new Set([...Object.keys(currentRecord), ...Object.keys(nextRecord)])]
		.filter(key => !sameGraphicStyleValue(currentRecord[key], nextRecord[key]));
}

/* ────────────────────────────────────────────────
 * Bind, detach, replace
 * ──────────────────────────────────────────────── */

/**
 * The author's deviations from a preset, derived from what the owner currently holds.
 *
 * Used when a property control writes a value into a slot that already references an
 * entry: the edit is a deviation by definition, and this is what turns it into the
 * explicit property-level override the glossary requires. Keys that match the
 * preset produce nothing, so an author who edits a value and puts it back is not left
 * carrying an override that pins it.
 */
export function captureGraphicStyleOverrides(
	resolution: GraphicStyleSetResolution,
	slot: GraphicStyleSlot,
	entryId: string,
	current: unknown,
): Record<string, unknown> | undefined {
	const owned = GRAPHIC_STYLE_SLOT_OWNED_KEYS[slot];
	if (owned.length === 0)
		return undefined;

	const inherited = resolveGraphicStyleSlotValue(resolution, slot, entryId, current, undefined);
	if (inherited === null)
		return undefined;

	const inheritedRecord = inherited as Record<string, unknown>;
	const currentRecord = (current ?? {}) as Record<string, unknown>;
	const overrides: Record<string, unknown> = {};
	for (const key of owned) {
		if (!sameGraphicStyleValue(currentRecord[key], inheritedRecord[key]))
			overrides[key] = currentRecord[key];
	}
	return Object.keys(overrides).length === 0 ? undefined : overrides;
}

/**
 * Whether what an owner holds in one slot has moved away from the entry it follows.
 *
 * The question {@link captureGraphicStyleOverrides} answers key by key, asked of the
 * property group as a whole — which is the only form it has for a slot that owns no
 * keys, where a Graphic Fill is a discriminated union with no partial to deviate in.
 *
 * A reference the resolution cannot honour deviates from nothing: there is no preset
 * in front of it to disagree with, so the comparison has no answer and the safe one
 * is "unchanged". That keeps a Style Set which failed to load from being the reason a
 * composition is treated as having gone local.
 */
export function graphicStyleSlotDeviates(
	resolution: GraphicStyleSetResolution,
	slot: GraphicStyleSlot,
	entryId: string,
	current: unknown,
): boolean {
	const inherited = resolveGraphicStyleSlotValue(resolution, slot, entryId, current, undefined);
	return inherited !== null && !sameGraphicStyleValue(current, inherited);
}

/**
 * Drop every reference this composition makes to the named entries, keeping the
 * values they currently produce.
 *
 * "Freezing the resolved values" in the glossary's sense is nothing more than this:
 * the composition already stores its resolved values inline, so detaching is
 * removing the provenance and leaving the properties exactly where they are. Nothing
 * about the rendering changes, which is what makes detach a safe answer to a
 * deletion.
 *
 * Passing null detaches every reference and clears the Style Set link itself, which
 * is what deleting a whole Graphic Style Set does to each template linked to it.
 */
export function detachGraphicStyleRefs(
	graphic: BroadcastGraphicConfig,
	entryIds: readonly string[] | null,
): BroadcastGraphicConfig {
	const targeted = entryIds === null ? null : new Set(entryIds);

	const detached = mapStyleRefOwners(graphic, (owner, refs) => {
		const kept: GraphicStyleRefs = {};
		if (targeted !== null) {
			for (const slot of GRAPHIC_STYLE_SLOT_VALUES) {
				const ref = refs[slot] as GraphicStyleRef | undefined;
				if (ref && !targeted.has(ref.entryId))
					(kept as Record<string, unknown>)[slot] = ref;
			}
		}
		return { ...owner, styleRefs: kept } as typeof owner;
	});

	if (targeted === null)
		delete detached.styleSet;

	return detached;
}

/**
 * Repoint every reference to one entry at another.
 *
 * The overrides travel with the reference. An override says "this property group is
 * mine, not the preset's", and that stays true of the same property group under a
 * different preset — which is also why the replacement must be of the same kind, so
 * the overrides it carries still name keys the slot owns.
 */
export function replaceGraphicStyleRefs(
	graphic: BroadcastGraphicConfig,
	entryId: string,
	replacementEntryId: string,
): BroadcastGraphicConfig {
	return mapStyleRefOwners(graphic, (owner, refs) => {
		const next: GraphicStyleRefs = {};
		for (const slot of GRAPHIC_STYLE_SLOT_VALUES) {
			const ref = refs[slot] as GraphicStyleRef | undefined;
			if (!ref)
				continue;
			(next as Record<string, unknown>)[slot] = ref.entryId === entryId
				? { ...ref, entryId: replacementEntryId }
				: ref;
		}
		return { ...owner, styleRefs: next } as typeof owner;
	});
}
