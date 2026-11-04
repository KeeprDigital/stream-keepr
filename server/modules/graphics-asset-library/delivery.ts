/**
 * Graphics Asset delivery: answering whether an exact Graphic Asset Revision,
 * or an asset's preview, can be served now, and serving its bytes.
 *
 * It owns three rules every reader relies on (ADR-0073):
 * - Bytes are served only while the canonical store agrees with the
 *   catalogue, by the one definition reconciliation also applies.
 * - A revision the catalogue does not hold is `missing`, never another
 *   revision; bytes it holds but the store cannot produce are retryably
 *   `unavailable`.
 * - A contradiction the store answered with is reported for Graphics
 *   Reconciliation, and the report never changes or fails the read.
 */

import type {
	GraphicAsset,
	GraphicAssetCanonicalMime,
	GraphicAssetId,
	GraphicAssetReferenceStatus,
	GraphicAssetRevisionId,
} from '~~/shared/types/graphicsAsset';
import type { GraphicsAssetCatalogueHealth } from '.';
import type {
	GraphicsCanonicalObjectStore,
	GraphicsObjectStoreHealth,
} from './object-store';
import { canonicalContentIdentity, canonicalObjectAgreement } from './canonical-integrity';
import { catalogueRequest } from './catalogue-request';
import { GraphicsAssetLibraryError } from './errors';

/** What the catalogue records about one revision's content. */
export interface GraphicsRevisionContent {
	digest: string;
	byteLength: number;
	canonicalMime: GraphicAssetCanonicalMime;
	kind: 'image' | 'silent-video' | 'font';
	lifecycleState: 'active' | 'retired' | 'trashed';
	/** The catalogue metadata snapshot a Template Package carries as provenance. */
	name: string;
	revisionNumber: number;
	compatibilityProfile: string;
	facts: GraphicAsset['facts'];
}

/**
 * The catalogue reads delivery needs. `findRevisionContent` answers the
 * metadata snapshot a Template Package also reads, so its shape is wider than
 * delivery itself uses.
 */
export interface GraphicsAssetDeliveryCatalogue {
	findRevisionContent: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) => Promise<GraphicsRevisionContent | undefined>;
	/**
	 * `findRevisionContent`, set-wise: one lookup for every pair an authored
	 * save changes, because paying one catalogue round-trip per reference is
	 * what put the documented-cap save at ~90 s on deployed remote D1 (#374).
	 *
	 * Input pairs are treated as a set — duplicates resolve to one row — and a
	 * pair that does not resolve contributes no row rather than a hole.
	 */
	findRevisionContents: (references: Array<{
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}>) => Promise<Array<GraphicsRevisionContent & {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}>>;
	/**
	 * The preview content for one Graphic Asset, with the facts a reader needs to
	 * prove the stored object is the one the catalogue recorded.
	 */
	findThumbnailContent: (assetId: GraphicAssetId) => Promise<{
		digest: string;
		byteLength: number;
		canonicalMime: GraphicAssetCanonicalMime;
	} | undefined>;
}

/** What a reader saw contradict the catalogue: one exact revision, or one content. */
export type GraphicsCanonicalDisagreement
	= | { assetId: GraphicAssetId; revisionId: GraphicAssetRevisionId }
		| { digest: string };

export interface GraphicsAssetDelivery {
	inspectGraphicAssetRevision: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) => Promise<GraphicAssetReferenceStatus>;
	/**
	 * `inspectGraphicAssetRevision`, set-wise: every reference an authored save
	 * changes, answered in one catalogue round-trip plus one canonical
	 * observation per distinct content digest — never one of each per
	 * reference, which is what put the documented-cap save at ~90 s (#374).
	 *
	 * Statuses align with the input by index; duplicate pairs share one
	 * resolution.
	 */
	inspectGraphicAssetRevisions: (input: {
		references: Array<{
			assetId: GraphicAssetId;
			revisionId: GraphicAssetRevisionId;
		}>;
	}) => Promise<GraphicAssetReferenceStatus[]>;
	inspectGraphicAssetRevisionContent: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) => Promise<
		| {
			outcome: 'available';
			byteLength: number;
			contentType: GraphicAssetCanonicalMime;
		}
		| { outcome: 'missing' }
		| { outcome: 'unavailable'; retryable: true }
	>;
	resolveGraphicAssetRevision: (input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
		range?: { offset: number; length: number };
	}) => Promise<
		| {
			outcome: 'available';
			body: ReadableStream<Uint8Array>;
			byteLength: number;
			contentType: GraphicAssetCanonicalMime;
		}
		| { outcome: 'missing' }
		| { outcome: 'unavailable'; retryable: true }
	>;
	resolveGraphicAssetThumbnail: (input: {
		assetId: GraphicAssetId;
	}) => Promise<
		| {
			outcome: 'available';
			body: ReadableStream<Uint8Array>;
			byteLength: number;
			contentType: 'image/png';
		}
		| { outcome: 'missing' }
		| { outcome: 'unavailable'; retryable: true }
	>;
}

