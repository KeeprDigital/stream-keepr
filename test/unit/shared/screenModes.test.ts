import { describe, expect, it } from 'vitest';
import { getContainerControls, getDisplayType, SCREEN_MODES } from '~~/shared/screenModes';
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

describe('getContainerControls', () => {
	it.each([
		['deck', true],
		['broadcast-graphics', false],
		['feature-match-overlay', false],
	] as const)('gives %s generic padding, text colour and background controls: %s', (mode, generic) => {
		expect(getContainerControls(mode)).toEqual({
			dimensions: true,
			padding: generic,
			textColors: generic,
			background: generic,
		});
	});

	it('offers a mode on Mode Tokens no Screen text colours, which it no longer reads', () => {
		expect(getContainerControls('standings')).toEqual({
			dimensions: true,
			padding: true,
			textColors: false,
			background: true,
		});
	});
});
