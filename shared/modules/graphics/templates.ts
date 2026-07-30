import type {
	BroadcastGraphicConfig,
	GraphicGroupChildConfig,
	GraphicItemConfig,
} from '../../types/graphics';

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

function withFreshItemId<T extends GraphicItemConfig | GraphicGroupChildConfig>(
	item: T,
	generateId: () => string,
): T {
	const copied = structuredClone(item);
	copied.id = generateId();
	if (copied.type === 'group')
		copied.children = copied.children.map(child => withFreshItemId(child, generateId));
	return copied;
}

/**
 * The document a Broadcast Graphic Template stores for one placed Broadcast
 * Graphic.
 *
 * Everything the graphic declares travels: its Graphic Layer Order, its Graphic
 * Inputs with their defaults, and the Graphic Source Selections and Graphic Input
 * Bindings it was authored with. None of it is live state — a Graphic Playout
 * State, an accepted on-air value, and a selected Event Data entity all belong to
 * the Broadcast Graphics Live Session and are not part of a Broadcast Graphic's
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
	const placed: BroadcastGraphicConfig = {
		id: options.generateId(),
		name: distinctName(template.name, options.existing),
		items: document.items.map(item => withFreshItemId(item, options.generateId)),
	};

	// Absent stays absent: a graphic that declares no Graphic Inputs carries no key
	// at all, and placement must not invent an empty list the author never wrote.
	if (document.inputs)
		placed.inputs = structuredClone(document.inputs);
	if (document.sources)
		placed.sources = structuredClone(document.sources);
	if (document.bindings)
		placed.bindings = structuredClone(document.bindings);

	return placed;
}
