import { describe, expect, it } from 'vitest';
import { featureMatchOverlayOutputBackground } from '~/utils/featureMatchOverlayOutput';

describe('broadcast layout export behavior', () => {
	it('keeps overlay export transparent by default', () => {
		expect(featureMatchOverlayOutputBackground('overlay')).toBeUndefined();
	});

	it('flattens fill and key exports over black', () => {
		expect(featureMatchOverlayOutputBackground('fill')).toBe('#000000');
		expect(featureMatchOverlayOutputBackground('key')).toBe('#000000');
	});
});
