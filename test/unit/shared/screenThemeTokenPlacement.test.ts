import type { ScreenMode } from '~~/shared/types/enums';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_TOKENS, FOUNDATION_TOKENS, resolveThemeTokens } from '~~/shared/modules/theme';
import { screenModeHostTokens } from '~~/shared/screenModeDefinitions';
import { screenModeTokens } from '~~/shared/screenModes';
import { placeScreenThemeTokens, screenModeBindableFoundationTokens } from '~~/shared/screenThemeOverrides';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

// A Screen settings page renders every Theme Token its Screen may override
// exactly once: a Mode Token in the Screen Settings Group it names, a host
// token in Background & Placement, any other Foundation Token in the
// Screen-wide look (ADR-0072).

/** What the page lists, from the mode's declaration alone. */
function overridable(mode: ScreenMode): string[] {
	const { consumed } = resolveThemeTokens({
		vocabulary: FOUNDATION_TOKENS,
		modeTokens: screenModeTokens(mode),
		theme: DEFAULT_THEME_TOKENS,
		overrides: DEFAULT_THEME_TOKENS,
		hostTokens: screenModeHostTokens(mode),
	});
	return [
		...new Set([
			...consumed,
			...screenModeBindableFoundationTokens(mode),
		]),
	];
}

const MODES = SCREEN_MODE_VALUES.map(mode => [mode] as const);

describe('where a Screen settings page renders each Theme Token', () => {
	it.each(MODES)('places each %s token exactly once', (mode) => {
		const placed = placeScreenThemeTokens(mode);
		const tokens = [
			...Object.values(placed.groups).flat(),
			...placed.placement,
			...placed.foundationTokens,
		];

		expect(tokens).toHaveLength(new Set(tokens).size);
		expect([...tokens].sort()).toEqual(overridable(mode).sort());
	});

	it.each(MODES)('places every %s Mode Token in a Screen Settings Group, and nothing else there', (mode) => {
		const placed = placeScreenThemeTokens(mode);

		expect(Object.values(placed.groups).flat().sort()).toEqual(Object.keys(screenModeTokens(mode)).sort());
	});

	it('places a Mode Token in the group it names, in declaration order', () => {
		const placed = placeScreenThemeTokens('pairings');

		expect(placed.groups).toEqual({
			'result-badge': ['pairings.result-reported', 'pairings.result-pending', 'pairings.result-bye'],
		});
		expect(placed.foundationTokens).toContain('caution');
	});

	it.each([
		[
			'a plain overlay mode',
			'pairings',
			['inset', 'alignment'],
		],
		['a graphics host', 'broadcast-graphics', []],
		['an operator surface', 'feature-match', []],
	] as const)('puts the Screen inset and alignment in Background & Placement on %s', (_case, mode, placement) => {
		const placed = placeScreenThemeTokens(mode);

		expect(placed.placement).toEqual(placement);
		expect(placed.foundationTokens).not.toContain('alignment');
	});
});
