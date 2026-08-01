import type { GraphicMediaKind } from './graphics';

/**
 * The media kinds, named once for the whole vocabulary in `./graphics`. Aliased
 * here because Feature Match Overlay's presentation contract reads under this
 * name, and one set of kinds must not be declared twice.
 */
export type MediaGraphicItemKind = GraphicMediaKind;

export const MEDIA_GRAPHIC_ITEM_FIT_VALUES = ['contain', 'cover', 'fill'] as const;
export type MediaGraphicItemFit = typeof MEDIA_GRAPHIC_ITEM_FIT_VALUES[number];

export const MEDIA_GRAPHIC_ITEM_TARGET_COMPATIBILITY_VALUES = ['all-supported', 'chromium-transparency'] as const;

export interface GraphicFocalPosition {
	horizontal: number;
	vertical: number;
}

/**
 * Media clipping is not declared here. A Media Graphic Item clips with the Shared
 * Graphics Foundation's `ShapeGeometry` in `./graphics`, which is the only encoding
 * of the Shape Geometry glossary term.
 *
 * This file once carried a second one — `MediaClipShapeGeometry`, a tagged-union
 * corner treatment with an optional unsigned edge inset — for Feature Match
 * Overlay's own media presentation contract. That contract is gone: a Feature Match
 * Layout's composition is an ordinary shared Graphic Item tree, so both hosts clip
 * with the canonical encoding and the fork encoded nothing that was still stored.
 * It is removed rather than migrated because the signed slant it converged onto is
 * strictly more expressive: positive insets an edge's top vertex, negative its
 * bottom, and the fork could only ever inset the top. See issue #89.
 *
 * `test/unit/shared/graphicsShapeGeometryEncoding.test.ts` holds that line
 * structurally, because a fork is exactly what a name check does not catch.
 */
