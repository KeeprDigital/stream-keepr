import { describe, expect, it, vi } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { modeConfigPatchSchemaMap, modeConfigsMapSchema, parseModeConfigPatchResult } from '~~/server/schemas/api/screen';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { createMockScreen } from '~~/test/helpers/fixtures';

// The rule on a contract that declares nothing else, so Round Clock stands in:
// here its count-up limit was once stored as `limitMinutes`.
vi.mock('~~/shared/screenModeConfigs/roundClock', async (importOriginal) => {
	const { defineScreenModeConfigContract } = await import('~~/shared/screenModeConfigs/contract');
	const { roundClockModeConfigContract: actual } = await importOriginal<typeof import('~~/shared/screenModeConfigs/roundClock')>();
	return {
		roundClockModeConfigContract: defineScreenModeConfigContract(actual.shape, actual.defaults, {
			groups: actual.groups,
			formerFields: ['limitMinutes'],
			upgradeFormerFields: fragment => 'limitMinutes' in fragment && !('countUpLimitMinutes' in fragment)
				? { ...fragment, countUpLimitMinutes: fragment.limitMinutes }
				: fragment,
		}),
	};
});

/**
 * A former field its contract upgrades reads as the current field it maps to,
 * is stored as that field by a write still naming it, and is not lost when a
 * PATCH of another field drops the former one from storage.
 */
describe('a Screen storing a former field its contract upgrades', () => {
	const stored = {
		'round-clock': { limitMinutes: 5, showRoundName: false },
	};
	const upgraded = {
		'round-clock': { countUpLimitMinutes: 5, showRoundName: false },
	};

	it('reads as the current field, everywhere it is read', () => {
		expect(resolveScreenModeConfig(stored, 'round-clock')).toMatchObject(upgraded['round-clock']);
		expect(resolveScreenModeConfig(stored, 'round-clock')).not.toHaveProperty('limitMinutes');
		expect(mapScreenToResponse(createMockScreen({ modeConfigs: stored })).modeConfigs).toEqual(upgraded);
	});

	it('is stored as the current field by a full write still naming the former one', () => {
		expect(JSON.parse(JSON.stringify(modeConfigsMapSchema.parse(stored)))).toEqual(upgraded);
	});

	it.each([
		{
			name: 'naming the former field stores the current one',
			patch: { limitMinutes: 7 },
			patched: { countUpLimitMinutes: 7, showRoundName: false },
		},
		{
			name: 'of another field keeps the upgraded value',
			patch: { showRoundName: true },
			patched: { countUpLimitMinutes: 5, showRoundName: true },
		},
		{
			name: 'of the current field replaces the upgraded value',
			patch: { countUpLimitMinutes: 9 },
			patched: { countUpLimitMinutes: 9, showRoundName: false },
		},
		{
			name: 'deleting the current field is not undone by the stored former one',
			patch: { countUpLimitMinutes: null },
			patched: { showRoundName: false },
		},
	])('a PATCH $name', ({ patch, patched }) => {
		const parsed = modeConfigPatchSchemaMap['round-clock'].parse(patch) as Record<string, unknown>;

		expect(parseModeConfigPatchResult(stored, 'round-clock', parsed)).toEqual({ 'round-clock': patched });
	});

	it('still refuses an upgraded value outside the current field\'s bounds on a write', () => {
		expect(modeConfigPatchSchemaMap['round-clock'].safeParse({ limitMinutes: 0 }).success).toBe(false);
	});
});
