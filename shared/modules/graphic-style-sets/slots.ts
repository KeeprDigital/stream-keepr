import type {
	BroadcastGraphicConfig,
	GraphicAnimationPhase,
	GraphicItemConfig,
	GraphicSurfaceStyle,
} from '../../types/graphics';
import type {
	GraphicStyleEntryKind,
	GraphicStyleSlot,
} from '../../types/graphicStyleSet';
import type { ResolvedGraphicStyleValue } from './entries';
import { GRAPHIC_SURFACE_STYLE_SLOT_KINDS } from '../graphics/authoring';
import { createDefaultGraphicSurfaceStyle } from '../graphics/itemDefinitions';

/**
 * The bridge between a Graphic Style Set entry and the property group it inherits
 * into.
 *
 * A slot is a *named property group on one owner*, not a path. Reading and writing
 * one is deliberately a pair of small total functions rather than a generic object
 * walker: the Shared Graphics Foundation's item kinds carry these groups in
 * different places (a Media Graphic Item's clipping geometry is `clipGeometry`, a
 * Shape Graphic Item's own shape is `geometry`), and only a few kinds carry each.
 * A path walker would happily write `typography` onto a Shape Graphic Item and
 * produce a document the wire schema then refuses.
 *
 * ## Owned keys, and why absence clears
 *
 * Each slot has a fixed set of keys the entry owns. Applying a preset *replaces*
 * that whole set: a key the resolved preset does not carry is removed rather than
 * left behind, because a Graphic Surface Style preset whose glow the author deleted
 * has to be able to take the glow off the items that inherit it. The two exceptions
 * are keys the vocabulary requires to exist — a Graphic Surface Style always has a
 * fill, and a Media Graphic Item always has a playback rate and a loop flag — where
 * a preset that supplies none leaves the item's own value alone. Both are stated
 * where they happen rather than as a general "merge" rule, because a general merge
 * rule is exactly the thing that makes a removed glow un-removable.
 */

/** The entry kind each slot accepts. A slot never takes more than one kind. */
export const GRAPHIC_STYLE_SLOT_KINDS: Record<GraphicStyleSlot, GraphicStyleEntryKind> = {
	'typography': 'typography',
	'surfaceStyle': 'surface-style',
	'surfaceStyle.fill': 'fill',
	'defaultChildSurfaceStyle': 'surface-style',
	'boxSurfaceStyle': 'surface-style',
	'wonBoxSurfaceStyle': 'surface-style',
	'geometry': 'shape-geometry',
	'clipGeometry': 'shape-geometry',
	'boxGeometry': 'shape-geometry',
	'media': 'media-treatment',
	'animation.enter': 'animation-recipe',
	'animation.on-screen': 'animation-recipe',
	'animation.update': 'animation-recipe',
	'animation.exit': 'animation-recipe',
};

/**
 * The order slots are applied in: coarse first, so the finer statement wins.
 *
 * Two pairs overlap, and both resolve the same way. A Graphic Surface Style preset
 * may carry a Graphic Fill preset, so `surfaceStyle.fill` is applied after
 * `surfaceStyle`. A media treatment preset may carry a Shape Geometry preset for
 * clipping, so `clipGeometry` is applied after `media`. In both cases the author
 * bound the narrower slot to say something specific about that one property, and an
 * order that let the broader one win would silently discard it.
 */
export const GRAPHIC_STYLE_SLOT_APPLICATION_ORDER: readonly GraphicStyleSlot[] = [
	'typography',
	'surfaceStyle',
	'surfaceStyle.fill',
	'defaultChildSurfaceStyle',
	'boxSurfaceStyle',
	'wonBoxSurfaceStyle',
	'geometry',
	'boxGeometry',
	'media',
	'clipGeometry',
	'animation.enter',
	'animation.on-screen',
	'animation.update',
	'animation.exit',
];

const ANIMATION_SLOT_PHASES: Record<string, GraphicAnimationPhase> = {
	'animation.enter': 'enter',
	'animation.on-screen': 'on-screen',
	'animation.update': 'update',
	'animation.exit': 'exit',
};

