import { describe, expect, it } from 'vitest';
import { projectRoundClock } from '~~/shared/utils/roundClock';

const START = Date.parse('2026-11-04T10:00:00.000Z');
const MINUTE = 60_000;

describe('projectRoundClock', () => {
	// Every rendering projects from the Round's timing and server time alone, so they agree.
	it.each([
		[
			'no duration',
			{ startedAt: START, durationMinutes: null },
			START,
			{ state: 'untimed', display: null },
		],
		[
			'a duration, never started',
			{ startedAt: null, durationMinutes: 50 },
			START,
			{ state: 'pending', display: '50:00' },
		],
		[
			'a start still ahead',
			{ startedAt: START + MINUTE, durationMinutes: 50 },
			START,
			{ state: 'pending', display: '50:00' },
		],
		[
			'the instant it starts',
			{ startedAt: START, durationMinutes: 50 },
			START,
			{ state: 'running', display: '50:00' },
		],
		[
			'part-way through a second',
			{ startedAt: START, durationMinutes: 50 },
			START + 1500,
			{ state: 'running', display: '49:58' },
		],
		[
			'ten minutes in',
			{ startedAt: START, durationMinutes: 50 },
			START + 10 * MINUTE,
			{ state: 'running', display: '40:00' },
		],
		[
			'over an hour long',
			{ startedAt: START, durationMinutes: 75 },
			START + 5 * MINUTE,
			{ state: 'running', display: '1:10:00' },
		],
		[
			'the instant it ends',
			{ startedAt: START, durationMinutes: 50 },
			START + 50 * MINUTE,
			{ state: 'ended', display: '0:00' },
		],
		[
			'long after it ends',
			{ startedAt: START, durationMinutes: 50 },
			START + 90 * MINUTE,
			{ state: 'ended', display: '0:00' },
		],
	] as const)('%s', (_case, timing, now, expected) => {
		expect(projectRoundClock(timing, now)).toMatchObject(expected);
	});

	it('names when it next changes: each whole second while running, the start while pending', () => {
		expect(projectRoundClock({ startedAt: START, durationMinutes: 50 }, START + 1500).nextChangeInMs).toBe(500);
		expect(projectRoundClock({ startedAt: START + MINUTE, durationMinutes: 50 }, START).nextChangeInMs).toBe(MINUTE);
		expect(projectRoundClock({ startedAt: null, durationMinutes: 50 }, START).nextChangeInMs).toBeNull();
		expect(projectRoundClock({ startedAt: START, durationMinutes: 50 }, START + 50 * MINUTE).nextChangeInMs).toBeNull();
	});
});
