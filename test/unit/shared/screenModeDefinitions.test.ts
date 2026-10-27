import { describe, expect, it } from 'vitest';
import {
	getScreenModeConfigurationPolicy,
	getScreenModeDefinition,
	getScreenModeSelectOptions,
} from '~~/shared/screenModeDefinitions';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

describe('screen Mode Definition module', () => {
	it('keeps each definition, its host, its policy and its select option in agreement', () => {
		const selectOptions = getScreenModeSelectOptions();

		for (const mode of SCREEN_MODE_VALUES) {
			const definition = getScreenModeDefinition(mode);

			expect(definition.mode).toBe(mode);
			expect(definition.host.kind).toBe(definition.displayType);
			expect(definition.configurationPolicy.displayType).toBe(definition.displayType);
			expect(selectOptions).toContainEqual({ label: definition.label, value: mode, icon: definition.icon });
		}
	});

	// A plain mode's host insets and aligns it; the rest render edge to edge, or fill their window.
	const PLAIN_MODES = [
		'card',
		'deck',
		'standings',
		'top-cut',
		'metagame',
		'top-cards',
		'player-history',
		'pairings',
		'archetype-spotlight',
		'head-to-head',
	];
	it.each(SCREEN_MODE_VALUES.map(mode => [
		mode,
		PLAIN_MODES.includes(mode)
			? ['inset', 'alignment']
			: [],
	] as const))('hosts %s consuming the Foundation Tokens %j itself', (mode, tokens) => {
		expect(getScreenModeDefinition(mode).host.foundationTokens).toEqual(tokens);
	});

	it.each([
		['broadcast-graphics', 'overlay', true],
		['feature-match-overlay', 'overlay', true],
		['standings', 'overlay', true],
		['feature-match', 'control', false],
	] as const)('hosts %s as %s, fitting its canvas to the viewport: %s', (mode, kind, fitToViewport) => {
		expect(getScreenModeDefinition(mode).host).toMatchObject({ kind, fitToViewport });
	});

	it('exposes overlay, fill, and key Screen Outputs for Broadcast Graphics', () => {
		const policy = getScreenModeConfigurationPolicy('broadcast-graphics');

		expect(policy.outputOptions.map(option => option.value)).toEqual(['overlay', 'fill', 'key']);
	});

	it('gives every graphics host the full Screen configuration width for its compositor', () => {
		expect(getScreenModeConfigurationPolicy('broadcast-graphics').fullWidthConfiguration).toBe(true);
		expect(getScreenModeConfigurationPolicy('feature-match-overlay').fullWidthConfiguration).toBe(true);
		expect(getScreenModeConfigurationPolicy('standings').fullWidthConfiguration).toBe(false);
	});

	it('keeps Feature Match Overlay output options in shared policy', () => {
		const policy = getScreenModeConfigurationPolicy('feature-match-overlay');

		expect(policy.outputOptions.map(option => option.value)).toEqual(['overlay', 'fill', 'key']);
	});
});
