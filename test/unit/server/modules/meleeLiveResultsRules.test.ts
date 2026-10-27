import { describe, expect, it } from 'vitest';
import { resolveCurrentRound } from '~~/server/modules/melee-sync/liveResults/currentRound';
import { nextLiveResultsSchedule } from '~~/server/modules/melee-sync/liveResults/schedule';
import { createMockRound } from '~~/test/helpers/fixtures';

/*
 * The Current Round is the latest Melee-managed Round with pairings; Live Results
 * polls its Match Results while it is incomplete, then probes the next Round.
 */

/** Swiss Rounds 1-4 (Phase 1), then the first Top Cut Round (Phase 2), in Round order. */
const rounds = [
	...[1, 2, 3, 4].map(roundNumber => createMockRound({ id: 10 + roundNumber, phaseId: 1, roundNumber })),
	createMockRound({ id: 21, phaseId: 2, roundNumber: 1 }),
];

interface Case {
	name: string;
	ordered: typeof rounds;
	/** Round ids holding pairings, by whether the Round is complete; the rest hold none. */
	complete: number[];
	incomplete: number[];
	current: number | null;
	target: { kind: 'results' | 'probe'; roundId: number } | { kind: 'idle' };
}

describe('resolveCurrentRound', () => {
	it.each<Case>([
		{
			name: 'no Round has pairings: probe the first',
			ordered: rounds,
			complete: [],
			incomplete: [],
			current: null,
			target: { kind: 'probe', roundId: 11 },
		},
		{
			name: 'Round 3 incomplete: poll its results',
			ordered: rounds,
			complete: [11, 12],
			incomplete: [13],
			current: 13,
			target: { kind: 'results', roundId: 13 },
		},
		{
			name: 'Round 3 complete, Round 4 exists: probe Round 4',
			ordered: rounds,
			complete: [11, 12, 13],
			incomplete: [],
			current: 13,
			target: { kind: 'probe', roundId: 14 },
		},
		{
			name: 'last Swiss Round complete: probe the first Top Cut Round in the next Phase',
			ordered: rounds,
			complete: [11, 12, 13, 14],
			incomplete: [],
			current: 14,
			target: { kind: 'probe', roundId: 21 },
		},
		{
			name: 'last Round complete, nothing next: idle',
			ordered: rounds,
			complete: [13, 14, 21],
			incomplete: [],
			current: 21,
			target: { kind: 'idle' },
		},
		{
			name: 'no Melee-managed Rounds: idle',
			ordered: [],
			complete: [],
			incomplete: [],
			current: null,
			target: { kind: 'idle' },
		},
	])('$name', ({ ordered, complete, incomplete, current, target }) => {
		const paired = [
			...complete,
			...incomplete,
		];
		const stats = new Map(paired.map(id => [
			id,
			{
				matchCount: 8,
				complete: complete.includes(id),
			},
		]));

		const resolved = resolveCurrentRound(ordered, stats);

		expect(resolved.current?.id ?? null).toBe(current);
		expect(resolved.target.kind === 'idle'
			? { kind: 'idle' }
			: { kind: resolved.target.kind, roundId: resolved.target.round.id }).toEqual(target);
	});
});

const now = new Date('2026-10-27T12:00:00.000Z');
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** `ms` before `now`. */
function ago(ms: number) {
	return new Date(now.getTime() - ms);
}

describe('nextLiveResultsSchedule', () => {
	type Kind = 'results' | 'probe' | 'idle';
	type Outcome = 'changed' | 'unchanged' | 'failed' | 'auth-failed';

	// [target, outcome, backoff step, quiet for, next check in, next step, quiet for afterwards]
	it.each<[Kind, Outcome, number, number, number, number, number]>([
		[
			'results',
			'changed',
			3,
			20 * MINUTE,
			MINUTE,
			0,
			0,
		],
		[
			'results',
			'unchanged',
			0,
			10 * MINUTE,
			MINUTE,
			0,
			10 * MINUTE,
		],
		[
			'results',
			'unchanged',
			0,
			30 * MINUTE,
			MINUTE,
			0,
			30 * MINUTE,
		],
		[
			'results',
			'unchanged',
			0,
			31 * MINUTE,
			5 * MINUTE,
			0,
			31 * MINUTE,
		],
		[
			'results',
			'unchanged',
			2,
			10 * MINUTE,
			MINUTE,
			0,
			10 * MINUTE,
		],
		[
			'results',
			'unchanged',
			0,
			12 * HOUR,
			5 * MINUTE,
			0,
			12 * HOUR,
		],
		[
			'probe',
			'unchanged',
			0,
			MINUTE,
			MINUTE,
			1,
			MINUTE,
		],
		[
			'probe',
			'unchanged',
			1,
			MINUTE,
			2 * MINUTE,
			2,
			MINUTE,
		],
		[
			'probe',
			'unchanged',
			2,
			MINUTE,
			4 * MINUTE,
			3,
			MINUTE,
		],
		[
			'probe',
			'unchanged',
			3,
			MINUTE,
			8 * MINUTE,
			4,
			MINUTE,
		],
		[
			'probe',
			'unchanged',
			4,
			MINUTE,
			15 * MINUTE,
			5,
			MINUTE,
		],
		[
			'probe',
			'unchanged',
			5,
			MINUTE,
			15 * MINUTE,
			6,
			MINUTE,
		],
		[
			'probe',
			'changed',
			4,
			HOUR,
			MINUTE,
			0,
			0,
		],
		[
			'results',
			'failed',
			0,
			MINUTE,
			MINUTE,
			1,
			MINUTE,
		],
		[
			'results',
			'failed',
			3,
			MINUTE,
			8 * MINUTE,
			4,
			MINUTE,
		],
		[
			'probe',
			'failed',
			5,
			MINUTE,
			15 * MINUTE,
			6,
			MINUTE,
		],
		[
			'idle',
			'unchanged',
			0,
			MINUTE,
			MINUTE,
			1,
			MINUTE,
		],
		[
			'idle',
			'unchanged',
			3,
			MINUTE,
			8 * MINUTE,
			4,
			MINUTE,
		],
	])('%s %s at step %i, quiet %i ms: next check in %i ms', (target, outcome, backoffStep, quietFor, wait, nextStep, quietAfter) => {
		expect(nextLiveResultsSchedule({
			now,
			target,
			outcome,
			backoffStep,
			lastChangeAt: ago(quietFor),
		})).toEqual({
			nextCheckAt: new Date(now.getTime() + wait),
			backoffStep: nextStep,
			lastChangeAt: ago(quietAfter),
			stop: null,
		});
	});

	// [target, outcome, quiet for, stop reason]
	it.each<[Kind, Outcome, number, 'idle' | 'auth']>([
		[
			'results',
			'auth-failed',
			MINUTE,
			'auth',
		],
		['probe', 'auth-failed', MINUTE, 'auth'],
		[
			'results',
			'unchanged',
			12 * HOUR + 1,
			'idle',
		],
		[
			'probe',
			'unchanged',
			12 * HOUR + 1,
			'idle',
		],
		[
			'idle',
			'unchanged',
			12 * HOUR + 1,
			'idle',
		],
		[
			'results',
			'failed',
			12 * HOUR + 1,
			'idle',
		],
	])('%s %s, quiet %i ms: stops (%s)', (target, outcome, quietFor, stop) => {
		expect(nextLiveResultsSchedule({
			now,
			target,
			outcome,
			backoffStep: 2,
			lastChangeAt: ago(quietFor),
		}).stop).toBe(stop);
	});
});
