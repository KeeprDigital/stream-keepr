import type { ScreenMode } from '~~/shared/types/enums';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_TOKENS, FOUNDATION_TOKENS, resolveThemeTokens } from '~~/shared/modules/theme';
import { screenModeHostTokens } from '~~/shared/screenModeDefinitions';
import { screenModeTokens } from '~~/shared/screenModes';
import { placeScreenThemeTokens, screenModeBindableFoundationTokens } from '~~/shared/screenThemeOverrides';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

// A Screen settings page renders every Theme Token its Screen may override
// exactly once: in the mounted settings group its Mode Token declares, in
// Background & Placement, or in the residual Screen-wide look (ADR-0071).

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

function declaredGroups(mode: ScreenMode): string[] {
	return [
		...new Set(Object.values(screenModeTokens(mode)).map(definition => definition.settingsGroup)),
	];
}

/** Every token the page renders for `mode` with `mounted` groups on it, duplicates kept. */
function rendered(mode: ScreenMode, mounted: readonly string[]): string[] {
	const placement = placeScreenThemeTokens(mode, mounted);
	return [
		...mounted.flatMap(group => placement.groups[group] ?? []),
		...placement.placement,
		...placement.screenWide.modeTokens,
		...placement.screenWide.foundationTokens,
	];
}

const MODES = SCREEN_MODE_VALUES.map(mode => [mode] as const);

describe('where a Screen settings page renders each Theme Token', () => {
	// Every Mode Token names a group, so mounting each group its mode names
	// leaves the Screen-wide look with Foundation Tokens only.
	it.each(MODES)('leaves no %s Mode Token in the Screen-wide look once every group is mounted', (mode) => {
		expect(placeScreenThemeTokens(mode, declaredGroups(mode)).screenWide.modeTokens).toEqual([]);
	});

	it.each(SCREEN_MODE_VALUES.flatMap(mode => [
		[mode, 'no group mounted', [] as string[]],
		[
			mode,
			'every group mounted',
			declaredGroups(mode),
		],
		[
			mode,
			'its first group mounted',
			declaredGroups(mode).slice(0, 1),
		],
	] as const))('places each %s token exactly once with %s', (mode, _case, mounted) => {
		const tokens = rendered(mode, mounted);

		expect(tokens).toHaveLength(new Set(tokens).size);
		expect([...tokens].sort()).toEqual(overridable(mode).sort());
	});

	it('keeps a Mode Token in the Screen-wide look until its group is mounted', () => {
		expect(placeScreenThemeTokens('standings', []).screenWide.modeTokens).toContain('standings.title-text');

		const mounted = placeScreenThemeTokens('standings', ['header']);

		expect(mounted.groups.header).toEqual(['standings.title-typography', 'standings.title-text', 'standings.title-divider']);
		expect(mounted.screenWide.modeTokens).not.toContain('standings.title-text');
		expect(mounted.screenWide.modeTokens).toContain('standings.surface');
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
		const placed = placeScreenThemeTokens(mode, []);

		expect(placed.placement).toEqual(placement);
		expect(placed.screenWide.foundationTokens).not.toContain('alignment');
	});
});
