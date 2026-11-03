import { describe, expect, it } from 'vitest';
import { roundPickerOptions } from '~~/app/utils/roundLabels';

const swiss = { id: 1, name: 'Swiss', sortOrder: 1 };
const topCut = { id: 2, name: 'Top Cut', sortOrder: 2 };

function round(id: number, phaseId: number, roundNumber: number, name = `Round ${roundNumber}`) {
	return { id, phaseId, roundNumber, name };
}

// A Round picker names each Round "Phase · Round", so Rounds sharing a name across
// Phases stay apart, and lists them in Round order: Phase sort order, round number, id.
describe('roundPickerOptions', () => {
	it.each([
		[
			'names each Round after its Phase',
			[
				round(10, 1, 1),
				round(20, 2, 1),
			],
			[swiss, topCut],
			[
				{ label: 'Swiss · Round 1', value: 10 },
				{ label: 'Top Cut · Round 1', value: 20 },
			],
		],
		[
			'orders by Phase sort order before round number',
			[
				round(20, 2, 1),
				round(11, 1, 2),
				round(10, 1, 1),
			],
			[topCut, swiss],
			[
				{ label: 'Swiss · Round 1', value: 10 },
				{ label: 'Swiss · Round 2', value: 11 },
				{ label: 'Top Cut · Round 1', value: 20 },
			],
		],
		[
			'breaks a round number tie by id',
			[
				round(12, 1, 1, 'Round 1b'),
				round(10, 1, 1, 'Round 1a'),
			],
			[swiss],
			[
				{ label: 'Swiss · Round 1a', value: 10 },
				{ label: 'Swiss · Round 1b', value: 12 },
			],
		],
		[
			'falls back to the Round\'s name, last, while its Phase is unknown',
			[
				round(30, 9, 1),
				round(10, 1, 1),
			],
			[swiss],
			[
				{ label: 'Swiss · Round 1', value: 10 },
				{ label: 'Round 1', value: 30 },
			],
		],
	])('%s', (_, rounds, phases, options) => {
		expect(roundPickerOptions(rounds, phases)).toEqual(options);
	});
});