/** The lifecycle phase an animation slot names, or null for every other slot. */
export function graphicStyleSlotPhase(slot: GraphicStyleSlot): GraphicAnimationPhase | null {
	return ANIMATION_SLOT_PHASES[slot] ?? null;
}

/**
 * Something that can reference a Graphic Style Set entry: one Graphic Item, or the
 * Broadcast Graphic itself.
 *
 * They are one type here because they carry references the same way and because the
 * one slot family they share — whole-composition motion — is written to the same
 * `animation` field. Everything else is item-only, and `graphicStyleOwnerSupportsSlot`
 * is what says so once rather than at every call site.
 */
export type GraphicStyleOwnerNode = GraphicItemConfig | BroadcastGraphicConfig;

/** The Graphic Item kind of an owner, or null for a Broadcast Graphic. */
function ownerKind(owner: GraphicStyleOwnerNode): GraphicItemConfig['type'] | null {
	return 'type' in owner ? owner.type : null;
}

/** The Graphic Item kinds that carry base typography. */
const TYPOGRAPHY_KINDS: readonly GraphicItemConfig['type'][]
	= ['text', 'clock', 'player-life', 'game-wins', 'deck-list'];

/**
 * Whether one owner can hold this slot at all.
 *
 * Binding is offered from the property control that already edits the group, so an
 * unsupported pairing should never arrive — but a stored document is not a UI, and
 * an import or a hand-written write can carry one. Every read and write goes through
 * this so an unsupported reference is inert rather than corrupting.
 *
 * A Broadcast Graphic supports the animation slots and nothing else: it has no
 * typography, surface, geometry, or media of its own to inherit into.
 */
export function graphicStyleOwnerSupportsSlot(owner: GraphicStyleOwnerNode, slot: GraphicStyleSlot): boolean {
	const kind = ownerKind(owner);
	switch (slot) {
		case 'typography':
			return kind !== null && TYPOGRAPHY_KINDS.includes(kind);
		// Which kinds own which surface is stated once, by the authoring module that
		// edits them. A second table here could drift into offering a style reference
		// for a surface the item does not have.
		case 'surfaceStyle':
		case 'surfaceStyle.fill':
			return kind !== null && GRAPHIC_SURFACE_STYLE_SLOT_KINDS.surfaceStyle.includes(kind);
		case 'boxSurfaceStyle':
		case 'wonBoxSurfaceStyle':
			return kind !== null && GRAPHIC_SURFACE_STYLE_SLOT_KINDS[slot].includes(kind);
		case 'defaultChildSurfaceStyle':
			return kind === 'group';
		case 'geometry':
			return kind === 'shape' || kind === 'group';
		case 'boxGeometry':
			return kind === 'game-wins';
		case 'clipGeometry':
		case 'media':
			return kind === 'media';
		default:
			return graphicStyleSlotPhase(slot) !== null;
	}
}

/**
 * The property group one slot currently holds, or undefined when the owner does not
 * carry it.
 *
 * Returned as it is stored rather than cloned: every caller either compares it or
 * spreads it into a new object, and the one that keeps it (`keep-as-override`)
 * clones at its own boundary where the intent to retain is explicit.
 */
export function readGraphicStyleSlot(
	owner: GraphicStyleOwnerNode,
	slot: GraphicStyleSlot,
): unknown {
	const phase = graphicStyleSlotPhase(slot);
	if (phase)
		return owner.animation?.[phase];
	if (!graphicStyleOwnerSupportsSlot(owner, slot))
		return undefined;

	const item = owner as GraphicItemConfig;
	switch (slot) {
		case 'typography':
			return (item as { typography?: unknown }).typography;
		case 'surfaceStyle':
			return (item as { surfaceStyle?: unknown }).surfaceStyle;
		case 'surfaceStyle.fill':
			return (item as { surfaceStyle?: { fill?: unknown } }).surfaceStyle?.fill;
		case 'defaultChildSurfaceStyle':
			return item.type === 'group' ? item.defaultChildSurfaceStyle : undefined;
		case 'boxSurfaceStyle':
			return item.type === 'game-wins' ? item.boxSurfaceStyle : undefined;
		case 'wonBoxSurfaceStyle':
			return item.type === 'game-wins' ? item.wonBoxSurfaceStyle : undefined;
		case 'geometry':
			return item.type === 'shape' || item.type === 'group' ? item.geometry : undefined;
		case 'clipGeometry':
			return item.type === 'media' ? item.clipGeometry : undefined;
		case 'boxGeometry':
			return item.type === 'game-wins' ? item.boxGeometry : undefined;
		case 'media':
			return item.type === 'media'
				? {
						fit: item.fit,
						focalPosition: item.focalPosition,
						opacity: item.opacity,
						...(item.clipGeometry === undefined ? {} : { clipGeometry: item.clipGeometry }),
						playbackRate: item.playbackRate,
						loop: item.loop,
					}
				: undefined;
		default:
			return undefined;
	}
}

