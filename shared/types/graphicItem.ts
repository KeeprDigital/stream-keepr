import type { GraphicAssetReference } from './graphicsAsset';

export const MEDIA_GRAPHIC_ITEM_KIND_VALUES = ['image', 'silent-video'] as const;
export type MediaGraphicItemKind = typeof MEDIA_GRAPHIC_ITEM_KIND_VALUES[number];

export const MEDIA_GRAPHIC_ITEM_FIT_VALUES = ['contain', 'cover', 'fill'] as const;
export type MediaGraphicItemFit = typeof MEDIA_GRAPHIC_ITEM_FIT_VALUES[number];

export const MEDIA_GRAPHIC_ITEM_TARGET_COMPATIBILITY_VALUES = ['all-supported', 'chromium-transparency'] as const;

export interface GraphicFocalPosition {
	horizontal: number;
	vertical: number;
}

/**
 * The Shape Geometry a Media Graphic Item clips to.
 *
 * Deliberately scoped rather than named for the shared vocabulary: the Shared
 * Graphics Foundation's `ShapeGeometry` lives in `shared/types/graphics.ts` and
 * encodes the same concept differently — a flat corner treatment, and a signed
 * edge slant that can inset either vertex rather than only the top. Both were
 * exported as `ShapeGeometry`, which left the auto-import layer silently choosing
 * one. Converging them changes a persisted shape and belongs with the work that
 * puts Feature Match Overlay on the shared vocabulary; see issue #89.
 */
export type MediaClipShapeGeometryCorner
	= | { kind: 'square' }
		| { kind: 'rounded'; size: number }
		| { kind: 'cut'; size: number };

export interface MediaClipShapeGeometry {
	topLeft: MediaClipShapeGeometryCorner;
	topRight: MediaClipShapeGeometryCorner;
	bottomRight: MediaClipShapeGeometryCorner;
	bottomLeft: MediaClipShapeGeometryCorner;
	leftEdgeSlant?: number;
	rightEdgeSlant?: number;
}

/**
 * Feature Match Overlay's media presentation contract, which its host-specific
 * geometry, identity, and compatibility placement facts extend.
 *
 * Deliberately not named for the shared vocabulary. The Shared Graphics
 * Foundation's own `MediaGraphicItemConfig` lives in `shared/types/graphics.ts`
 * and clips with the canonical `ShapeGeometry`, while this one clips with the
 * `MediaClipShapeGeometry` fork below. Both files are auto-imported, so two
 * exports of one name would leave the auto-import layer silently choosing — the
 * exact bug issue #89 records for `ShapeGeometry`. Converging the two encodings
 * belongs with Feature Match Overlay's adoption of the shared vocabulary (#78).
 *
 * The kind, fitting, and focal-position vocabulary above is genuinely shared and
 * has one home here; only the clipping encoding differs.
 */
export interface FeatureMatchMediaPresentationConfig {
	asset?: GraphicAssetReference;
	mediaKind: MediaGraphicItemKind;
	fit: MediaGraphicItemFit;
	focalPosition: GraphicFocalPosition;
	opacity: number;
	clipGeometry?: MediaClipShapeGeometry;
	loop?: boolean;
	playbackRate?: number;
}
