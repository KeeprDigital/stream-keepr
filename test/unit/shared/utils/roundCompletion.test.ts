import { describe, expect, it } from 'vitest';
import { isRoundComplete } from '~~/shared/utils/roundCompletion';

const reported = { hasResult: true, isBye: false };
const pending = { hasResult: false, isBye: false };
const bye = { hasResult: false, isBye: true };

describe('isRoundComplete', () => {
	// Rounds run in sequence: pairing the next Round completes this one, even with a Match never reported.
	it.each([
		{
			case: 'every Match reported',
			matches: [reported, reported],
			nextRoundHasPairings: false,
			complete: true,
		},
		{
			case: 'one Match pending, next Round unpaired',
			matches: [reported, pending],
			nextRoundHasPairings: false,
			complete: false,
		},
		{
			case: 'one Match pending, next Round paired',
			matches: [reported, pending],
			nextRoundHasPairings: true,
			complete: true,
		},
		{
			case: 'byes and reported Matches',
			matches: [bye, reported],
			nextRoundHasPairings: false,
			complete: true,
		},
		{
			case: 'no Matches, next Round unpaired',
			matches: [],
			nextRoundHasPairings: false,
			complete: false,
		},
		{
			case: 'no Matches, next Round paired',
			matches: [],
			nextRoundHasPairings: true,
			complete: true,
		},
	])('$case → complete: $complete', ({ matches, nextRoundHasPairings, complete }) => {
		expect(isRoundComplete(matches, nextRoundHasPairings)).toBe(complete);
	});
});
