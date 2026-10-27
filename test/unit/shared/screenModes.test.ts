import { describe, expect, it } from 'vitest';
import { getDisplayType, SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

describe('screen mode definitions', () => {
	it('defines every Screen Mode in the vocabulary, and no retired one', () => {
		expect(Object.keys(SCREEN_MODES)).toEqual([...SCREEN_MODE_VALUES]);
		expect(Object.keys(SCREEN_MODES)).not.toContain('idle');
	});

	it('treats only Feature Match Controls as a control mode; every other mode is an overlay', () => {
		for (const mode of SCREEN_MODE_VALUES) {
			expect(getDisplayType(mode), mode).toBe(mode === 'feature-match'
				? 'control'
				: 'overlay');
		}
	});
});
