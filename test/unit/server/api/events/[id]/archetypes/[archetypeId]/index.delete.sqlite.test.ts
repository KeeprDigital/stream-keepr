import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Deleting an Archetype clears the deck reviews that named it in the same
// batch, then refreshes the Players whose decks it classified.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

const mockReconcileDeckProjections = vi.fn();
const mockPublishPlayerSnapshotUpdates = vi.fn();
const mockArchetypeDeleted = vi.fn();
const params = vi.fn();

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', params);
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message), input));

vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/modules/player-update', () => ({
	playerUpdateModule: () => ({
		reconcileDeckProjections: mockReconcileDeckProjections,
		publishPlayerSnapshotUpdates: mockPublishPlayerSnapshotUpdates,
	}),
}));
vi.doMock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => ({ archetypeDeleted: mockArchetypeDeleted }),
}));
vi.doMock('~~/server/utils/ably', () => ({
	getOriginConnectionId: () => 'origin-1',
}));

const { default: handler } = await import('~~/server/api/events/[id]/archetypes/[archetypeId]/index.delete');

afterAll(async () => await harness.close());

async function stage() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [archetype] = await db.insert(schema.archetypes)
		.values({ eventId, name: 'Burn' })
		.returning({ id: schema.archetypes.id });
	const [primary, secondary] = await db.insert(schema.players)
		.values([
			{ eventId, name: 'Primary' },
			{ eventId, name: 'Secondary' },
		])
		.returning({ id: schema.players.id });
	const reviewed = {
		archetypeId: archetype!.id,
		reviewedAt: new Date('2026-09-01T00:00:00Z'),
		externalSource: 'melee' as const,
		formatExternalId: 'format',
		eventId,
	};
	await db.insert(schema.playerDecks).values([
		{
			...reviewed,
			playerId: primary!.id,
			externalId: `${eventId}-a`,
			name: 'A',
			isPrimary: true,
		},
		{
			...reviewed,
			playerId: secondary!.id,
			externalId: `${eventId}-b`,
			name: 'B',
			isPrimary: false,
		},
	]);
	return {
		eventId,
		archetypeId: archetype!.id,
		primaryId: primary!.id,
		secondaryId: secondary!.id,
	};
}

describe('delete /api/events/[id]/archetypes/[archetypeId]', () => {
	beforeEach(() => {
		mockReconcileDeckProjections.mockResolvedValue([]);
		mockPublishPlayerSnapshotUpdates.mockResolvedValue([]);
		mockArchetypeDeleted.mockResolvedValue(undefined);
	});

	it('removes the Archetype and clears every deck review that named it', async () => {
		const { eventId, archetypeId, primaryId, secondaryId } = await stage();
		params.mockResolvedValue({ id: eventId, archetypeId });

		await expect(handler({} as never)).resolves.toEqual({ success: true });

		expect(await db.select().from(schema.archetypes).where(eq(schema.archetypes.id, archetypeId))).toEqual([]);
		const decks = await db.select().from(schema.playerDecks).where(eq(schema.playerDecks.eventId, eventId));
		expect(decks.map(deck => [deck.archetypeId, deck.reviewedAt])).toEqual([
			[null, null],
			[null, null],
		]);
		expect(mockReconcileDeckProjections).toHaveBeenCalledWith({
			eventId,
			playerIds: [primaryId],
			originConnectionId: 'origin-1',
		});
		expect(mockPublishPlayerSnapshotUpdates).toHaveBeenCalledWith({
			eventId,
			playerIds: [secondaryId],
			originConnectionId: 'origin-1',
		});
		expect(mockArchetypeDeleted).toHaveBeenCalledWith({ eventId, id: archetypeId, originConnectionId: 'origin-1' });
	});

	it('answers 404 for another Event\'s Archetype and changes nothing', async () => {
		const { archetypeId } = await stage();
		const { eventId: otherEventId } = await stage();
		params.mockResolvedValue({ id: otherEventId, archetypeId });

		await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 404 });

		expect(await db.select().from(schema.archetypes).where(eq(schema.archetypes.id, archetypeId))).toHaveLength(1);
		expect(mockArchetypeDeleted).not.toHaveBeenCalled();
	});
});