/** The surface an item already has, or a fresh default for one that has none. */
function baseSurface(current: GraphicSurfaceStyle | undefined): GraphicSurfaceStyle {
	return current ? { ...current } : createDefaultGraphicSurfaceStyle();
}

/**
 * Write one slot's property group onto a Graphic Item, returning a new item.
 *
 * The value is whatever `resolveGraphicStyleSlotValue` produced: already merged with
 * the item's retained keys and the author's overrides. This function only decides
 * where* it goes.
 */
export function writeGraphicStyleSlot<T extends GraphicStyleOwnerNode>(
	owner: T,
	slot: GraphicStyleSlot,
	value: unknown,
): T {
	if (!graphicStyleOwnerSupportsSlot(owner, slot))
		return owner;

	const phase = graphicStyleSlotPhase(slot);
	if (phase)
		return { ...owner, animation: { ...owner.animation, [phase]: value } };

	const item = owner as unknown as GraphicItemConfig;
	switch (slot) {
		case 'typography':
			return { ...item, typography: value } as unknown as T;
		case 'surfaceStyle':
			return { ...item, surfaceStyle: value } as unknown as T;
		case 'surfaceStyle.fill':
			return {
				...item,
				surfaceStyle: {
					...baseSurface('surfaceStyle' in item ? item.surfaceStyle : undefined),
					fill: value,
				},
			} as unknown as T;
		case 'defaultChildSurfaceStyle':
			return { ...item, defaultChildSurfaceStyle: value } as unknown as T;
		case 'boxSurfaceStyle':
			return { ...item, boxSurfaceStyle: value } as unknown as T;
		case 'wonBoxSurfaceStyle':
			return { ...item, wonBoxSurfaceStyle: value } as unknown as T;
		case 'geometry':
			return { ...item, geometry: value } as unknown as T;
		case 'clipGeometry':
			return { ...item, clipGeometry: value } as unknown as T;
		case 'boxGeometry':
			return { ...item, boxGeometry: value } as unknown as T;
		case 'media': {
			// Written key by key rather than spread, because an absent clipping geometry
			// has to *remove* the one the item is carrying. A spread of an object that
			// simply lacks the key would leave a media treatment preset unable to stop
			// clipping the items that inherit it.
			const treatment = value as Record<string, unknown>;
			const next = { ...item } as Record<string, unknown>;
			next.fit = treatment.fit;
			next.focalPosition = treatment.focalPosition;
			next.opacity = treatment.opacity;
			next.playbackRate = treatment.playbackRate;
			next.loop = treatment.loop;
			if (treatment.clipGeometry === undefined)
				delete next.clipGeometry;
			else
				next.clipGeometry = treatment.clipGeometry;
			return next as unknown as T;
		}
		default:
			return owner;
	}
}

/**
 * Whether a resolved entry is the kind this slot accepts.
 *
 * Checked at every application rather than only at validation: a document can carry
 * a reference whose entry has been deleted and re-created under the same id with a
 * different kind, and inheriting a Shape Geometry into a typography property would
 * produce a document nothing can render.
 */
export function resolvedValueFitsSlot(
	resolved: ResolvedGraphicStyleValue,
	slot: GraphicStyleSlot,
): boolean {
	return resolved.kind === GRAPHIC_STYLE_SLOT_KINDS[slot];
}