export interface GraphicsAssetDeliveryDependencies {
	/** Anything short of the delivery reads refuses every read with `graphics-asset-library-unavailable`. */
	catalogue: GraphicsAssetCatalogueHealth | GraphicsAssetDeliveryCatalogue;
	/** Anything short of a canonical store refuses every byte read with `graphics-asset-library-unavailable`. */
	canonical: GraphicsObjectStoreHealth | GraphicsCanonicalObjectStore;
	/**
	 * Told of each contradiction a read observed; the read answers once this
	 * settles, so a reader that must not wait settles it at once and finishes
	 * the report elsewhere. A delivery without one observes nothing durable.
	 */
	reportDisagreement?: (observed: GraphicsCanonicalDisagreement) => Promise<void>;
}

type CanonicalContentFacts = Pick<GraphicsRevisionContent, 'digest' | 'byteLength' | 'canonicalMime'>;

/**
 * Canonical bytes are only usable when the store agrees with the catalogue in
 * every respect `canonicalObjectAgreement` checks — the same rule
 * reconciliation applies. Delivery and reconciliation deliberately share one
 * definition of agreement, so content reconciliation has isolated as a
 * critical integrity incident can never still be served on air.
 *
 * Any disagreement reads as unavailable rather than being served, so no
 * caller ever receives content that does not match its recorded facts.
 */
export async function readCanonicalContent(
	canonical: GraphicsCanonicalObjectStore,
	content: CanonicalContentFacts,
	range?: { offset: number; length: number },
): Promise<
	| { outcome: 'available'; body: ReadableStream<Uint8Array>; byteLength: number }
	| { outcome: 'unavailable'; retryable: true; disagreement: boolean }
> {
	const result = await canonical.read(
		canonicalContentIdentity(content.digest),
		range,
	);
	if (
		result.outcome !== 'available'
		|| canonicalObjectAgreement(content, result.object).outcome !== 'agrees'
		|| result.range.completeLength !== content.byteLength
		|| (
			range !== undefined
			&& (result.range.offset !== range.offset || result.range.length !== range.length)
		)
	) {
		return {
			outcome: 'unavailable',
			retryable: true,
			// A store that could not answer proves nothing about this object; a
			// store that answered and disagreed is a real integrity observation
			// worth reconciling.
			disagreement: result.outcome !== 'unavailable',
		};
	}
	return {
		outcome: 'available',
		body: result.body,
		byteLength: result.object.byteLength,
	};
}

/** `readCanonicalContent`'s agreement, proven from metadata without reading the bytes. */
export async function observeCanonicalContent(
	canonical: GraphicsCanonicalObjectStore,
	content: CanonicalContentFacts,
): Promise<
	{ outcome: 'available' } | { outcome: 'unavailable'; disagreement: boolean }
> {
	const result = await canonical.readMetadata(
		canonicalContentIdentity(content.digest),
	);
	if (
		result.outcome === 'available'
		&& canonicalObjectAgreement(content, result.object).outcome === 'agrees'
	) {
		return { outcome: 'available' };
	}
	return { outcome: 'unavailable', disagreement: result.outcome !== 'unavailable' };
}

/**
 * The `available` reference status both inspect reads answer for a
 * resolvable, observed revision — one shape, so the set-wise batch can never
 * drift from the singular's answer.
 */
function availableReferenceStatus(
	content: Pick<GraphicsRevisionContent, 'lifecycleState' | 'kind'>,
): GraphicAssetReferenceStatus {
	return {
		outcome: 'available',
		lifecycleState: content.lifecycleState,
		kind: content.kind,
	};
}

