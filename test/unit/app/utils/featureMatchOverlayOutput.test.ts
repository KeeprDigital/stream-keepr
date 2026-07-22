import { describe, expect, it } from 'vitest';
import { featureMatchOverlayOutputBackground, parseFeatureMatchOverlayOutput } from '~/utils/featureMatchOverlayOutput';

describe('broadcast layout output utilities', () => {
	it('accepts known output values', () => {
		expect(parseFeatureMatchOverlayOutput('overlay').output).toBe('overlay');
		expect(parseFeatureMatchOverlayOutput('fill').output).toBe('fill');
		expect(parseFeatureMatchOverlayOutput('key').output).toBe('key');
	});

	it('uses the first query value when multiple are supplied', () => {
		expect(parseFeatureMatchOverlayOutput(['key', 'fill']).output).toBe('key');
	});

	it('uses black backgrounds for fill and key captures only', () => {
		expect(featureMatchOverlayOutputBackground('overlay')).toBeUndefined();
		expect(featureMatchOverlayOutputBackground('fill')).toBe('#000000');
		expect(featureMatchOverlayOutputBackground('key')).toBe('#000000');
	});
});
