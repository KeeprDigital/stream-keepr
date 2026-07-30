import type { GraphicFontId } from '../../types/graphics';
import {
	FEATURE_MATCH_OVERLAY_FONT_IDS,
	FEATURE_MATCH_OVERLAY_FONTS,
	getFeatureMatchOverlayFontDefinition,
} from '../../featureMatchOverlayFonts';

/**
 * The one application font registry every graphics host shares. Graphic Asset
 * fonts from the Graphics Asset Library resolve through their own reference;
 * these are the fonts that ship with Stream Keepr.
 */

export const GRAPHIC_FONT_IDS = FEATURE_MATCH_OVERLAY_FONT_IDS;

export const GRAPHIC_FONT_OPTIONS = FEATURE_MATCH_OVERLAY_FONTS.map(font => ({
	label: font.label,
	value: font.id,
}));

export function resolveGraphicFontFamily(fontId: GraphicFontId | undefined): string | undefined {
	return getFeatureMatchOverlayFontDefinition(fontId)?.cssFamily;
}
