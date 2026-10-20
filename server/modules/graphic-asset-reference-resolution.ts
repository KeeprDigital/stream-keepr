import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';

/**
 * The one SQL rule deciding whether a Graphic Asset Reference resolves at the
 * commit that writes it.
 *
 * Shared by every artifact that writes references through the reference index:
 * a Screen's referencing Screen Modes, its Broadcast Graphics Live Session, and
 * both graphics Template libraries (#614). A write asks the library first, but the
 * catalogue can change between that question and the commit, so the statement that
 * commits carries the rule too.
 */

/** Everything the resolution rule below asks about one Graphic Asset Reference. */
export interface GraphicAssetReferenceFacts {
	reference: GraphicAssetReference;
	allowRetired: boolean;
	kind: 'image' | 'silent-video' | 'font';
}

/**
 * Whether one Graphic Asset Reference resolves, as the `FROM … WHERE` tail of a
 * statement about the revision it names: the revision exists on the asset it
 * claims, the asset is still selectable, and its kind is the one the configuration
 * expects. Playback engines play no part: Chromium is the only supported engine
 * for transparent video (ADR-0020).
 *
 * Written against expressions rather than placeholders because the same rule is
 * asked in two shapes. Each index insert asks it about one reference with that
 * reference's facts bound as parameters; the configuration write asks it about
 * every reference at once, reading their facts out of a single bound JSON array.
 * Spelling it twice is how a retirement or kind rule comes to hold on the
 * insert and not on the precondition that admits it — which would be invisible,
 * because both statements ride in the same batch and only the precondition decides
 * whether the configuration commits.
 */
function resolvedGraphicAssetRevision(fact: {
	revisionId: string;
	assetId: string;
	allowRetired: string;
	kind: string;
}): string {
	return `
		FROM graphic_asset_revisions revision
		JOIN graphic_assets asset ON asset.id = revision.asset_id
			WHERE revision.id = ${fact.revisionId} AND revision.asset_id = ${fact.assetId}
				AND (asset.lifecycle_state = 'active' OR ${fact.allowRetired} = 1)
				AND asset.kind = ${fact.kind}
	`;
}

/**
 * The rule about one reference whose facts are bound as parameters, in the order
 * `graphicAssetReferenceBindings` produces them.
 *
 * The order is stated in one place and read in the other, so a fact added to the
 * rule cannot silently shift every later placeholder onto the wrong value.
 */
export const BOUND_GRAPHIC_ASSET_REFERENCE_RESOLUTION = resolvedGraphicAssetRevision({
	revisionId: '?',
	assetId: '?',
	allowRetired: '?',
	kind: '?',
});

export function graphicAssetReferenceBindings(fact: GraphicAssetReferenceFacts) {
	return [
		fact.reference.revisionId,
		fact.reference.assetId,
		fact.allowRetired ? 1 : 0,
		fact.kind,
	] as const;
}

/** The resolution rule read out of one bound JSON array's element, by alias. */
export function jsonElementGraphicAssetRevisionResolution(alias: string): string {
	return resolvedGraphicAssetRevision({
		revisionId: `json_extract(${alias}.value, '$.revisionId')`,
		assetId: `json_extract(${alias}.value, '$.assetId')`,
		allowRetired: `json_extract(${alias}.value, '$.allowRetired')`,
		kind: `json_extract(${alias}.value, '$.kind')`,
	});
}

/**
 * The same rule asked of every reference at once, out of one bound JSON array.
 *
 * A configuration's references are as many as the show needs — a Broadcast
 * Graphics Screen may carry hundreds of Graphic Items, each able to pin media and
 * a font — and D1 binds at most a hundred parameters per statement. Bound one
 * placeholder per fact this precondition cost eight parameters per reference and
 * failed the whole save at twelve of them, permanently, until an author removed
 * references (#303). Read out of a single bound array it costs one parameter
 * whatever the configuration holds, so the count decides nothing.
 *
 * Stated as "no required reference fails to resolve" rather than as a count, so a
 * single unresolvable reference among hundreds still refuses the save — which is
 * the compare-and-swap guarantee the encoding exists to keep, not to trade away.
 *
 * `server/modules/graphics-asset-library/catalogue-sql.ts` takes the same escape
 * for lists of scalars and carries the reasoning at length; this one carries a
 * list of records, so it reads fields out of each element rather than the element
 * itself.
 */
export const REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE = `
	AND NOT EXISTS (
		SELECT 1 FROM json_each(?) AS required
		WHERE NOT EXISTS (
			SELECT 1
			${jsonElementGraphicAssetRevisionResolution('required')}
		)
	)
`;

/**
 * One reference fact carrying the identity and owner slot of the index row the
 * authored write derives from it, so the precondition and the insert are bound
 * from one encoding.
 */
export interface IndexedGraphicAssetReferenceFacts extends GraphicAssetReferenceFacts {
	id: string;
	ownerSlot: string;
}

/**
 * The bind value for `REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE` and for the
 * index insert that reads the same array. Elements carry more fields than the
 * resolution rule asks about — the insert's row identity and owner slot ride in
 * the same array so the set the save is refused on and the set it indexes
 * cannot drift apart.
 */
export function boundGraphicAssetReferenceFacts(
	facts: readonly IndexedGraphicAssetReferenceFacts[],
): string {
	return JSON.stringify(facts.map(fact => ({
		id: fact.id,
		ownerSlot: fact.ownerSlot,
		revisionId: fact.reference.revisionId,
		assetId: fact.reference.assetId,
		allowRetired: fact.allowRetired ? 1 : 0,
		kind: fact.kind,
	})));
}
