import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * A Feature Match Slot that has held a Session always holds one (#658).
 *
 * Clients order a Slot read by the Session it carries, and refuse one carrying
 * none over a Slot whose Session they hold (ADR-0026). That is only right while
 * no path ends a Slot's Session without opening its successor in the same
 * commit, so every path that ends one, or touches what a Session reads, is
 * pinned here against SQLite: each Slot still links exactly one active Session.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/ably', () => ({
	publishMessage: async () => {},
	publishMessageStrict: async () => {},
	publishScreenCommand: async () => {},
	getOriginConnectionId: () => undefined,
}));
vi.doMock('~~/server/services/meleeCredentials', () => ({
	protectMeleeClientSecret: async (secret: string) => `encrypted:${secret}`,
}));
vi.doMock('~~/server/modules/broadcast-graphics-live-session', async importOriginal => ({
	...await importOriginal<object>(),
	refreshBroadcastGraphicsBindings: async () => {},
}));

const { featureMatchService } = await import('~~/server/services/featureMatch');
const { featureMatchSessionModule } = await import('~~/server/modules/feature-match-session');
const { featureMatchPromotionModule } = await import('~~/server/modules/feature-match-promotion');
const { eventService } = await import('~~/server/services/event');
const { matchService } = await import('~~/server/services/match');
const { playerService } = await import('~~/server/services/player');

afterAll(async () => {
	await harness.close();
});

async function stageEvent() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Keeps its Session', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning();
	const eventId = event!.id;
	const [phase] = await db.insert(schema.phases).values({ eventId, name: 'Swiss', sortOrder: 0 }).returning();
	const [round] = await db.insert(schema.rounds)
		.values({ eventId, phaseId: phase!.id, name: 'Round 1', roundNumber: 1 })
		.returning();
	const [player1, player2] = await db.insert(schema.players)
		.values([{ eventId, name: 'Mia' }, { eventId, name: 'Rei' }])
		.returning();
	const [match] = await db.insert(schema.matches)
		.values({ eventId, roundId: round!.id, tableNumber: 1, sortOrder: 0, player1Id: player1!.id, player2Id: player2!.id })
		.returning();
	const first = await featureMatchService().create(eventId, {});
	const second = await featureMatchService().create(eventId, {});
	return { eventId, matchId: match!.id, player1Id: player1!.id, slotIds: [first.id, second.id] };
}

/** Each Slot links exactly one active Session of its own; answers those Session ids by Slot. */
async function expectEverySlotHoldsASession(eventId: number) {
	const slots = await db.query.featureMatches.findMany({ where: eq(schema.featureMatches.eventId, eventId) });
	const held = new Map<number, number>();
	for (const slot of slots) {
		const active = await db.query.featureMatchSessions.findMany({
			where: and(
				eq(schema.featureMatchSessions.slotId, slot.id),
				eq(schema.featureMatchSessions.status, 'active'),
			),
		});
		expect(active.map(session => session.id), `Slot ${slot.id}'s active Sessions`).toEqual([slot.activeSessionId]);
		expect(slot.activeSessionId, `Slot ${slot.id}'s Session`).not.toBeNull();
		held.set(slot.id, slot.activeSessionId!);
	}
	return held;
}

describe('a Feature Match Slot that has held a Session still holds one', () => {
	it('after a Slot Promotion, in the promoted Slot and the Slot it clears', async () => {
		const { eventId, matchId, slotIds: [first, second] } = await stageEvent();
		await featureMatchPromotionModule().promoteMatchToSlot({ eventId, slotId: first!, matchId });
		const before = await expectEverySlotHoldsASession(eventId);

		await featureMatchPromotionModule().promoteMatchToSlot({ eventId, slotId: second!, matchId });

		const after = await expectEverySlotHoldsASession(eventId);
		expect(after.get(first!)).not.toBe(before.get(first!));
		expect(after.get(second!)).not.toBe(before.get(second!));
		expect((await featureMatchService().findById(first!, eventId))?.matchId).toBeNull();
	});

	it('after a Melee reset clears an imported Slot', async () => {
		const { eventId, slotIds: [imported] } = await stageEvent();
		await db.update(schema.featureMatches)
			.set({ externalSource: 'melee', externalId: 'melee-1' })
			.where(eq(schema.featureMatches.id, imported!));
		await db.update(schema.events).set({ meleeEnabled: true, meleeEventId: 'old' }).where(eq(schema.events.id, eventId));
		const before = await expectEverySlotHoldsASession(eventId);

		await eventService().updateMeleeConfig(eventId, { meleeEnabled: false, meleeEventId: null, meleeClientId: null });

		const after = await expectEverySlotHoldsASession(eventId);
		expect(after.get(imported!)).not.toBe(before.get(imported!));
	});

	it('after Slot settings change the pairing, then unset the Match', async () => {
		const { eventId, matchId, player1Id, slotIds: [slot] } = await stageEvent();
		const opened = await expectEverySlotHoldsASession(eventId);

		await featureMatchService().update(slot!, eventId, { player1Id });
		const changed = await expectEverySlotHoldsASession(eventId);
		await featureMatchService().update(slot!, eventId, { matchId });
		await featureMatchService().update(slot!, eventId, { matchId: null, player1Id: null, player2Id: null });

		const unset = await expectEverySlotHoldsASession(eventId);
		expect(changed.get(slot!)).not.toBe(opened.get(slot!));
		expect(unset.get(slot!)).not.toBe(changed.get(slot!));
	});

	it('after the sessions route starts the Slot over', async () => {
		const { eventId, slotIds: [slot] } = await stageEvent();
		const before = await expectEverySlotHoldsASession(eventId);

		await featureMatchSessionModule().createSessionForSlot(slot!, eventId);

		const after = await expectEverySlotHoldsASession(eventId);
		expect(after.get(slot!)).not.toBe(before.get(slot!));
	});

	it('after the Match it shows is deleted, keeping its Session', async () => {
		const { eventId, matchId, slotIds: [slot] } = await stageEvent();
		await featureMatchPromotionModule().promoteMatchToSlot({ eventId, slotId: slot!, matchId });
		const before = await expectEverySlotHoldsASession(eventId);

		await matchService().remove(matchId, eventId);

		expect(await expectEverySlotHoldsASession(eventId)).toEqual(before);
		expect((await featureMatchService().findById(slot!, eventId))?.matchId).toBeNull();
	});

	it('after a Player it shows is deleted, keeping its Session', async () => {
		const { eventId, player1Id, slotIds: [slot] } = await stageEvent();
		await featureMatchService().update(slot!, eventId, { player1Id });
		const before = await expectEverySlotHoldsASession(eventId);

		await playerService().remove(player1Id, eventId);

		expect(await expectEverySlotHoldsASession(eventId)).toEqual(before);
		expect((await featureMatchService().findById(slot!, eventId))?.player1Id).toBeNull();
	});
});
