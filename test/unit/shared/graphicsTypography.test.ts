import { describe, expect, it } from 'vitest';
import {
	GRAPHIC_FONT_IDS,
	GRAPHIC_FONTS,
	getGraphicFontDefinition,
	graphicAssetFontFaceFamily,
	resolveGraphicFontFamily,
} from '~~/shared/modules/graphics/typography';

describe('shared graphics typography', () => {
	it('defines the one application font registry every graphics host shares', () => {
		expect(GRAPHIC_FONT_IDS).toEqual([
			'saira-condensed',
			'ibm-plex-sans',
			'inter',
			'inconsolata',
			'mplantin',
			'system-sans',
			'system-serif',
			'system-mono',
		]);
		expect(GRAPHIC_FONTS.map(font => font.id)).toEqual([...GRAPHIC_FONT_IDS]);
	});

	it('resolves an application font selection to its CSS font-family value', () => {
		expect(getGraphicFontDefinition('saira-condensed')?.label).toBe('Saira Condensed');
		expect(resolveGraphicFontFamily({ kind: 'application', fontId: 'saira-condensed' }))
			.toBe('var(--font-saira-condensed)');
		expect(resolveGraphicFontFamily({ kind: 'application', fontId: 'inter' }))
			.toBe('var(--font-inter)');
	});

	it('does not resolve unknown application font capabilities to CSS', () => {
		expect(resolveGraphicFontFamily({ kind: 'application', fontId: 'Impact, Arial Black' as never }))
			.toBeUndefined();
		expect(resolveGraphicFontFamily(undefined)).toBeUndefined();
	});

	it('resolves exact font Graphic Asset Revisions to isolated FontFace families', () => {
		const reference = {
			assetId: 'font/asset' as never,
			revisionId: 'revision:7' as never,
		};
		expect(graphicAssetFontFaceFamily(reference))
			.toBe('stream-keepr-graphic-asset-font_asset-revision_7');
		expect(resolveGraphicFontFamily({ kind: 'asset', reference }))
			.toBe('"stream-keepr-graphic-asset-font_asset-revision_7"');
	});
});