export function createGraphicsAssetDelivery(
	dependencies: GraphicsAssetDeliveryDependencies,
): GraphicsAssetDelivery {
	function requireCatalogue(): GraphicsAssetDeliveryCatalogue {
		if (!('findRevisionContent' in dependencies.catalogue))
			throw new GraphicsAssetLibraryError('Graphics Asset catalogue is unavailable', 'graphics-asset-library-unavailable');
		return dependencies.catalogue;
	}

	function requireCanonical(): GraphicsCanonicalObjectStore {
		if (!('createImmutable' in dependencies.canonical))
			throw new GraphicsAssetLibraryError('Graphics Asset canonical byte store is unavailable', 'graphics-asset-library-unavailable');
		return dependencies.canonical;
	}

	/**
	 * The read has already decided its own outcome by this point, so a report
	 * only turns the observation into durable operational state.
	 */
	async function reportDisagreement(observed: GraphicsCanonicalDisagreement) {
		try {
			await dependencies.reportDisagreement?.(observed);
		}
		catch {
			// The scheduled pass re-observes the same disagreement, so a failure to
			// record it immediately only delays the alert.
		}
	}

	async function findRevisionContent(input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) {
		return await catalogueRequest(
			() => requireCatalogue().findRevisionContent({ assetId: input.assetId, revisionId: input.revisionId }),
			'Graphic Asset Revision lookup is temporarily unavailable',
		);
	}

	async function inspectRevision(input: {
		assetId: GraphicAssetId;
		revisionId: GraphicAssetRevisionId;
	}) {
		const content = await findRevisionContent(input);
		if (!content)
			return { outcome: 'missing' as const };
		const observation = await observeCanonicalContent(requireCanonical(), content);
		if (observation.outcome !== 'available') {
			if (observation.disagreement)
				await reportDisagreement({ assetId: input.assetId, revisionId: input.revisionId });
			return { outcome: 'unavailable' as const, retryable: true as const };
		}
		return { outcome: 'available' as const, content };
	}

	return {
		async inspectGraphicAssetRevision(input) {
			const inspected = await inspectRevision(input);
			return inspected.outcome === 'available'
				? availableReferenceStatus(inspected.content)
				: inspected;
		},
		async inspectGraphicAssetRevisions(input) {
			if (input.references.length === 0)
				return [];
			const contents = await catalogueRequest(
				() => requireCatalogue().findRevisionContents(input.references),
				'Graphic Asset Revision lookup is temporarily unavailable',
			);
			const contentByPair = new Map(
				contents.map(content => [`${content.assetId}\n${content.revisionId}`, content]),
			);
			// One observation per distinct digest: revisions sharing content share
			// the canonical object, so they cannot disagree with it differently.
			const contentByDigest = new Map(contents.map(content => [content.digest, content]));
			const observations = new Map(await Promise.all(
				[...contentByDigest].map(async ([digest, content]) =>
					[digest, await observeCanonicalContent(requireCanonical(), content)] as const),
			));
			for (const [digest, observation] of observations) {
				if (observation.outcome !== 'available' && observation.disagreement)
					await reportDisagreement({ digest });
			}
			return input.references.map((reference) => {
				const content = contentByPair.get(`${reference.assetId}\n${reference.revisionId}`);
				if (!content)
					return { outcome: 'missing' };
				if (observations.get(content.digest)?.outcome !== 'available')
					return { outcome: 'unavailable', retryable: true };
				return availableReferenceStatus(content);
			});
		},
		async inspectGraphicAssetRevisionContent(input) {
			const inspected = await inspectRevision(input);
			return inspected.outcome === 'available'
				? {
						outcome: 'available',
						byteLength: inspected.content.byteLength,
						contentType: inspected.content.canonicalMime,
					}
				: inspected;
		},
		async resolveGraphicAssetRevision(input) {
			const content = await findRevisionContent(input);
			if (!content)
				return { outcome: 'missing' };
			const result = await readCanonicalContent(requireCanonical(), content, input.range);
			if (result.outcome !== 'available') {
				if (result.disagreement)
					await reportDisagreement({ assetId: input.assetId, revisionId: input.revisionId });
				return { outcome: 'unavailable', retryable: true };
			}
			return {
				outcome: 'available',
				body: result.body,
				byteLength: result.byteLength,
				contentType: content.canonicalMime,
			};
		},
		async resolveGraphicAssetThumbnail(input) {
			const content = await catalogueRequest(
				() => requireCatalogue().findThumbnailContent(input.assetId),
				'Graphic Asset preview lookup is temporarily unavailable',
			);
			// No Graphics Derivative recorded at all is genuinely missing. Bytes the
			// catalogue does expect but the store cannot produce are a retryable
			// operational failure, not an absent preview: reporting those as missing
			// would tell a caller there is nothing to show when there is.
			if (!content)
				return { outcome: 'missing' };
			const result = await readCanonicalContent(requireCanonical(), content);
			if (result.outcome !== 'available') {
				if (result.disagreement)
					await reportDisagreement({ digest: content.digest });
				return { outcome: 'unavailable', retryable: true };
			}
			return {
				outcome: 'available',
				body: result.body,
				byteLength: result.byteLength,
				contentType: 'image/png',
			};
		},
	};
}
