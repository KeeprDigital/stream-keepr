import type { ScreenMode } from '~~/shared/types/enums';
import { describe, expect, it } from 'vitest';
import { DEFAULT_METAGAME_SCOPE, metagameArchetypeFilterField, metagameScopeShape } from '~~/shared/screenModeConfigs/subShapes';
import { SCREEN_MODES, screenModeConfigContract } from '~~/shared/screenModes';

/**
 * The Metagame Scope is written once (#777): every mode reading the metagame
 * carries the one shared set of scope fields, with their bounds, editor meta
 * and defaults, so a scope means the same on each.
 */

const SCOPED_MODES = [
	// Most Played Cards never offered Minimum Points, so it carries no minimum to scope by.
	{ mode: 'metagame', scopeFields: ['scope', 'topN', 'minPoints', 'playerListId'], archetypeFilter: true },
	{ mode: 'top-cards', scopeFields: ['scope', 'topN', 'playerListId'], archetypeFilter: true },
	{ mode: 'archetype-spotlight', scopeFields: ['scope', 'topN', 'minPoints', 'playerListId'], archetypeFilter: false },
] as const satisfies ReadonlyArray<{ mode: ScreenMode; scopeFields: readonly (keyof typeof metagameScopeShape)[]; archetypeFilter: boolean }>;

describe('the Metagame Scope', () => {
	it('defaults to every Player, with Top 8 and 9 points ready for their scopes', () => {
		expect(DEFAULT_METAGAME_SCOPE).toEqual({ scope: 'all', topN: 8, minPoints: 9, playerListId: undefined });
	});

	describe.each(SCOPED_MODES)('$mode', ({ mode, scopeFields, archetypeFilter }) => {
		const contract = screenModeConfigContract(mode);
		const shape = contract.shape as Record<string, unknown>;

		it('carries the shared scope fields, validation and defaults', () => {
			for (const field of scopeFields) {
				expect(shape[field], field).toBe(metagameScopeShape[field]);
				expect(contract.defaults, field).toHaveProperty(field, DEFAULT_METAGAME_SCOPE[field]);
			}
		});

		it('carries no scope field it does not offer', () => {
			for (const field of Object.keys(metagameScopeShape).filter(field => !(scopeFields as readonly string[]).includes(field)))
				expect(shape, field).not.toHaveProperty(field);
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
