import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Every path that opens a Feature Match Session announces it (#593).
 *
 * A client learns of a new epoch from that epoch's own `SessionStarted`, and
 * every Graphic Input Binding reading the Slot re-resolves — whichever path
 * opened it. Before, only the sessions route did both, and the rest relied on a
 * later Feature Match message happening to carry the new Session.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const publishMessage = vi.fn(async (..._args: unknown[]) => {});
const refreshBroadcastGraphicsBindings = vi.fn(async (_eventId: number) => {});

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage,
	publishMessageStrict: publishMessage,
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/services/meleeCredentials', () => ({
	protectMeleeClientSecret: async (secret: string) => `encrypted:${secret}`,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings,
}));

const { featureMatchService } = await import('~~/server/services/featureMatch');
const { featureMatchSessionModule } = await import('~~/server/modules/feature-match-session');
const { featureMatchPromotionModule } = await import('~~/server/modules/feature-match-promotion');
const { eventService } = await import('~~/server/services/event');

beforeEach(() => {
	publishMessage.mockClear();
	refreshBroadcastGraphicsBindings.mockClear();
});

afterAll(async () => {
	await harness.close();
});

async function stageEvent() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Openers', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning();
	return event!.id;
}

async function activeSessionId(eventId: number, slotId: number): Promise<number | undefined> {
	const session = await db.query.featureMatchSessions.findFirst({
		where: and(
			eq(schema.featureMatchSessions.eventId, eventId),
			eq(schema.featureMatchSessions.slotId, slotId),
			eq(schema.featureMatchSessions.status, 'active'),
		),
	});
	return session?.id;
}

/** The Sessions announced as started, by Slot, in announcement order. */
function startedSessions(eventId: number) {
	return publishMessage.mock.calls
		.filter(([publishedTo, type, payload]) => publishedTo === eventId
			&& type === 'featureMatchSession:eventApplied'
			&& (payload as { eventType: string }).eventType === 'SessionStarted')
		.map(([, , payload]) => {
			const { slotId, sessionId, sequence } = payload as { slotId: number; sessionId: number; sequence: number };
			return { slotId, sessionId, sequence };
		});
}

/** Each Slot's active Session was announced, and bindings refreshed after the announcement. */
async function expectAnnounced(eventId: number, slotIds: number[]) {
	const expected = [];
	for (const slotId of slotIds)
		expected.push({ slotId, sessionId: await activeSessionId(eventId, slotId), sequence: 1 });
	expect(startedSessions(eventId)).toEqual(expect.arrayContaining(expected));
	expect(startedSessions(eventId)).toHaveLength(slotIds.length);

	expect(refreshBroadcastGraphicsBindings).toHaveBeenCalledWith(eventId);
	const lastStarted = publishMessage.mock.invocationCallOrder.findLast((_, index) =>
		publishMessage.mock.calls[index]![1] === 'featureMatchSession:eventApplied');
	expect(Math.max(...refreshBroadcastGraphicsBindings.mock.invocationCallOrder)).toBeGreaterThan(lastStarted!);
}

