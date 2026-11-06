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

	// A rendering re-evaluates exactly then: each whole second while running, the start while pending.
	it.each([
		[
			'running, part-way through a second',
			START,
			START + 1500,
			500,
		],
		[
			'running, on a whole second',
			START,
			START + 2000,
			1000,
		],
		[
			'pending a start',
			START + MINUTE,
			START,
			MINUTE,
		],
		['never started', null, START, null],
		[
			'ended',
			START,
			START + 50 * MINUTE,
			null,
		],
	] as const)('names when it next changes: %s', (_case, startedAt, now, nextChangeInMs) => {
		expect(projectRoundClock({ startedAt, durationMinutes: 50 }, now).nextChangeInMs).toBe(nextChangeInMs);
	});

	// Counting up after the end, a Round Clock shows the time since the end, holding at its limit.
	it.each([
		[
			'the instant it ends',
			null,
			50 * MINUTE,
			'0:00',
			1000,
		],
		[
			'part-way past the end',
			null,
			50 * MINUTE + 61_500,
			'1:01',
			500,
		],
		[
			'long past the end, no limit',
			null,
			140 * MINUTE,
			'1:30:00',
			1000,
		],
		[
			'short of its limit',
			5,
			52 * MINUTE,
			'2:00',
			1000,
		],
		[
			'at its limit',
			5,
			55 * MINUTE,
			'5:00',
			null,
		],
		[
			'past its limit',
			5,
			90 * MINUTE,
			'5:00',
			null,
		],
	] as const)('counts up after the end: %s', (_case, limitMinutes, sinceStart, display, nextChangeInMs) => {
		expect(projectRoundClock(
			{ startedAt: START, durationMinutes: 50 },
			START + sinceStart,
			{ enabled: true, limitMinutes },
		)).toEqual({ state: 'ended', display, nextChangeInMs });
	});
});
