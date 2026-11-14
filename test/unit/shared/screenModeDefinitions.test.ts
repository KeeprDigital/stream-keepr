import { describe, expect, it } from 'vitest';
import { BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES } from '~~/shared/builtInFeatureMatchLayoutTemplates';
import { getDisplayResetForMode, getScreenModeConfigurationPolicy, getScreenModeSelectOptions } from '~~/shared/screenModeDefinitions';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

describe('screen Mode Definition module', () => {
	// An OP Event has no results, so it is offered only the modes that work without them: its
	// Metagame reads participation only (ADR-0074), and Talent needs neither.
	it.each([
		['mtg-two-player', SCREEN_MODE_VALUES],
		[
			'op',
			[
				'background',
				'card',
				'deck',
				'top-cut',
				'feature-match',
				'feature-match-overlay',
				'broadcast-graphics',
				'metagame',
				'top-cards',
				'archetype-spotlight',
				'talent',
			],
		],
		// A Commander Event is its Feature Match Slots alone (ADR-0087).
		[
			'mtg-commander',
			[
				'background',
				'card',
				'deck',
				'feature-match',
				'feature-match-overlay',
				'broadcast-graphics',
				'talent',
			],
		],
	] as const)('offers a %s Event the Screen Modes %j', (kind, modes) => {
		expect(getScreenModeSelectOptions(kind).map(option => option.value)).toEqual(modes);
	});

	it('gives every graphics host the full Screen configuration width for its compositor', () => {
		expect(getScreenModeConfigurationPolicy('broadcast-graphics').fullWidthConfiguration).toBe(true);
		expect(getScreenModeConfigurationPolicy('feature-match-overlay').fullWidthConfiguration).toBe(true);
		expect(getScreenModeConfigurationPolicy('standings').fullWidthConfiguration).toBe(false);
	});

	// A display reset lands on a layout the Event is offered: four Seats on a Commander Event (ADR-0087).
	it.each([
		['mtg-two-player', 'left-stacked-player-cams'],
		['mtg-commander', 'commander-table'],
	] as const)('resets a Feature Match Overlay on a %s Event to the %s built-in', (kind, builtIn) => {
		const reset = getDisplayResetForMode('feature-match-overlay', { featureMatchId: 7 }, 0, kind);

		expect(reset.layout).toEqual(BUILT_IN_FEATURE_MATCH_LAYOUT_TEMPLATES.find(template => template.id === builtIn)!.config.layout);
		expect(reset).not.toHaveProperty('featureMatchId');
	});
});