describe('opening a Feature Match Session announces it', () => {
	it('from the sessions route', async () => {
		const eventId = await stageEvent();
		const slot = await featureMatchService().create(eventId, {});
		publishMessage.mockClear();
		refreshBroadcastGraphicsBindings.mockClear();

		const session = await featureMatchSessionModule().createSessionForSlot(slot.id, eventId, 'origin');

		expect(session?.id).toBe(await activeSessionId(eventId, slot.id));
		await expectAnnounced(eventId, [slot.id]);
		expect(publishMessage).toHaveBeenCalledWith(eventId, 'featureMatchSession:eventApplied', expect.anything(), 'origin');
	});

	it('relinking the Slot and forgetting the ended Session\'s receipts in the same commit', async () => {
		const eventId = await stageEvent();
		const slot = await featureMatchService().create(eventId, {});
		const ended = (await activeSessionId(eventId, slot.id))!;
		await featureMatchSessionModule().applyCommand(ended, eventId, {
			commandId: 'cmd-1',
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 18 },
			baseSequence: 1,
		});
		const receipts = async (sessionId: number) => (await harness.client.execute({
			sql: `select count(*) as count from live_state_command_receipts where aggregate_kind = 'featureMatchSession' and aggregate_id = ?`,
			args: [sessionId],
		})).rows[0]!.count;
		expect(await receipts(ended)).toBe(1);

		const opened = await featureMatchSessionModule().createSessionForSlot(slot.id, eventId);

		expect(await receipts(ended)).toBe(0);
		expect((await db.query.featureMatches.findFirst({
			where: eq(schema.featureMatches.id, slot.id),
		}))?.activeSessionId)
			.toBe(opened?.id);
		// The same command id is a new command in the new Session.
		await expect(featureMatchSessionModule().applyCommand(opened!.id, eventId, {
			commandId: 'cmd-1',
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 12 },
			baseSequence: 1,
		})).resolves.toMatchObject({ sessionId: opened!.id, sequence: 2 });
	});

	it('when a Slot is created', async () => {
		const eventId = await stageEvent();

		const slot = await featureMatchService().create(eventId, {});

		await expectAnnounced(eventId, [slot.id]);
	});

	it('when Slots are created to reach a count, refreshing bindings once', async () => {
		const eventId = await stageEvent();

		const { created } = await featureMatchService().syncFeatureMatches(eventId, 3);

		await expectAnnounced(eventId, created.map(slot => slot.id));
		expect(refreshBroadcastGraphicsBindings).toHaveBeenCalledTimes(1);
	});

	it('when a Slot update changes its pairing identity', async () => {
		const eventId = await stageEvent();
		const slot = await featureMatchService().create(eventId, {});
		const previous = await activeSessionId(eventId, slot.id);
		const [player] = await db.insert(schema.players).values({ eventId, name: 'Mia' }).returning();
		publishMessage.mockClear();
		refreshBroadcastGraphicsBindings.mockClear();

		await featureMatchService().update(slot.id, eventId, { player1Id: player!.id });

		expect(await activeSessionId(eventId, slot.id)).not.toBe(previous);
		await expectAnnounced(eventId, [slot.id]);
	});

	it('when a command finds the Slot without an active Session', async () => {
		const eventId = await stageEvent();
		const slot = await featureMatchService().create(eventId, {});
		await db.update(schema.featureMatchSessions)
			.set({
				status: 'closed',
				closedAt: new Date(),
			})
			.where(eq(schema.featureMatchSessions.slotId, slot.id));
		await db.update(schema.featureMatches).set({ activeSessionId: null }).where(eq(schema.featureMatches.id, slot.id));
		publishMessage.mockClear();
		refreshBroadcastGraphicsBindings.mockClear();

		await featureMatchService().update(slot.id, eventId, { bestOf: 5 });

		await expectAnnounced(eventId, [slot.id]);
	});

	it('when a Melee reset clears imported Slots, and only those', async () => {
		const eventId = await stageEvent();
		const imported = await featureMatchService().create(eventId, {});
		const manual = await featureMatchService().create(eventId, {});
		await db.update(schema.featureMatches)
			.set({ externalSource: 'melee', externalId: 'melee-1' })
			.where(eq(schema.featureMatches.id, imported.id));
		await db.update(schema.events).set({ meleeEnabled: true, meleeEventId: 'old' }).where(eq(schema.events.id, eventId));
		const untouched = await activeSessionId(eventId, manual.id);
		publishMessage.mockClear();
		refreshBroadcastGraphicsBindings.mockClear();

		await eventService().updateMeleeConfig(eventId, { meleeEnabled: false, meleeEventId: null, meleeClientId: null });

		await expectAnnounced(eventId, [imported.id]);
		expect(await activeSessionId(eventId, manual.id)).toBe(untouched);
		expect((await db.query.featureMatches.findFirst({
			where: eq(schema.featureMatches.id, imported.id),
		}))?.externalSource).toBeNull();
	});

	it('when a promotion opens the promoted Slot\'s Session and resets the Slot it clears', async () => {
		const eventId = await stageEvent();
		const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss', sortOrder: 0 }).returning();
		const [round] = await db.insert(schema.rounds)
			.values({
				eventId,
				phaseId: phase!.id,
				name: 'Round 1',
				roundNumber: 1,
			})
			.returning();
		const [match] = await db.insert(schema.matches)
			.values({
				eventId,
				roundId: round!.id,
				tableNumber: 1,
				sortOrder: 0,
			})
			.returning();
		const first = await featureMatchService().create(eventId, {});
		const second = await featureMatchService().create(eventId, {});
		await featureMatchPromotionModule().promoteMatchToSlot({ eventId, slotId: first.id, matchId: match!.id });
		publishMessage.mockClear();
		refreshBroadcastGraphicsBindings.mockClear();

		await featureMatchPromotionModule().promoteMatchToSlot({ eventId, slotId: second.id, matchId: match!.id });

		await expectAnnounced(eventId, [first.id, second.id]);
	});
});
