import type { GraphicAssetReference } from './graphicsAsset';

export type MediaGraphicItemKind = 'image' | 'silent-video';
export type MediaGraphicItemFit = 'contain' | 'cover' | 'fill';

export interface GraphicFocalPosition {
	horizontal: number;
	vertical: number;
}

export type ShapeGeometryCorner
	= | { kind: 'square' }
		| { kind: 'rounded'; size: number }
		| { kind: 'cut'; size: number };

export interface ShapeGeometry {
	topLeft: ShapeGeometryCorner;
	topRight: ShapeGeometryCorner;
	bottomRight: ShapeGeometryCorner;
	bottomLeft: ShapeGeometryCorner;
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
	clipGeometry?: ShapeGeometry;
	loop?: boolean;
	playbackRate?: number;
}
