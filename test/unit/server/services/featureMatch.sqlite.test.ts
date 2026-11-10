import { and, asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Feature Match Slot writes over real SQL: what a new Slot takes from its Event
// and Match, removing a Slot whose Session never opened, the Slot count, and
// reordering.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

/** Thrown by the next Session open instead of opening it. */
let failNextOpen: Error | undefined;

vi.doMock('~~/server/db', () => ({ db }));
const publishMessage = vi.fn(async (..._args: unknown[]) => {});
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage,
	publishMessageStrict: publishMessage,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));
vi.doMock('~~/server/services/featureMatchState', async (importOriginal) => {
	const actual = await importOriginal<typeof import('~~/server/services/featureMatchState')>();
	const failing = <A extends unknown[], R>(open: (...args: A) => Promise<R>) => async (...args: A) => {
		const failure = failNextOpen;
		failNextOpen = undefined;
		if (failure)
			throw failure;
		return await open(...args);
	};
	return {
		...actual,
		featureMatchStateService: () => {
			const service = actual.featureMatchStateService();
			return {
				...service,
				createSessionForSlot: failing(service.createSessionForSlot),
				openSessionsForSlots: failing(service.openSessionsForSlots),
			};
		},
	};
});

const { featureMatchService } = await import('~~/server/services/featureMatch');
const { featureMatchStateService } = await import('~~/server/services/featureMatchState');
const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');

beforeEach(() => {
	failNextOpen = undefined;
	publishMessage.mockClear();
});

afterAll(async () => await harness.close());

async function stageEvent(featureMatchDefaultBestOf = 3) {
	const [event] = await db.insert(schema.events)
		.values({
			name: 'Event',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			featureMatchDefaultBestOf,
		})
		.returning({ id: schema.events.id });
	return event!.id;
}

async function slotsOf(eventId: number) {
	return await db.select().from(schema.featureMatches).where(eq(schema.featureMatches.eventId, eventId)).orderBy(asc(schema.featureMatches.id));
}

/** Makes every Slot delete fail, as a compensation that cannot run. */
async function withSlotDeletesFailing(run: () => Promise<void>) {
	await harness.client.execute(`create trigger reject_slot_delete before delete on feature_match_slots
		begin select raise(abort, 'delete failed'); end`);
	try {
		await run();
	}
	finally {
		await harness.client.execute('drop trigger reject_slot_delete');
	}
}

describe('create', () => {
	it('takes the Event\'s default best-of unless one is given', async () => {
		const eventId = await stageEvent(5);

		expect((await featureMatchService().create(eventId, {})).bestOf).toBe(5);
		expect((await featureMatchService().create(eventId, { bestOf: 1 })).bestOf).toBe(1);
	});

	it('is manual and opens its own Session, whatever the payload claims', async () => {
		const eventId = await stageEvent();

		const slot = await featureMatchService().create(eventId, { externalId: 'forged-id', externalSource: 'melee', activeSessionId: 42 } as never);

		expect(slot).toMatchObject({ externalId: null, externalSource: 'manual' });
		const session = await db.query.featureMatchSessions.findFirst({
			where: eq(schema.featureMatchSessions.slotId, slot.id),
		});
		expect(slot.activeSessionId).toBe(session!.id);
	});

	it('takes its provenance from the Match it shows', async () => {
		const eventId = await stageEvent();
		const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss' }).returning();
		const [round] = await db.insert(schema.rounds).values({
			eventId,
			phaseId: phase!.id,
			name: 'R1',
			roundNumber: 1,
		}).returning();
		const [match] = await db.insert(schema.matches).values({
			eventId,
			roundId: round!.id,
			externalId: 'match-22',
			externalSource: 'melee',
		}).returning();

		const slot = await featureMatchService().create(eventId, { matchId: match!.id, externalId: 'forged', externalSource: 'manual' } as never);

		expect(slot).toMatchObject({ matchId: match!.id, externalId: 'match-22', externalSource: 'melee' });
	});

	it('removes a Slot whose initial Session could not open', async () => {
		const eventId = await stageEvent();
		failNextOpen = new Error('session failed');

		await expect(featureMatchService().create(eventId, {})).rejects.toThrow('session failed');

		expect(await slotsOf(eventId)).toEqual([]);
	});

	it('answers the Session failure, carrying the failed removal with it', async () => {
		const eventId = await stageEvent();
		const sessionFailure = new Error('session failed');
		failNextOpen = sessionFailure;

		await withSlotDeletesFailing(async () => {
			await expect(featureMatchService().create(eventId, {})).rejects.toBe(sessionFailure);
		});

		expect(String((sessionFailure as { compensationFailure?: Error }).compensationFailure?.cause)).toMatch(/delete failed/);
	});
});

