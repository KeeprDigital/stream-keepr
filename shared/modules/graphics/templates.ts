import type {
	BroadcastGraphicConfig,
	GraphicContainerAnimation,
	GraphicGroupChildConfig,
	GraphicItemConfig,
} from '../../types/graphics';
import { GRAPHIC_ANIMATION_PHASE_VALUES } from '../../types/graphics';
import { pruneGraphicAnimation } from './authoring';

/**
 * Saving a Broadcast Graphic as a Broadcast Graphic Template, and placing a
 * template back onto a Screen as an independent copy.
 *
 * Both directions are pure, and both are a *copy* rather than a link. That is the
 * whole substance of the artifact: a template is never live Screen state, and a
 * placed copy is never a view of a template. Nothing here returns a reference into
 * its input, so there is no shared structure that a later edit on either side
 * could reach across.
 *
 * ## Why placement regenerates every Graphic Item id
 *
 * A template's document carries the ids it was authored under, possibly on another
 * installation. Two things make reusing them wrong:
 *
 * - The compositor derives SVG element ids from them (`graphic-fill-<graphicId>-<itemId>`)
 *   and `url(#id)` resolves per *document*, so two copies of one template on one
 *   Screen would collide and the second would paint with the first's fills.
 * - Graphic Item ids are unique within one Broadcast Graphic and the Screen's write
 *   schema refuses a duplicate, so placing a template twice would be refused
 *   outright.
 *
 * Regeneration happens at placement rather than at save, because the template
 * document is the stable authored artifact — its ids are what a Template Package
 * carries and what a future revision is diffed against — while the placed copy's
 * ids exist only inside one Screen's stack.
 *
 * ## Regenerating ids means rewriting what names them
 *
 * A Graphic Animation Stagger is the one thing inside a Broadcast Graphic that
 * addresses a Graphic Item by id: a container — the Broadcast Graphic itself or a
 * Graphic Group — names an ordered subset of its direct items per lifecycle phase.
 * Every regenerated id therefore has to be rewritten there too, and the failure if
 * it is not is silent rather than loud: a stale stagger id is *ignored* at
 * projection by design, so an unrewritten copy would keep its recipes, lose its
 * choreography, and animate every staggered item together at offset zero with
 * nothing rejected and nothing to see. That is why the id map is built during the
 * copy and applied to both containers, and why the tests assert the new ids are
 * present rather than only that the old ones are gone.
 */

/** The template-side shape placement reads: the saved document under its own name. */
export interface PlaceableBroadcastGraphicTemplate {
	id: string;
	name: string;
	document: BroadcastGraphicConfig;
}

export interface PlaceBroadcastGraphicTemplateOptions {
	/** Fresh Graphic Item and Broadcast Graphic identities, one per call. */
	generateId: () => string;
	/** The Screen's current stack, so the copy is named distinctly within it. */
	existing: readonly BroadcastGraphicConfig[];
}

/** The next unused `<name> (n)` among names a Screen already carries. */
function distinctName(name: string, existing: readonly BroadcastGraphicConfig[]): string {
	const taken = new Set(existing.map(entry => entry.name));
	if (!taken.has(name))
		return name;
	let copy = 2;
	while (taken.has(`${name} (${copy})`))
		copy += 1;
	return `${name} (${copy})`;
}

/**
 * Copy one Graphic Item under a fresh id, recording what its old id became.
 *
 * The map is flat across both levels rather than one map per container. A stagger
 * only ever addresses its own direct items, so the levels never legitimately
 * overlap — and an id that addresses something other than a direct item is ignored
 * at projection whether it was rewritten or not, which is exactly the outcome the
 * template already had.
 */
function withFreshItemId<T extends GraphicItemConfig | GraphicGroupChildConfig>(
	item: T,
	generateId: () => string,
	idMap: Map<string, string>,
): T {
	const copied = structuredClone(item);
	copied.id = generateId();
	idMap.set(item.id, copied.id);
	if (copied.type === 'group')
		copied.children = copied.children.map(child => withFreshItemId(child, generateId, idMap));
	return copied;
}

/**
 * One container's Graphic Animation with its staggered subsets rewritten onto the
 * copy's Graphic Item ids.
 *
 * An id the copy has no item for is dropped, which is how a deletion already
 * treats one: the id named nothing before and it names nothing now, and carrying it
 * would leave the copy referencing an item that never existed in it. A phase whose
 * whole subset was stale loses its stagger, and an animation left with neither a
 * recipe nor a stagger is no animation at all — the same pruning the editor's own
 * authoring operations apply.
 */
