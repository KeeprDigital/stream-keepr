import { describe, expect, it } from 'vitest';
import {
	FEATURE_MATCH_OVERLAY_FONTS,
	getFeatureMatchOverlayFontDefinition,
	graphicAssetFontFaceFamily,
} from '~~/shared/featureMatchOverlayFonts';
import { resolveGraphicFontFamily } from '~~/shared/modules/graphics/typography';

describe('feature match overlay fonts', () => {
	it('exposes registered font definitions for the overlay picker', () => {
		expect(FEATURE_MATCH_OVERLAY_FONTS.map(font => font.id)).toEqual([
			'saira-condensed',
			'ibm-plex-sans',
			'inter',
			'inconsolata',
			'mplantin',
			'system-sans',
			'system-serif',
			'system-mono',
		]);
	});

	it('resolves registered font ids to CSS font-family values', () => {
		expect(getFeatureMatchOverlayFontDefinition('saira-condensed')?.label).toBe('Saira Condensed');
		expect(resolveGraphicFontFamily('saira-condensed')).toBe('var(--font-saira-condensed)');
		expect(resolveGraphicFontFamily('inter')).toBe('var(--font-inter)');
	});

	it('does not resolve unknown application font capabilities to CSS', () => {
		expect(resolveGraphicFontFamily('Impact, Arial Black, sans-serif' as never)).toBeUndefined();
		expect(resolveGraphicFontFamily(undefined)).toBeUndefined();
	});

	it('resolves exact font Graphic Asset Revisions to isolated FontFace families', () => {
		const reference = {
			assetId: 'font/asset' as never,
			revisionId: 'revision:7' as never,
		};
		expect(graphicAssetFontFaceFamily(reference))
			.toBe('stream-keepr-graphic-asset-font_asset-revision_7');
	});
});
