import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * The Round a Round Clock Screen shows (ADR-0066): the one it picks, or the
 * Current Round, with that Round's operator-entered timing.
 */

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const { findRoundClockRound } = await import('~~/server/services/roundClock');

afterAll(async () => await harness.close());

const STARTED_AT = new Date('2026-11-04T10:00:00.000Z');

/** An Event with Melee Rounds 1 and 2, Round 1 paired and timed; Round 2 unpaired. */
async function seed() {
	const [event, otherEvent] = await db.insert(schema.events).values([
		{ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		{ name: 'Other Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
	]).returning({ id: schema.events.id });
	const eventId = event!.id;
	const [phase, foreignPhase] = await db.insert(schema.phases).values([
		{
			eventId,
			name: 'Swiss',
			externalId: '1',
			externalSource: 'melee',
		},
		{ eventId: otherEvent!.id, name: 'Swiss' },
	]).returning({ id: schema.phases.id });
	const [round1, round2, foreign] = await db.insert(schema.rounds).values([
		{
			eventId,
			phaseId: phase!.id,
			name: 'Round 1',
			roundNumber: 1,
			externalId: '11',
			externalSource: 'melee',
			startedAt: STARTED_AT,
			durationMinutes: 50,
		},
		{
			eventId,
			phaseId: phase!.id,
			name: 'Round 2',
			roundNumber: 2,
			externalId: '12',
			externalSource: 'melee',
			durationMinutes: 50,
		},
		{
			eventId: otherEvent!.id,
			phaseId: foreignPhase!.id,
			name: 'Round 1',
			roundNumber: 1,
		},
	]).returning({ id: schema.rounds.id });
	await db.insert(schema.matches).values({
		eventId,
		roundId: round1!.id,
		externalId: 'm1',
		externalSource: 'melee',
	});
	return {
		eventId,
		round1: round1!.id,
		round2: round2!.id,
		foreign: foreign!.id,
	};
}

describe('findRoundClockRound', () => {
	it.each([
		[
			'no Round picked: the Current Round',
			null,
			'round1',
			{
				name: 'Round 1',
				startedAt: STARTED_AT.toISOString(),
				durationMinutes: 50,
			},
		],
		[
			'a picked Round',
			'round2',
			'round2',
			{ name: 'Round 2', startedAt: null, durationMinutes: 50 },
		],
	] as const)('%s', async (_case, picked, shown, timing) => {
		const records = await seed();

		const answer = await findRoundClockRound(records.eventId, picked ? records[picked] : undefined);

		expect(answer).toEqual({
			round: { id: records[shown], ...timing },
		});
	});

	it.each([
		[
			'another Event\'s Round',
			async (records: Awaited<ReturnType<typeof seed>>) => [records.eventId, records.foreign] as const,
		],
		[
			'no Round picked, before any Round is paired',
			async () => {
				const [fresh] = await db.insert(schema.events).values({ name: 'Fresh', game: 'mtg', featureMatchOrientation: 'horizontal' }).returning({ id: schema.events.id });
				return [fresh!.id, undefined] as const;
			},
		],
	] as const)('shows no Round for %s', async (_case, pick) => {
		const [eventId, roundId] = await pick(await seed());

		expect(await findRoundClockRound(eventId, roundId)).toEqual({ round: null });
	});
});
