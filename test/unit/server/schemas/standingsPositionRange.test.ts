import { describe, expect, it } from 'vitest';
import { mapScreenToResponse } from '~~/server/mappers/screen';
import { modeConfigPatchSchemaMap, modeConfigsMapSchema, parseModeConfigPatchResult } from '~~/server/schemas/api/screen';
import { getDisplayDefaultsForMode, resolveScreenModeConfig } from '~~/shared/types/screenConfig';
import { createMockScreen } from '~~/test/helpers/fixtures';

/**
 * Standings shows one range of positions (#1080). What an earlier contract
 * stored as a Top N count or a slice pair reads as that range, and a write
 * still naming either stores the range.
 */
describe('a Standings Screen storing a Top N count or a slice pair', () => {
	it.each([
		{
			name: 'a Top N view is the range 1 to N',
			stored: { viewMode: 'topN', topNCount: 12, showHeader: false },
			reads: {
				viewMode: 'range',
				rangeStart: 1,
				rangeEnd: 12,
				showHeader: false,
			},
		},
		{
			name: 'a Top N view storing no count is the range 1 to 8, the count\'s former default',
			stored: { viewMode: 'topN' },
			reads: { viewMode: 'range', rangeStart: 1, rangeEnd: 8 },
		},
		{
			name: 'a Top N view is not narrowed by the slice pair it also stored',
			stored: {
				viewMode: 'topN',
				topNCount: 4,
				sliceStart: 9,
				sliceEnd: 16,
			},
			reads: { viewMode: 'range', rangeStart: 1, rangeEnd: 4 },
		},
		{
			name: 'a slice view is the range its pair named',
			stored: {
				viewMode: 'slice',
				topNCount: 8,
				sliceStart: 9,
				sliceEnd: 16,
			},
			reads: { viewMode: 'range', rangeStart: 9, rangeEnd: 16 },
		},
		{
			name: 'another view keeps the slice pair as its range and loses the count',
			stored: {
				viewMode: 'watchlist',
				topNCount: 8,
				sliceStart: 9,
				sliceEnd: 16,
			},
			reads: { viewMode: 'watchlist', rangeStart: 9, rangeEnd: 16 },
		},
		{
			name: 'a range is read as it is stored',
			stored: { viewMode: 'range', rangeStart: 3, rangeEnd: 5 },
			reads: { viewMode: 'range', rangeStart: 3, rangeEnd: 5 },
		},
	])('$name', ({ stored, reads }) => {
		const modeConfigs = { standings: stored };

		expect(resolveScreenModeConfig(modeConfigs, 'standings')).toMatchObject(reads);
		expect(mapScreenToResponse(createMockScreen({ modeConfigs })).modeConfigs).toEqual({ standings: reads });
		expect(JSON.parse(JSON.stringify(modeConfigsMapSchema.parse(modeConfigs)))).toEqual({ standings: reads });
	});

	const storedTopN = {
		standings: { viewMode: 'topN', topNCount: 12, showHeader: false },
	};

	it.each([
		{
			name: 'of another field keeps the range the Top N view meant',
			patch: { showHeader: true },
			patched: {
				viewMode: 'range',
				rangeStart: 1,
				rangeEnd: 12,
				showHeader: true,
			},
		},
		{
			name: 'of the range end replaces the one the count meant',
			patch: { rangeEnd: 16 },
			patched: {
				viewMode: 'range',
				rangeStart: 1,
				rangeEnd: 16,
				showHeader: false,
			},
		},
		{
			name: 'a stale client sends with a new count stores the range 1 to that count',
			patch: { topNCount: 32 },
			patched: {
				viewMode: 'range',
				rangeStart: 1,
				rangeEnd: 32,
				showHeader: false,
			},
		},
		{
			name: 'a stale client sends choosing the slice view and its end stores the range',
			patch: { viewMode: 'slice', sliceEnd: 24 },
			patched: {
				viewMode: 'range',
				rangeStart: 1,
				rangeEnd: 24,
				showHeader: false,
			},
		},
		{
			name: 'a stale client sends choosing the Top N view stores the range view',
			patch: { viewMode: 'topN', topNCount: 4 },
			patched: {
				viewMode: 'range',
				rangeStart: 1,
				rangeEnd: 4,
				showHeader: false,
			},
		},
	])('a PATCH $name', ({ patch, patched }) => {
		const parsed = modeConfigPatchSchemaMap.standings.parse(patch) as Record<string, unknown>;

		expect(parseModeConfigPatchResult(storedTopN, 'standings', parsed)).toEqual({ standings: patched });
	});

	it.each([
		[
			'below the first position',
			{ rangeStart: 0 },
			false,
		],
		[
			'the first position',
			{ rangeStart: 1 },
			true,
		],
		[
			'the last position a range may name',
			{ rangeEnd: 9999 },
			true,
		],
		[
			'beyond it',
			{ rangeEnd: 10000 },
			false,
		],
		[
			'a count beyond it, from a stale client',
			{ topNCount: 10000 },
			false,
		],
		[
			'the Top N view by its former name alone, from a stale client',
			{ viewMode: 'topN' },
			true,
		],
	])('a write of %s is accepted: %s', (_name, patch, accepted) => {
		expect(modeConfigPatchSchemaMap.standings.safeParse(patch).success).toBe(accepted);
	});

	// The range is what the Screen shows, not how: a display reset leaves it alone.
	it('keeps its range and view through a display reset', () => {
		const reset = getDisplayDefaultsForMode('standings');

		expect(reset).not.toHaveProperty('viewMode');
		expect(reset).not.toHaveProperty('rangeStart');
		expect(reset).not.toHaveProperty('rangeEnd');
	});
});
