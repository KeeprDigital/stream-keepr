import type {
	GraphicAssetId,
	GraphicAssetRevisionId,
	GraphicsDerivativeId,
	GraphicsIngestionOperationId,
	InstalledGraphicsTemplateId,
} from '~~/shared/types/graphicsAsset';
import { GraphicsAssetLibraryError } from './errors';

/**
 * An opaque domain identity minted from an untrusted edge.
 *
 * The refusal is classified rather than bare, because these minters run at API
 * boundaries where a blank path segment is a caller's malformed request, not
 * the installation's fault: `rethrowGraphicsAssetApiError` passes an
 * unclassified `Error` through untouched, which answered 500 (#316).
 *
 * Trimmed for the same reason `requiredActor` and `graphicsDiscrepancyId` are,
 * and #322 is what it cost not to be: a segment of nothing but spaces passed a
 * length test, minted an identity no row can carry, and 404'd downstream — so
 * the caller was told its request was fine and the asset was gone, rather than
 * that it had asked for nothing. The trimmed value is what is returned, so the
 * identity that goes on to the catalogue is the one that was validated.
 */
function requiredIdentity<T extends string>(value: string, label: string): T {
	const identity = value.trim();
	if (identity.length === 0)
		throw new GraphicsAssetLibraryError(`${label} cannot be empty`, 'invalid-ingestion-input');
	return identity as T;
}

export function graphicAssetId(value: string): GraphicAssetId {
	return requiredIdentity<GraphicAssetId>(value, 'Graphic Asset identity');
}

export function graphicAssetRevisionId(value: string): GraphicAssetRevisionId {
	return requiredIdentity<GraphicAssetRevisionId>(value, 'Graphic Asset Revision identity');
}

export function graphicsDerivativeId(value: string): GraphicsDerivativeId {
	return requiredIdentity<GraphicsDerivativeId>(value, 'Graphics Derivative identity');
}

export function graphicsIngestionOperationId(value: string): GraphicsIngestionOperationId {
	return requiredIdentity<GraphicsIngestionOperationId>(value, 'Graphics Ingestion Operation identity');
}

export function installedGraphicsTemplateId(value: string): InstalledGraphicsTemplateId {
	return requiredIdentity<InstalledGraphicsTemplateId>(value, 'Installed Graphics Template identity');
}
