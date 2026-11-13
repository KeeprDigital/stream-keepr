import { describe, expect, it } from 'vitest';
import {
	getGraphicFontDefinition,
	GRAPHIC_FONT_IDS,
	GRAPHIC_FONT_OPTION_GROUPS,
	GRAPHIC_FONTS,
	graphicAssetFontFaceFamily,
	resolveGraphicFontFamily,
} from '~~/shared/modules/graphics/typography';

describe('shared graphics typography', () => {
	it('resolves an application font selection to its CSS font-family value', () => {
		expect(getGraphicFontDefinition('saira-condensed')?.label).toBe('Saira Condensed');
		expect(resolveGraphicFontFamily({ kind: 'application', fontId: 'saira-condensed' }))
			.toBe('var(--font-saira-condensed)');
		expect(resolveGraphicFontFamily({ kind: 'application', fontId: 'inter' }))
			.toBe('var(--font-inter)');
	});

	it.each([
		['roboto', true],
		['system-mono', false],
	])('resolves %s to its custom property, with a package only when packaged', (fontId, packaged) => {
		const definition = GRAPHIC_FONTS.find(font => font.id === fontId);
		expect(resolveGraphicFontFamily({ kind: 'application', fontId: fontId as never }))
			.toBe(`var(--font-${fontId})`);
		expect(definition?.package !== undefined).toBe(packaged);
	});

	it('offers every application font once, grouped, in registry order', () => {
		expect(GRAPHIC_FONT_OPTION_GROUPS.flatMap(group => group.options.map(option => option.value)))
			.toEqual([...GRAPHIC_FONT_IDS]);
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
