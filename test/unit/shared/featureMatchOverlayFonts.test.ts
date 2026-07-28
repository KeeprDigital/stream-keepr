import { describe, expect, it } from 'vitest';
import {
	FEATURE_MATCH_OVERLAY_FONTS,
	getFeatureMatchOverlayFontDefinition,
	graphicAssetFontFaceFamily,
	resolveFeatureMatchOverlayFontSelection,
} from '~~/shared/featureMatchOverlayFonts';

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
		expect(resolveFeatureMatchOverlayFontSelection({
			kind: 'application',
			fontId: 'saira-condensed',
		})).toBe('var(--font-saira-condensed)');
	});

	it('does not resolve unknown application font capabilities to CSS', () => {
		expect(resolveFeatureMatchOverlayFontSelection({
			kind: 'application',
			fontId: 'Impact, Arial Black, sans-serif',
		})).toBeUndefined();
		expect(resolveFeatureMatchOverlayFontSelection(undefined)).toBeUndefined();
	});

	it('resolves exact font Graphic Asset Revisions to isolated FontFace families', () => {
		const reference = {
			assetId: 'font/asset' as never,
			revisionId: 'revision:7' as never,
		};
		expect(graphicAssetFontFaceFamily(reference))
			.toBe('stream-keepr-graphic-asset-font_asset-revision_7');
		expect(resolveFeatureMatchOverlayFontSelection({
			kind: 'asset',
			reference,
		})).toBe('"stream-keepr-graphic-asset-font_asset-revision_7"');
		expect(resolveFeatureMatchOverlayFontSelection({
			kind: 'application',
			fontId: 'inter',
		})).toBe('var(--font-inter)');
	});
});
