import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { ScreenMediaSource } from '~~/shared/types/screenConfig';
import { screenMediaSourceReference } from '~~/shared/utils/graphicsAssetReferences';

/**
 * The URL a renderer draws a Screen Media Source from (ADR-0021): a library
 * revision through the Screen's own content URLs, so a Screen Output resolves it
 * exactly as it resolves any other revision the Screen publishes, and a Remote
 * Media URL as given. Empty means nothing to draw.
 */
export function screenMediaSourceUrl(
	source: ScreenMediaSource | undefined,
	contentUrl: (reference: GraphicAssetReference) => string,
): string {
	if (source?.kind === 'url')
		return source.url;
	const reference = screenMediaSourceReference(source);
	return reference
		? contentUrl(reference)
		: '';
}
