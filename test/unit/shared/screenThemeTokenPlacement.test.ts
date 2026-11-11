import { describe, expect, it } from 'vitest';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { screenModeTokens } from '~~/shared/screenModes';
import { parseScreenThemeOverrideWrite, placeScreenThemeTokens } from '~~/shared/screenThemeOverrides';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

// A Screen settings page renders exactly the Theme Tokens an override write
// stores, each once: a Mode Token in the Screen Settings Group it names, a
// host token in Background & Placement (ADR-0072).

const MODES = SCREEN_MODE_VALUES.map(mode => [mode] as const);

describe('where a Screen settings page renders each Theme Token', () => {
	it.each(MODES)('places each %s token an override write stores, exactly once', (mode) => {
		const placed = placeScreenThemeTokens(mode);
		const tokens = [
			...Object.values(placed.groups).flat(),
			...placed.placement,
		];
		const stored = [
			...Object.keys(screenModeTokens(mode)),
			...Object.keys(FOUNDATION_TOKENS),
		].filter((name) => {
			const write = parseScreenThemeOverrideWrite(mode, name, null);
			return write.ok && !write.dropped;
		});

		expect(tokens).toHaveLength(new Set(tokens).size);
		expect([...tokens].sort()).toEqual(stored.sort());
	});

	it('places a Mode Token in the group it names, in declaration order', () => {
		const placed = placeScreenThemeTokens('pairings');

		expect(placed.groups).toEqual({
			'result-badge': ['pairings.result-reported', 'pairings.result-pending', 'pairings.result-bye'],
		});
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
		expect(placeScreenThemeTokens(mode).placement).toEqual(placement);
	});
});