function withRemappedStagger<T extends GraphicContainerAnimation>(
	animation: T | undefined,
	idMap: Map<string, string>,
): T | undefined {
	if (!animation?.stagger)
		return animation;

	const stagger: NonNullable<GraphicContainerAnimation['stagger']> = {};
	for (const phase of GRAPHIC_ANIMATION_PHASE_VALUES) {
		const entry = animation.stagger[phase];
		if (!entry)
			continue;
		const itemIds = entry.itemIds
			.map(id => idMap.get(id))
			.filter((id): id is string => id !== undefined);
		if (itemIds.length === 0)
			continue;
		stagger[phase] = { ...entry, itemIds };
	}

	return pruneGraphicAnimation({ ...animation, stagger });
}

/**
 * A Graphic Group with its own staggered subsets rewritten, and every other
 * Graphic Item untouched.
 *
 * An item with no Graphic Animation keeps no animation key at all. The shape is
 * persisted as JSON, so an explicitly `undefined` key is invisible on the wire but
 * present to every in-memory comparison — which is exactly the kind of difference
 * that makes a copy compare unequal to the design it came from.
 */
function withRemappedGroupStagger(item: GraphicItemConfig, idMap: Map<string, string>): GraphicItemConfig {
	if (item.type !== 'group' || !item.animation)
		return item;

	const animation = withRemappedStagger(item.animation, idMap);
	if (!animation) {
		const { animation: _dropped, ...rest } = item;
		return rest;
	}
	return { ...item, animation };
}

/**
 * The document a Broadcast Graphic Template stores for one placed Broadcast
 * Graphic.
 *
 * Everything the graphic declares travels: its Graphic Layer Order, its Graphic
 * Animation recipes and staggers, its Graphic Inputs with their defaults, and the
 * Graphic Source Selections and Graphic Input Bindings it was authored with. None
 * of it is live state — a Graphic Playout State, an accepted on-air value, an
 * animation phase in flight, and a selected Event Data entity all belong to the
 * Broadcast Graphics Live Session and are not part of a Broadcast Graphic's
 * configuration at all, so saving a template cannot capture them.
 */
export function broadcastGraphicTemplateDocument(
	graphic: BroadcastGraphicConfig,
): BroadcastGraphicConfig {
	return structuredClone(graphic);
}

/**
 * One placed Broadcast Graphic initialised from a Broadcast Graphic Template.
 *
 * The copy is fully unlinked: it carries no template identity, no revision, and no
 * update path back. Each Graphic Input default becomes this graphic's own declared
 * default — which is the value Live Control starts every field at — and the Graphic
 * Source Selections and Graphic Input Bindings are this graphic's own to edit or
 * remove without the template noticing.
 *
 * Media Graphic Item Graphic Asset References are copied exactly, pinned revision
 * and recorded video compatibility together. They must stay *authored* references
 * on the Screen: a Screen Output Asset Capability is derived from the Screen's
 * authored configuration, so a reference the placed graphic did not author is a
 * reference its outputs could not resolve.
 */
export function placeBroadcastGraphicTemplate(
	template: PlaceableBroadcastGraphicTemplate,
	options: PlaceBroadcastGraphicTemplateOptions,
): BroadcastGraphicConfig {
	const document = template.document;
	const graphicId = options.generateId();
	const idMap = new Map<string, string>();
	const items = document.items.map(item => withFreshItemId(item, options.generateId, idMap));

	const placed: BroadcastGraphicConfig = {
		id: graphicId,
		name: distinctName(template.name, options.existing),
		// Every id is known before any stagger is rewritten: a container's subset may
		// name items later in its own list than itself.
		items: items.map(item => withRemappedGroupStagger(item, idMap)),
	};

	// Absent stays absent: a graphic that declares no Graphic Inputs and enables no
	// Graphic Animation carries no key at all, and placement must not invent one the
	// author never wrote.
	const animation = withRemappedStagger(document.animation, idMap);
	if (animation)
		placed.animation = animation;
	if (document.inputs)
		placed.inputs = structuredClone(document.inputs);
	if (document.sources)
		placed.sources = structuredClone(document.sources);
	if (document.bindings)
		placed.bindings = structuredClone(document.bindings);

	return placed;
}
