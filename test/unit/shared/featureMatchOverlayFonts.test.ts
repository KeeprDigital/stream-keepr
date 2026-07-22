import { describe, expect, it } from 'vitest';
import {
	FEATURE_MATCH_OVERLAY_FONTS,
	getFeatureMatchOverlayFontDefinition,
	resolveFeatureMatchOverlayFontFamily,
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
		expect(resolveFeatureMatchOverlayFontFamily('saira-condensed')).toBe('var(--font-saira-condensed)');
	});

	it('preserves legacy raw CSS font-family stacks', () => {
		expect(resolveFeatureMatchOverlayFontFamily('Impact, Arial Black, sans-serif')).toBe('Impact, Arial Black, sans-serif');
		expect(resolveFeatureMatchOverlayFontFamily('')).toBeUndefined();
	});
});
