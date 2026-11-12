import { describe, expect, it } from 'vitest';
import { FOUNDATION_TOKENS } from '~~/shared/modules/theme';
import { screenModeConfigContract, screenModeTokens } from '~~/shared/screenModes';
import { parseScreenThemeOverrideWrite, placeScreenThemeTokens } from '~~/shared/screenThemeOverrides';
import { SCREEN_MODE_VALUES } from '~~/shared/types/enums';

// A Screen settings page renders exactly the Theme Tokens an override write
// stores, each once: a Mode Token in the Screen Settings Group it names, a
// host token in Background & Placement (ADR-0072).

describe('where a Screen settings page renders each Theme Token', () => {
	it('places each token an override write stores, exactly once, in every mode', () => {
		for (const mode of SCREEN_MODE_VALUES) {
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

			expect(tokens, mode).toHaveLength(new Set(tokens).size);
			expect([...tokens].sort(), mode).toEqual(stored.sort());
		}
	});

	it('places every Mode Token in a group its mode\'s config contract declares', () => {
		for (const mode of SCREEN_MODE_VALUES) {
			const declared = Object.keys(screenModeConfigContract(mode).groups);

			expect(declared, mode).toEqual(expect.arrayContaining(Object.keys(placeScreenThemeTokens(mode).groups)));
		}
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
