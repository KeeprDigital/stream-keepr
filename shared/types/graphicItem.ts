export const MEDIA_GRAPHIC_ITEM_FIT_VALUES = ['contain', 'cover', 'fill'] as const;
export type MediaGraphicItemFit = typeof MEDIA_GRAPHIC_ITEM_FIT_VALUES[number];

export const MEDIA_GRAPHIC_ITEM_TARGET_COMPATIBILITY_VALUES = ['all-supported', 'chromium-transparency'] as const;

export interface GraphicFocalPosition {
	horizontal: number;
	vertical: number;
}
