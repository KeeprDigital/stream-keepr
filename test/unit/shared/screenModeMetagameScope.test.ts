import type { ScreenMode } from '~~/shared/types/enums';
import { describe, expect, it } from 'vitest';
import { DEFAULT_METAGAME_SCOPE, metagameArchetypeFilterField, metagameScopeShape } from '~~/shared/screenModeConfigs/subShapes';
import { SCREEN_MODES, screenModeConfigContract } from '~~/shared/screenModes';
import { getDisplayDefaultsForMode } from '~~/shared/types/screenConfig';

/**
 * The Metagame Scope is written once (#777): every mode reading the metagame
 * carries the whole shared set of scope fields (#904), with their bounds,
 * editor meta and defaults, so each offers the same scopes, meaning the same.
 */

const SCOPED_MODES = [
	{ mode: 'metagame', archetypeFilter: true },
	{ mode: 'top-cards', archetypeFilter: true },
	{ mode: 'archetype-spotlight', archetypeFilter: false },
] as const satisfies ReadonlyArray<{ mode: ScreenMode; archetypeFilter: boolean }>;

const SCOPE_FIELDS = Object.keys(metagameScopeShape) as (keyof typeof metagameScopeShape)[];

describe('the Metagame Scope', () => {
	it('defaults to every Player, with Top 8 and 9 points ready for their scopes', () => {
		expect(DEFAULT_METAGAME_SCOPE).toEqual({
			scope: 'all',
			topN: 8,
			minPoints: 9,
			playerListId: undefined,
		});
	});

	describe.each(SCOPED_MODES)('$mode', ({ mode, archetypeFilter }) => {
		const contract = screenModeConfigContract(mode);
		const shape = contract.shape as Record<string, unknown>;

		it('carries every shared scope field, validation and default', () => {
			for (const field of SCOPE_FIELDS) {
				expect(shape[field], field).toBe(metagameScopeShape[field]);
				expect(contract.defaults, field).toHaveProperty(field, DEFAULT_METAGAME_SCOPE[field]);
			}
		});

		it('keeps its scope and archetype filter through a display reset', () => {
			const reset = getDisplayDefaultsForMode(mode);

			for (const field of [
				...SCOPE_FIELDS,
				...(archetypeFilter
					? ['archetypeFilter']
					: []),
			])
				expect(reset, field).not.toHaveProperty(field);
		});

		it('declares its Player List as an Event Reference', () => {
			expect(SCREEN_MODES[mode].eventReferences).toHaveProperty('playerListId', 'playerList');
		});

		it(archetypeFilter ? 'carries the shared archetype filter' : 'carries no archetype filter', () => {
			if (archetypeFilter)
				expect(shape.archetypeFilter).toBe(metagameArchetypeFilterField);
			else
				expect(shape).not.toHaveProperty('archetypeFilter');
		});
	});
});
