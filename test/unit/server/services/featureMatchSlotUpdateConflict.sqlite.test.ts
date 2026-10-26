import type { UpdateFeatureMatchInput } from '~~/shared/api';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Two operators editing one Slot: the write is compare-and-swap on everything its decision
// read, so the loser matches no row and gets a state conflict (#462). The winner's update is
// injected into the loser's read-to-write window.

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

const { featureMatchService } = await import('~~/server/services/featureMatch');

afterAll(async () => {
	await harness.close();
});

const [event] = await db.insert(schema.events).values({
	name: 'Write Integrity Open',
	game: 'mtg',
	featureMatchOrientation: 'horizontal',
}).returning();
const eventId = event!.id;

const seededPlayers = await db.insert(schema.players).values([
	{ eventId, name: 'Player One' },
	{ eventId, name: 'Player Two' },
]).returning();
const playerOneId = seededPlayers[0]!.id;
const playerTwoId = seededPlayers[1]!.id;

/**
 * Runs once inside the next `update` call's read-to-write window: the loser's
 * initial Slot read resolves first, then this runs to completion, then the
 * loser continues against its now-stale read.
 */
let interleave: (() => Promise<unknown>) | null = null;

// Patched by assignment rather than `vi.spyOn`: the suite config restores
// spies before every test, and this patch must hold for the whole file.
const slotReads = db.query.featureMatches;
const realFindFirst = slotReads.findFirst.bind(slotReads) as (config?: unknown) => Promise<unknown>;
slotReads.findFirst = (async (config?: unknown) => {
	const row = await realFindFirst(config);
	if (interleave) {
		const run = interleave;
		interleave = null;
		await run();
	}
	return row;
}) as typeof slotReads.findFirst;

async function activeSessionCountForSlot(slotId: number): Promise<number> {
	const rows = await db.query.featureMatchSessions.findMany({
		where: (sessions, { and, eq }) => and(eq(sessions.slotId, slotId), eq(sessions.status, 'active')),
	});
	return rows.length;
}

describe('featureMatchService concurrent slot update integrity', () => {
	it('rejects the loser of two interleaved updates with a state conflict and keeps the winner intact', async () => {
		const service = featureMatchService();
		const slot = await service.create(eventId, {});
		const sessionBeforeRace = slot.activeSessionId;
		expect(sessionBeforeRace).not.toBeNull();

		// The winner's entire update runs inside the loser's read-to-write window.
		interleave = () => service.update(slot.id, eventId, { player1Id: playerOneId } as UpdateFeatureMatchInput);

		await expect(
			service.update(slot.id, eventId, { player2Id: playerTwoId } as UpdateFeatureMatchInput),
		).rejects.toMatchObject({ statusCode: 409 });

		const after = await service.findById(slot.id, eventId);
		expect(after?.player1Id).toBe(playerOneId);
		expect(after?.player2Id).toBeNull();

		// The winner re-paired the Slot, so it opened a fresh Session; the loser
		// must have added nothing on top of it.
		expect(after?.activeSessionId).not.toBe(sessionBeforeRace);
		expect(after?.activeSession?.sourceSnapshot.player1.playerId).toBe(playerOneId);
		expect(after?.activeSession?.sourceSnapshot.player2.playerId).toBeNull();
		expect(await activeSessionCountForSlot(slot.id)).toBe(1);
	});

	it('lets the losing operator retry successfully against a fresh read', async () => {
		const service = featureMatchService();
		const slot = await service.create(eventId, {});

		interleave = () => service.update(slot.id, eventId, { player1Id: playerOneId } as UpdateFeatureMatchInput);
		await expect(
			service.update(slot.id, eventId, { player2Id: playerTwoId } as UpdateFeatureMatchInput),
		).rejects.toMatchObject({ statusCode: 409 });

		const retried = await service.update(slot.id, eventId, { player2Id: playerTwoId } as UpdateFeatureMatchInput);

		expect(retried?.player1Id).toBe(playerOneId);
		expect(retried?.player2Id).toBe(playerTwoId);
		expect(await activeSessionCountForSlot(slot.id)).toBe(1);
	});

	it('still reports not-found rather than a conflict when the slot was deleted mid-update', async () => {
		const service = featureMatchService();
		const slot = await service.create(eventId, {});

		interleave = () => service.remove(slot.id, eventId);

		const result = await service.update(slot.id, eventId, { player1Id: playerOneId } as UpdateFeatureMatchInput);

		expect(result).toBeUndefined();
	});
});
