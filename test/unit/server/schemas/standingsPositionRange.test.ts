import { describe, expect, it } from 'vitest';
import { modeConfigPatchSchemaMap } from '~~/server/schemas/api/screen';
import { getDisplayDefaultsForMode } from '~~/shared/types/screenConfig';

/** Standings shows one range of positions, both ends included. */
describe('a Standings Screen\'s position range', () => {
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