describe('update', () => {
	it('leaves an imported Slot\'s Melee identity alone', async () => {
		const eventId = await stageEvent();
		const [slot] = await db.insert(schema.featureMatches).values({ eventId, externalId: 'melee-slot', externalSource: 'melee' }).returning();

		await featureMatchService().update(slot!.id, eventId, {
			tableNumber: 9,
			externalId: 'forged-id',
			externalSource: 'manual',
			activeSessionId: 42,
		} as never);

		expect((await slotsOf(eventId))[0]).toMatchObject({ tableNumber: 9, externalId: 'melee-slot', externalSource: 'melee' });
		expect((await slotsOf(eventId))[0]!.activeSessionId).not.toBe(42);
	});
});

describe('applyEventBestOf', () => {
	it.each([
		{ from: 1, to: 3 },
		{ from: 3, to: 1 },
	])('moves every Slot and its active Session from best of $from to best of $to, once', async ({ from, to }) => {
		const eventId = await stageEvent(from);
		await featureMatchService().syncFeatureMatches(eventId, 2);
		await db.update(schema.events).set({ featureMatchDefaultBestOf: to }).where(eq(schema.events.id, eventId));

		const changed = await featureMatchService().applyEventBestOf(eventId, to);

		const slots = await slotsOf(eventId);
		expect(changed).toEqual(slots.map(slot => slot.id));
		expect(slots.map(slot => slot.bestOf)).toEqual([to, to]);
		const sessions = await db.select().from(schema.featureMatchSessions).where(eq(schema.featureMatchSessions.eventId, eventId));
		expect(sessions.map(session => session.sourceSnapshot.bestOf)).toEqual([to, to]);
		expect(await featureMatchService().applyEventBestOf(eventId, to)).toEqual([]);
	});
});

describe('applyEventDefaults', () => {
	async function activeSessions(eventId: number) {
		return await db.select().from(schema.featureMatchSessions).where(and(eq(schema.featureMatchSessions.eventId, eventId), eq(schema.featureMatchSessions.status, 'active'))).orderBy(asc(schema.featureMatchSessions.slotId));
	}

	it.each([
		{ from: null, to: 10 },
		{ from: 10, to: null },
	])('leaves a running clock at its count-up limit of $from, and a Match reset takes $to', async ({ from, to }) => {
		const eventId = await stageEvent();
		await db.update(schema.events)
			.set({ featureMatchDefaultCountUpAfterCountdown: true, featureMatchDefaultCountUpLimit: from })
			.where(eq(schema.events.id, eventId));
		await featureMatchService().syncFeatureMatches(eventId, 2);
		await db.update(schema.events).set({ featureMatchDefaultCountUpLimit: to }).where(eq(schema.events.id, eventId));

		const corrected = await featureMatchService().applyEventDefaults(eventId);

		expect(corrected).toEqual((await slotsOf(eventId)).map(slot => slot.id));
		const sessions = await activeSessions(eventId);
		const toMs = to == null
			? null
			: to * 60_000;
		const fromMs = from == null
			? null
			: from * 60_000;
		expect(sessions.map(session => session.currentState.clock.countUpLimitMs)).toEqual([fromMs, fromMs]);

		const reset = await featureMatchStateService().applyCommand(sessions[0]!.id, eventId, {
			commandId: 'reset-match',
			type: 'ResetState',
			payload: { type: 'match' },
			baseSequence: sessions[0]!.sequence,
		});

		expect(reset.session.currentState.clock.countUpLimitMs).toBe(toMs);
	});

	it('corrects nothing for an Event without Slots', async () => {
		expect(await featureMatchService().applyEventDefaults(await stageEvent())).toEqual([]);
	});
});

