import type { GraphicsDiscrepancyReasonCode } from '~~/shared/types/graphicsAsset';
import type { GraphicsObjectIdentity, GraphicsObjectMetadata } from './object-store';
import { GRAPHICS_CANONICAL_OBJECT_PREFIX } from '~~/shared/utils/graphicsAssetReconciliation';
import { graphicsObjectIdentity } from './object-store';

/**
 * The one place a canonical object's identity is built from its digest. Every
 * caller goes through it so no path can invent a different key shape.
 */
export function canonicalContentIdentity(digest: string): GraphicsObjectIdentity {
	return graphicsObjectIdentity(`${GRAPHICS_CANONICAL_OBJECT_PREFIX}${digest}`);
}

/** The catalogue's record of what a canonical object must be. */
export interface ExpectedCanonicalObject {
	digest: string;
	byteLength: number;
	canonicalMime: string;
}

export type CanonicalObjectAgreement
	= | { outcome: 'agrees' }
		| {
			outcome: 'mismatched';
			reasonCode: Extract<
				GraphicsDiscrepancyReasonCode,
				'canonical-object-facts-mismatch' | 'canonical-object-redundant-metadata-mismatch'
			>;
		};

/**
 * Whether one stored object is exactly what the catalogue recorded.
 *
 * This is the single definition of agreement in the library. Readers use it to
 * decide whether bytes may be served, and reconciliation uses it to decide
 * whether an object is healthy — so the two can never drift into a state where
 * reconciliation isolates content that delivery is still happily serving.
 *
 * Canonical objects are written with the digest that owns their key repeated in
 * their metadata. A missing or contradicting copy of it is a real integrity
 * conflict rather than a cosmetic difference: it is the same proof publication
 * already requires before it will reuse an existing object, so anything that
 * fails it could never have been published in that state.
 */
export function canonicalObjectAgreement(
	expected: ExpectedCanonicalObject,
	object: GraphicsObjectMetadata,
): CanonicalObjectAgreement {
	if (
		object.byteLength !== expected.byteLength
		|| object.contentType !== expected.canonicalMime
	) {
		return { outcome: 'mismatched', reasonCode: 'canonical-object-facts-mismatch' };
	}
	if (object.customMetadata.sha256 !== expected.digest)
		return { outcome: 'mismatched', reasonCode: 'canonical-object-redundant-metadata-mismatch' };
	return { outcome: 'agrees' };
}
