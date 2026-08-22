import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

/**
 * Cross-Event scoping proofs for the roster CRUD services (#468): Players,
 * Player Lists, Talents, Archetypes and Event Card Name Overrides.
 *
 * Two Events hold colliding data — the same Melee external ids, the same
 * archetype name, the same normalized card-name override — so any read that
 * loses its Event predicate answers with the other Event's rows. The Player
 * List membership probes go one step further and plant a genuinely foreign
 * membership row (the junction table carries no event_id of its own), which
 * only the join's `eq(players.eventId, …)` keeps off the roster.
 */

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('hub:db', () => ({ db }));

const { playerService } = await import('~~/server/services/player');
const { playerListService } = await import('~~/server/services/playerList');
const { talentService } = await import('~~/server/services/talent');
const { archetypeService } = await import('~~/server/services/archetype');
const { eventCardNameOverrideService } = await import('~~/server/services/eventCardNameOverride');

interface SeededEvent {
	eventId: number;
	playerId: number;
	listId: number;
	talentId: number;
	archetypeId: number;
	overrideId: number;
}

let cardId: number;

async function seedEvent(name: string): Promise<SeededEvent> {
	const [event] = await db.insert(schema.events)
		.values({ name, game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	const eventId = event!.id;

	const [player] = await db.insert(schema.players)
		.values({ eventId, name: `${name} Player`, externalId: 'player-shared', externalSource: 'melee', isActive: true, lastSeenAt: new Date('2026-08-01T00:00:00Z') })
		.returning({ id: schema.players.id });
	const [list] = await db.insert(schema.playerLists)
		.values({ eventId, name: 'Shared List Name' })
		.returning({ id: schema.playerLists.id });
	await db.insert(schema.playerListMembers).values({ listId: list!.id, playerId: player!.id });
	const [talent] = await db.insert(schema.eventTalents)
		.values({ eventId, name: `${name} Talent` })
		.returning({ id: schema.eventTalents.id });
	const [archetype] = await db.insert(schema.archetypes)
		.values({ eventId, name: 'Shared Archetype' })
		.returning({ id: schema.archetypes.id });
	const [override] = await db.insert(schema.eventCardNameOverrides)
		.values({ eventId, inputName: 'Ragavan', normalizedInputName: 'ragavan', resolvedCardId: cardId })
		.returning({ id: schema.eventCardNameOverrides.id });

	return {
		eventId,
		playerId: player!.id,
		listId: list!.id,
		talentId: talent!.id,
		archetypeId: archetype!.id,
		overrideId: override!.id,
	};
}

let one: SeededEvent;
let two: SeededEvent;

beforeAll(async () => {
	const [card] = await db.insert(schema.cards)
		.values({ name: 'Ragavan, Nimble Pilferer', game: 'mtg' })
		.returning({ id: schema.cards.id });
	cardId = card!.id;
	one = await seedEvent('Event One');
	two = await seedEvent('Event Two');
});

afterAll(async () => await harness.close());

describe('playerService event scoping', () => {
	it('point reads and counts with the wrong Event find nothing', async () => {
		const service = playerService();
		expect(await service.findById(two.playerId, one.eventId)).toBeUndefined();
		expect(await service.countByIds(one.eventId, [two.playerId])).toBe(0);
	});

	it('findAll stays inside the asking Event, with and without a list', async () => {
		const service = playerService();
		expect((await service.findAll({ eventId: one.eventId })).map(player => player.id)).toEqual([one.playerId]);
		// Event 2's list id with Event 1's scope: the list belongs elsewhere.
		expect(await service.findAll({ eventId: one.eventId, listId: two.listId })).toEqual([]);
	});

	it('writes with the wrong Event touch nothing', async () => {
		const service = playerService();
		expect(await service.update(two.playerId, one.eventId, { name: 'Hijacked' })).toBeUndefined();
		expect(await service.remove(two.playerId, one.eventId)).toBe(false);
		expect((await service.findById(two.playerId, two.eventId))?.name).toBe('Event Two Player');
	});

	it('reconcileMeleeSnapshot deactivates only the asking Event\'s missing players', async () => {
		const service = playerService();
		// Both Events imported the same Melee identity. A snapshot for Event 1
		// that no longer contains it must deactivate Event 1's copy only.
		const result = await service.reconcileMeleeSnapshot(one.eventId, [
			{ name: 'Replacement', externalId: 'player-new', externalStatus: 1 },
		], new Date('2026-08-02T00:00:00Z'));
		expect(result).toMatchObject({ created: 1, deactivated: 1 });

		expect((await service.findById(one.playerId, one.eventId))?.isActive).toBe(false);
		expect((await service.findById(two.playerId, two.eventId))?.isActive).toBe(true);
		// And the upserted replacement landed in Event 1, not Event 2.
		expect((await service.findAll({ eventId: two.eventId })).map(player => player.id)).toEqual([two.playerId]);
	});
});

describe('playerListService event scoping', () => {
	it('point reads with the wrong Event find nothing', async () => {
		const service = playerListService();
		expect(await service.findById(two.listId, one.eventId)).toBeUndefined();
		expect(await service.findByIdWithMembers(two.listId, one.eventId)).toBeUndefined();
	});

	it('member reads refuse a foreign list outright', async () => {
		const service = playerListService();
		await expect(service.getMembers(two.listId, one.eventId)).rejects.toMatchObject({ statusCode: 404 });
		await expect(service.getMemberPlayerIds(two.listId, one.eventId)).rejects.toMatchObject({ statusCode: 404 });
		expect(await service.getMemberCount(two.listId, one.eventId)).toBe(0);
	});

	it('a planted foreign membership row never reaches the roster', async () => {
		// The junction table has no event_id; nothing but the join predicate
		// keeps a cross-Event member out.
		await db.insert(schema.playerListMembers).values({ listId: two.listId, playerId: one.playerId, sortOrder: 99 });

		const service = playerListService();
		expect((await service.getMembers(two.listId, two.eventId)).map(member => member.id)).toEqual([two.playerId]);
		expect(await service.getMemberPlayerIds(two.listId, two.eventId)).toEqual([two.playerId]);
		expect(await service.getMemberCount(two.listId, two.eventId)).toBe(1);
		const [listing] = await service.findByEventId(two.eventId);
		expect(listing?.memberCount).toBe(1);
	});

	it('lists only the asking Event', async () => {
		const service = playerListService();
		expect((await service.findByEventId(one.eventId)).map(list => list.id)).toEqual([one.listId]);
	});

	it('writes with the wrong Event touch nothing', async () => {
		const service = playerListService();
		expect(await service.update(two.listId, one.eventId, { name: 'Hijacked' })).toBeUndefined();
		expect(await service.remove(two.listId, one.eventId)).toBe(false);
		await expect(service.addMembers(two.listId, one.eventId, [one.playerId])).rejects.toMatchObject({ statusCode: 404 });
		expect((await service.findById(two.listId, two.eventId))?.name).toBe('Shared List Name');
	});
});

describe('talentService event scoping', () => {
	it('reads with the wrong Event find nothing', async () => {
		const service = talentService();
		expect(await service.findById(two.talentId, one.eventId)).toBeUndefined();
		expect((await service.findByEventId(one.eventId)).map(talent => talent.id)).toEqual([one.talentId]);
	});

	it('writes with the wrong Event touch nothing', async () => {
		const service = talentService();
		expect(await service.update(two.talentId, one.eventId, { name: 'Hijacked' })).toBeUndefined();
		expect(await service.remove(two.talentId, one.eventId)).toBe(false);
		expect((await service.findById(two.talentId, two.eventId))?.name).toBe('Event Two Talent');
	});
});

describe('archetypeService event scoping', () => {
	it('reads with the wrong Event find nothing', async () => {
		const service = archetypeService();
		expect(await service.findById(two.archetypeId, one.eventId)).toBeUndefined();
		expect(await service.findManyByIds(one.eventId, [two.archetypeId])).toEqual([]);
		expect((await service.findByEventId(one.eventId)).map(archetype => archetype.id)).toEqual([one.archetypeId]);
	});

	it('writes with the wrong Event touch nothing', async () => {
		const service = archetypeService();
		expect(await service.update(two.archetypeId, one.eventId, { name: 'Hijacked' })).toBeUndefined();
		expect(await service.remove(two.archetypeId, one.eventId)).toBe(false);
		expect((await service.findById(two.archetypeId, two.eventId))?.name).toBe('Shared Archetype');
	});
});

describe('eventCardNameOverrideService event scoping', () => {
	it('resolves only the asking Event\'s overrides for a shared normalized name', async () => {
		const service = eventCardNameOverrideService();
		const resolved = await service.listResolvedByEvent(one.eventId);
		expect(resolved.map(override => override.id)).toEqual([one.overrideId]);
		expect(resolved[0]?.card.name).toBe('Ragavan, Nimble Pilferer');
	});
});
