/**
 * Media Fit: how an image or video fills the box it is drawn in. One vocabulary
 * for every media host — Media Graphic Items, media treatment presets, image and
 * video Background Layers, and the Feature Match Overlay Frame's image and video.
 */
export const MEDIA_FIT_VALUES = ['cover', 'contain', 'fill'] as const;
export type MediaFit = typeof MEDIA_FIT_VALUES[number];

export const MEDIA_GRAPHIC_ITEM_TARGET_COMPATIBILITY_VALUES = ['all-supported', 'chromium-transparency'] as const;

export interface GraphicFocalPosition {
	horizontal: number;
	vertical: number;
}
