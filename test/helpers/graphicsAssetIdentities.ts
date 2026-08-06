import type {
	GraphicAssetId,
	GraphicAssetReference,
	GraphicAssetRevisionId,
} from '~~/shared/types/graphicsAsset';

/**
 * Branded Graphic Asset identities for fixtures that cannot reach the real
 * constructors.
 *
 * `graphicAssetId`/`graphicAssetRevisionId` live in the server-side asset
 * library. A server test should keep using those — they validate. A shared
 * module test has no business importing the server library, and an integration
 * test cannot import it at all, because `test/integration` resolves no `~~`
 * alias at runtime and only `import type` crosses that boundary. These mint the
 * same branded values from a literal so such a fixture names an identity once
 * instead of repeating a cast at every site.
 */
export function testGraphicAssetId(value: string): GraphicAssetId {
	return value as GraphicAssetId;
}

export function testGraphicAssetRevisionId(value: string): GraphicAssetRevisionId {
	return value as GraphicAssetRevisionId;
}

export function testGraphicAssetReference(assetId: string, revisionId: string): GraphicAssetReference {
	return {
		assetId: testGraphicAssetId(assetId),
		revisionId: testGraphicAssetRevisionId(revisionId),
	};
}
