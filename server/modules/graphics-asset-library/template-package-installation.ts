import type {
	GraphicAssetReference,
	InstalledGraphicsTemplateKind,
} from '~~/shared/types/graphicsAsset';
import type {
	TemplatePackageKind,
	TemplatePackagePreflightMapping,
} from '~~/shared/types/templatePackage';

/**
 * The provider-independent half of Template Package installation: which local
 * artifact a package kind installs, how a packaged reference becomes a local
 * one, and where in the received Template document each rewritten reference
 * sits.
 *
 * Nothing here reads bytes, touches a catalogue, or knows a storage provider, so
 * the rewrite a publication commits is a pure function of the document the
 * package carried and the mappings its author confirmed.
 */

const INSTALLED_TEMPLATE_KINDS = {
	skgraphic: 'broadcast-graphic',
	sklayout: 'feature-match-layout',
} as const satisfies Record<TemplatePackageKind, InstalledGraphicsTemplateKind>;

export function installedGraphicsTemplateKind(
	packageKind: TemplatePackageKind,
): InstalledGraphicsTemplateKind {
	return INSTALLED_TEMPLATE_KINDS[packageKind];
}

/** The owner slot a reference at the document root would occupy. */
const DOCUMENT_ROOT_SLOT = '$';

/**
 * The one key a packaged source identity and revision are matched by.
 *
 * Both halves are identifiers a sender chose, so a separator alone cannot
 * distinguish them: joining `"a b"` and `"c"` with a space produces the same key
 * as `"a"` and `"b c"`. Two unrelated packaged assets colliding on one key is
 * how a Template ends up pointing at the wrong local revision, so this is
 * unambiguous by construction rather than by an assumption about what a sender's
 * identifiers may contain.
 */
export function packagedOriginKey(input: {
	sourceAssetId: string;
	sourceRevisionId: string;
}): string {
	return JSON.stringify([input.sourceAssetId, input.sourceRevisionId]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

export interface TemplateDocumentRewrite {
	/** An independent copy whose every reference names a local identity and revision. */
	document: unknown;
	/** One rewritten reference per document path that carried one. */
	references: { ownerSlot: string; reference: GraphicAssetReference }[];
	/**
	 * Document paths carrying a reference no confirmed mapping accounts for.
	 * Preflight proves a package declares every reference its Template needs, so
	 * this is the assertion that the proposal being installed still covers the
	 * document it was derived from.
	 */
	unmapped: string[];
}

/**
 * Rewrites every Graphic Asset Reference a received Template document carries to
 * the exact local identity and revision its confirmed mapping produced.
 *
 * The walk matches the export-side inspection's path convention, so an owner
 * slot names the same field on both sides of a transfer. Rewriting produces a
 * new document rather than mutating the received one: the received copy is the
 * evidence a fingerprint was computed over, and installation must not disturb
 * it.
 */
export function rewriteTemplateDocumentReferences(
	document: unknown,
	localReferences: ReadonlyMap<string, GraphicAssetReference>,
): TemplateDocumentRewrite {
	const references: { ownerSlot: string; reference: GraphicAssetReference }[] = [];
	const unmapped: string[] = [];
	const rewritten = walkTemplateDocumentReferences(document, (value, ownerSlot) => {
		const local = localReferences.get(packagedOriginKey({
			sourceAssetId: value.assetId,
			sourceRevisionId: value.revisionId,
		}));
		if (!local) {
			unmapped.push(ownerSlot);
			return value;
		}
		references.push({ ownerSlot, reference: local });
		return {
			...value,
			assetId: local.assetId,
			revisionId: local.revisionId,
		};
	});
	return {
		document: rewritten,
		references,
		unmapped,
	};
}

/**
 * Every Graphic Asset Reference an installed Template document holds, at the
 * owner slots its installation indexed them under.
 *
 * Its document was rewritten to local identities before it was stored, so the
 * document alone records what it pins, and reinstalling a removed Installed
 * Graphics Template re-indexes exactly these (ADR-0068).
 */
export function installedTemplateDocumentReferences(
	document: unknown,
): { ownerSlot: string; reference: GraphicAssetReference }[] {
	const references: { ownerSlot: string; reference: GraphicAssetReference }[] = [];
	walkTemplateDocumentReferences(document, (value, ownerSlot) => {
		references.push({
			ownerSlot,
			reference: {
				assetId: value.assetId as GraphicAssetReference['assetId'],
				revisionId: value.revisionId as GraphicAssetReference['revisionId'],
			},
		});
		return value;
	});
	return references;
}

/**
 * Rebuilds `document`, handing every object carrying a Graphic Asset Reference to
 * `visit` with the owner slot its path names, and keeping what `visit` returns in
 * its place. One walk for rewriting a received document and for reading an
 * installed one, so an owner slot names the same field both times.
 */
function walkTemplateDocumentReferences(
	document: unknown,
	visit: (
		value: Record<string, unknown> & { assetId: string; revisionId: string },
		ownerSlot: string,
	) => Record<string, unknown>,
): unknown {
	function walk(value: unknown, path: string): unknown {
		if (Array.isArray(value))
			return value.map((item, index) => walk(item, `${path}[${index}]`));
		if (!isPlainObject(value))
			return value;
		const rebuilt: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			rebuilt[key] = walk(value[key], path
				? `${path}.${key}`
				: key);
		}
		const { assetId, revisionId } = value;
		if (typeof assetId !== 'string' || typeof revisionId !== 'string')
			return rebuilt;
		if (assetId.length === 0 || revisionId.length === 0)
			return rebuilt;
		return visit(
			{ ...rebuilt, assetId, revisionId },
			path === ''
				? DOCUMENT_ROOT_SLOT
				: path,
		);
	}
	return walk(document, '');
}

/**
 * The local identity and revision one confirmed mapping resolves to.
 *
 * An exact-origin mapping already names one; every other mapping names the
 * identities this installation is about to create for it. Resolving both through
 * one function is what makes a rewritten reference indifferent to which happened.
 */
export function templatePackageLocalReferences(
	mappings: readonly TemplatePackagePreflightMapping[],
	created: ReadonlyMap<string, GraphicAssetReference>,
): Map<string, GraphicAssetReference> {
	const resolved = new Map<string, GraphicAssetReference>();
	for (const mapping of mappings) {
		const reference = mapping.proposal === 'reuse-graphic-asset-revision'
			? mapping.reference
			: created.get(mapping.packagedId);
		if (reference)
			resolved.set(packagedOriginKey(mapping.origin), reference);
	}
	return resolved;
}
