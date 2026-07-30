import { describe, expect, it } from 'vitest';
import { getContainerControls, getDisplayType, SCREEN_MODES } from '~~/shared/screenModes';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

describe('sCREEN_MODES', () => {
	it('has definitions for all screen modes', () => {
		const modes = Object.keys(SCREEN_MODES);
		expect(modes).toEqual([...SCREEN_MODE_VALUES]);
	});

	it('each mode has label, icon, displayType, description', () => {
		for (const mode of SCREEN_MODE_VALUES) {
			const def = SCREEN_MODES[mode];
			expect(def).toHaveProperty('label');
			expect(def).toHaveProperty('icon');
			expect(def).toHaveProperty('displayType');
			expect(def).toHaveProperty('description');
			expect(typeof def.label).toBe('string');
			expect(typeof def.icon).toBe('string');
			expect(typeof def.description).toBe('string');
		}
	});

	it('broadcast-graphics mode is an overlay mode with label, icon, and description', () => {
		expect(SCREEN_MODES['broadcast-graphics']).toMatchObject({
			label: 'Broadcast Graphics',
			displayType: 'overlay',
		});
		expect(SCREEN_MODES['broadcast-graphics'].icon).toBeTruthy();
		expect(SCREEN_MODES['broadcast-graphics'].description).toBeTruthy();
	});

	it('feature-match mode has control display type', () => {
		expect(SCREEN_MODES['feature-match'].displayType).toBe('control');
	});

	it('overlay modes are idle, card, deck, standings, topCut, metagame', () => {
		expect(SCREEN_MODES.idle.displayType).toBe('overlay');
		expect(SCREEN_MODES.card.displayType).toBe('overlay');
		expect(SCREEN_MODES.deck.displayType).toBe('overlay');
		expect(SCREEN_MODES.standings.displayType).toBe('overlay');
		expect(SCREEN_MODES.topCut.displayType).toBe('overlay');
		expect(SCREEN_MODES.metagame.displayType).toBe('overlay');
	});
});

describe('getContainerControls', () => {
	it('returns default container controls for standard overlay modes', () => {
		expect(getContainerControls('deck')).toEqual({
			dimensions: true,
			padding: true,
			textColors: true,
			background: true,
		});
	});

	it('hides generic padding, text color, and background controls for Broadcast Graphics', () => {
		expect(getContainerControls('broadcast-graphics')).toEqual({
			dimensions: true,
			padding: false,
			textColors: false,
			background: false,
		});
	});

	it('hides generic padding, text color, and background controls for Feature Match Overlay', () => {
		expect(getContainerControls('feature-match-overlay')).toEqual({
			dimensions: true,
			padding: false,
			textColors: false,
			background: false,
		});
	});
});

describe('getDisplayType', () => {
	it('returns overlay for idle', () => {
		expect(getDisplayType('idle')).toBe('overlay');
	});

	it('returns overlay for card', () => {
		expect(getDisplayType('card')).toBe('overlay');
	});

	it('returns overlay for deck', () => {
		expect(getDisplayType('deck')).toBe('overlay');
	});

	it('returns overlay for standings', () => {
		expect(getDisplayType('standings')).toBe('overlay');
	});

	it('returns overlay for topCut', () => {
		expect(getDisplayType('topCut')).toBe('overlay');
	});

	it('returns control for feature-match', () => {
		expect(getDisplayType('feature-match')).toBe('control');
	});

	it('returns overlay for metagame', () => {
		expect(getDisplayType('metagame')).toBe('overlay');
	});
});
