import type { EventRound } from '~~/shared/utils/eventRoundOrder';
import { describe, expect, it } from 'vitest';
import { previousStandingsRoundId, seedingRoundId } from '~~/shared/utils/eventRoundOrder';

/**
 * Which Round's Round Standings a reading compares with, from the Event's
 * Rounds in Round order (Phase sort order, then round number): the Position
 * Change baseline (#755) and a Top Cut Bracket's seeds (#759).
 */

const SWISS = 1;
const DAY_2 = 2;
const TOP_CUT = 3;

function round(id: number, phaseId: number, hasStandings: boolean): EventRound {
	return { id, phaseId, hasStandings };
}

describe('seedingRoundId', () => {
	it('seeds a Phase from the last Round before its first that holds Round Standings, never from the Phase\'s own', () => {
		const rounds = [
			round(11, SWISS, true),
			round(12, SWISS, true),
			round(13, SWISS, true),
			round(31, TOP_CUT, true),
			round(32, TOP_CUT, true),
		];

		expect(seedingRoundId(rounds, TOP_CUT)).toBe(13);
	});

	it('passes over an earlier Round without Round Standings, such as a manual one', () => {
		const rounds = [
			round(11, SWISS, true),
			round(12, SWISS, true),
			round(21, DAY_2, true),
			round(22, DAY_2, false),
			round(31, TOP_CUT, false),
		];

		expect(seedingRoundId(rounds, TOP_CUT)).toBe(21);
	});

	it('seeds a Phase mid-Event from the Rounds before it only', () => {
		const rounds = [
			round(11, SWISS, true),
			round(12, SWISS, true),
			round(21, DAY_2, true),
			round(31, TOP_CUT, true),
		];

		expect(seedingRoundId(rounds, DAY_2)).toBe(12);
	});

	it('has no seeds for the Event\'s first Phase, a Phase after Rounds without Round Standings, or a Phase holding no Round', () => {
		const rounds = [
			round(11, SWISS, true),
			round(21, DAY_2, false),
		];

		expect(seedingRoundId(rounds, SWISS)).toBeNull();
		expect(seedingRoundId([
			round(11, SWISS, false),
			round(31, TOP_CUT, false),
		], TOP_CUT)).toBeNull();
		expect(seedingRoundId(rounds, TOP_CUT)).toBeNull();
	});
});

describe('previousStandingsRoundId', () => {
	const rounds = [
		round(11, SWISS, true),
		round(12, SWISS, false),
		round(13, SWISS, true),
		round(21, DAY_2, true),
	];

	it('measures a Round against the nearest earlier Round holding Round Standings', () => {
		expect(previousStandingsRoundId(rounds, 21)).toBe(13);
		expect(previousStandingsRoundId(rounds, 13)).toBe(11);
		expect(previousStandingsRoundId(rounds, 12)).toBe(11);
	});

	it('measures current standings, as the latest Round holding them, against the one before it', () => {
		expect(previousStandingsRoundId(rounds, null)).toBe(13);
	});

	it('has no previous Round for the first Round, or one outside the Event', () => {
		expect(previousStandingsRoundId(rounds, 11)).toBeNull();
		expect(previousStandingsRoundId(rounds, 999)).toBeNull();
	});
});
