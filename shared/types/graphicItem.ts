import type { GraphicAssetReference } from './graphicsAsset';

export type MediaGraphicItemKind = 'image' | 'silent-video';
export type MediaGraphicItemFit = 'contain' | 'cover' | 'fill';

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
 * Shared Graphics Foundation contract for image and silent-video Graphic
 * Items. Host-specific geometry, identity, and compatibility placement facts
 * extend this presentation contract.
 */
export interface MediaGraphicItemConfig {
	asset?: GraphicAssetReference;
	mediaKind: MediaGraphicItemKind;
	fit: MediaGraphicItemFit;
	focalPosition: GraphicFocalPosition;
	opacity: number;
	clipGeometry?: MediaClipShapeGeometry;
	loop?: boolean;
	playbackRate?: number;
}