describe('syncFeatureMatches', () => {
	it('adds Slots with open Sessions, then removes from the end, then leaves an equal count alone', async () => {
		const eventId = await stageEvent();

		const grown = await featureMatchService().syncFeatureMatches(eventId, 3);
		expect(grown.created).toHaveLength(3);
		expect((await slotsOf(eventId)).every(slot => slot.activeSessionId != null)).toBe(true);

		const [, second, third] = grown.created;
		const shrunk = await featureMatchService().syncFeatureMatches(eventId, 1);
		expect(shrunk).toEqual({
			created: [],
			deleted: [third!.id, second!.id],
			clearedScreens: [],
		});

		expect(await featureMatchService().syncFeatureMatches(eventId, 1)).toEqual({ created: [], deleted: [], clearedScreens: [] });
	});

	it('answers the Session failure, carrying the failed removal with it', async () => {
		const eventId = await stageEvent();
		const sessionFailure = new Error('session failed');
		failNextOpen = sessionFailure;

		await withSlotDeletesFailing(async () => {
			await expect(featureMatchService().syncFeatureMatches(eventId, 1)).rejects.toBe(sessionFailure);
		});

		expect(String((sessionFailure as { compensationFailure?: Error }).compensationFailure?.cause)).toMatch(/delete failed/);
	});
});

describe('swapMatchOrder', () => {
	it('swaps a Slot with its neighbour, first giving duplicate orders distinct places', async () => {
		const eventId = await stageEvent();
		const [one, two, three] = await db.insert(schema.featureMatches)
			.values([
				{ eventId, sortOrder: 0 },
				{ eventId, sortOrder: 0 },
				{ eventId, sortOrder: 1 },
			])
			.returning();

		const result = await featureMatchService().swapMatchOrder(eventId, two!.id, 'down');

		expect(result).toEqual([
			{ matchId: two!.id, sortOrder: 2 },
			{ matchId: three!.id, sortOrder: 1 },
		]);
		expect((await slotsOf(eventId)).map(slot => [slot.id, slot.sortOrder])).toEqual([
			[one!.id, 0],
			[two!.id, 2],
			[three!.id, 1],
		]);
	});

	// A reorder that first gave duplicate orders distinct places moved Slots other
	// than the two swapped; clients sort by what is announced, so all are named.
	it('answers and announces every Slot whose order it changed', async () => {
		const eventId = await stageEvent();
		const [one, two, three, four] = await db.insert(schema.featureMatches)
			.values([
				{ eventId, sortOrder: 0 },
				{ eventId, sortOrder: 0 },
				{ eventId, sortOrder: 0 },
				{ eventId, sortOrder: 0 },
			])
			.returning();

		const answer = await featureMatchSlotWriteModule().reorder({ eventId, slotId: two!.id, direction: 'up' });

		const stored = (await slotsOf(eventId)).map(slot => ({ matchId: slot.id, sortOrder: slot.sortOrder }));
		expect(stored).toEqual([
			{ matchId: one!.id, sortOrder: 1 },
			{ matchId: two!.id, sortOrder: 0 },
			{ matchId: three!.id, sortOrder: 2 },
			{ matchId: four!.id, sortOrder: 3 },
		]);
		expect(answer.slots.toSorted((a, b) => a.matchId - b.matchId)).toEqual(stored);
		const announced = publishMessage.mock.calls.find(call => call[1] === 'featureMatch:reordered')![2] as {
			featureMatches: { featureMatchId: number; sortOrder: number }[];
		};
		expect(announced.featureMatches.toSorted((a, b) => a.featureMatchId - b.featureMatchId))
			.toEqual(stored.map(slot => ({ featureMatchId: slot.matchId, sortOrder: slot.sortOrder })));
	});
});
