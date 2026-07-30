import { describe, expect, it } from 'vitest';
import { screenOutputBackground } from '~~/shared/utils/screenOutput';

describe('broadcast layout export behavior', () => {
	it('keeps overlay export transparent by default', () => {
		expect(screenOutputBackground('overlay')).toBeUndefined();
	});

	it('flattens fill and key exports over black', () => {
		expect(screenOutputBackground('fill')).toBe('#000000');
		expect(screenOutputBackground('key')).toBe('#000000');
	});
});
