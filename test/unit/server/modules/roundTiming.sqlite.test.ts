import type { MeleeEventParsed } from '~~/server/schemas/external/melee';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Round's start and duration are the operator's (ADR-0066): a Round write
 * stores and announces them, "Start now" stamps server time, and Melee Sync
 * never writes either.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const publishMessage = vi.fn();
const publishMessageStrict = vi.fn();

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({ publishMessage, publishMessageStrict }));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: vi.fn(),
}));
vi.doMock('~~/server/services/meleeIntegration', () => ({
	requireMeleeService: vi.fn(() => ({})),
}));
vi.doMock('~~/server/services/meleeCredentials', () => ({
	protectMeleeClientSecret: vi.fn(async (secret: string) => `encrypted:${secret}`),
}));

const { roundWriteModule } = await import('~~/server/modules/round-write');
const { createMeleeSyncWorkflows } = await import('~~/server/modules/melee-sync/workflows');

const STARTED_AT = new Date('2026-11-04T10:00:00.000Z');

beforeEach(() => {
	publishMessage.mockReset();
	publishMessageStrict.mockReset().mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

afterAll(async () => await harness.close());

async function seedRound(imported: boolean) {
	const [event] = await db.insert(schema.events).values({
		name: 'Timed Open',
		game: 'mtg',
		featureMatchOrientation: 'horizontal',
		meleeEnabled: imported,
		meleeEventId: imported ? 'melee-1' : null,
	}).returning({ id: schema.events.id });
	const eventId = event!.id;
	const provenance = imported
		? { externalSource: 'melee' as const }
		: { externalId: null, externalSource: 'manual' as const };
	const [phase] = await db.insert(schema.phases).values({
		eventId,
		name: 'Swiss',
		externalId: imported ? '100' : null,
		...provenance,
	}).returning();
	const [round] = await db.insert(schema.rounds).values({
		eventId,
		phaseId: phase!.id,
		name: 'Round 1',
		roundNumber: 1,
		externalId: imported ? '1001' : null,
		...provenance,
	}).returning();
	return { eventId, roundId: round!.id };
}

async function storedTiming(roundId: number) {
	const round = await db.query.rounds.findFirst({
		where: eq(schema.rounds.id, roundId),
	});
	return { startedAt: round!.startedAt, durationMinutes: round!.durationMinutes };
}

function announcedRound() {
	const call = publishMessage.mock.calls.find(([, type]) => type === 'round:updated');
	return call?.[2].round;
}

describe('a Round write', () => {
	it.each([
		[
			'sets a start and a duration',
			{ startedAt: STARTED_AT, durationMinutes: 50 },
			{ startedAt: STARTED_AT, durationMinutes: 50 },
		],
		[
			'clears them',
			{ startedAt: null, durationMinutes: null },
			{ startedAt: null, durationMinutes: null },
		],
	] as const)('%s, and announces them on round:updated', async (_case, input, stored) => {
		const { eventId, roundId } = await seedRound(false);
		await roundWriteModule().update({
			eventId,
			roundId,
			input: {
				startedAt: new Date('2026-01-01T00:00:00.000Z'),
				durationMinutes: 30,
			},
		});
		publishMessage.mockReset();

		await roundWriteModule().update({ eventId, roundId, input });

		expect(await storedTiming(roundId)).toEqual(stored);
		expect(announcedRound()).toMatchObject(stored);
	});

	it('"Start now" sets the start to server time and keeps the duration', async () => {
		const { eventId, roundId } = await seedRound(false);
		await roundWriteModule().update({
			eventId,
			roundId,
			input: { durationMinutes: 50 },
		});
		publishMessage.mockReset();
		vi.useFakeTimers({
			toFake: ['Date'],
		});
		vi.setSystemTime(STARTED_AT);

		const answer = await roundWriteModule().start({ eventId, roundId });

		expect(await storedTiming(roundId)).toEqual({ startedAt: STARTED_AT, durationMinutes: 50 });
		expect(answer).toMatchObject({ startedAt: STARTED_AT, durationMinutes: 50 });
		expect(announcedRound()).toMatchObject({ startedAt: STARTED_AT });
	});

	it('"Start now" refuses a Round outside the Event', async () => {
		const { roundId } = await seedRound(false);
		const other = await seedRound(false);

		await expect(roundWriteModule().start({ eventId: other.eventId, roundId })).rejects.toMatchObject({ statusCode: 404 });
		expect(await storedTiming(roundId)).toEqual({ startedAt: null, durationMinutes: null });
	});
});

describe('melee Sync', () => {
	const meleeEventData = {
		game: 'mtg' as const,
		meleeEnabled: true,
		meleeEventId: 'melee-1',
		meleeClientId: 'client',
		meleeClientSecret: 'secret',
	};

	it.each([
		[
			'still on Melee.gg, renamed there',
			[
				{ ID: 1001, Name: 'Round One', SortOrder: 0 },
			],
		],
		['gone from Melee.gg while holding a manual Match', []],
	] as const)('leaves the timing of an imported Round %s', async (_case, upstreamRounds) => {
		const { eventId, roundId } = await seedRound(true);
		await db.insert(schema.matches).values({
			eventId,
			roundId,
			externalId: null,
			externalSource: 'manual',
		});
		await roundWriteModule().update({
			eventId,
			roundId,
			input: { startedAt: STARTED_AT, durationMinutes: 50 },
		});

		await createMeleeSyncWorkflows().syncEventStructure({ originConnectionId: 'origin-1' }, eventId, meleeEventData, {
			ID: 1,
			Name: 'Timed Open',
			Game: 'Magic: The Gathering',
			Phases: [
				{
					ID: 100,
					Name: 'Swiss',
					FormatId: 'modern',
					SortOrder: 0,
					Rounds: upstreamRounds,
				},
			],
		} as unknown as MeleeEventParsed);

		expect(await storedTiming(roundId)).toEqual({ startedAt: STARTED_AT, durationMinutes: 50 });
	});
});
