import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Manual writes keep Melee provenance out, and the derived values (sort order,
// the created flag, the key-card order) come from the stored rows.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { phaseService } = await import('~~/server/services/phase');
const { roundService } = await import('~~/server/services/round');
const { matchService } = await import('~~/server/services/match');
const { archetypeCardService } = await import('~~/server/services/archetypeCard');

let eventId: number;
let phaseId: number;
let roundId: number;

beforeAll(async () => {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	eventId = event!.id;
	const [phase] = await db.insert(schema.phases)
		.values({ eventId, name: 'Swiss', sortOrder: 0 })
		.returning({ id: schema.phases.id });
	phaseId = phase!.id;
	const [round] = await db.insert(schema.rounds)
		.values({ eventId, phaseId, name: 'Round 1', roundNumber: 1 })
		.returning({ id: schema.rounds.id });
	roundId = round!.id;
});

afterAll(async () => await harness.close());

const forged = {
	id: 9_999,
	eventId: 9_999,
	externalId: 'forged-id',
	externalSource: 'melee',
	createdAt: new Date(0),
} as const;

describe('manual writes keep Melee provenance out', () => {
	it('a created Phase is manual, whatever the payload claims', async () => {
		const phase = await phaseService().create(eventId, { name: 'Top 8', formatExternalId: 'forged' , ...forged } as never);

		expect(phase).toMatchObject({ eventId, name: 'Top 8', externalId: null, externalSource: 'manual', formatExternalId: null });
		expect(phase.id).not.toBe(forged.id);
		expect(phase.createdAt.getTime()).toBeGreaterThan(0);
	});

	it('a created Round is manual, whatever the payload claims', async () => {
		const round = await roundService().create(eventId, { phaseId, name: 'Round 2', roundNumber: 2, lastSyncedAt: new Date(), ...forged } as never);

		expect(round).toMatchObject({ eventId, name: 'Round 2', externalId: null, externalSource: 'manual', lastSyncedAt: null });
		expect(round.id).not.toBe(forged.id);
	});

	it('a created Match is manual, whatever the payload claims', async () => {
		const match = await matchService().create(eventId, { roundId, ...forged } as never);

		expect(match).toMatchObject({ eventId, roundId, externalId: null, externalSource: 'manual' });
		expect(match.id).not.toBe(forged.id);
	});

	it.each([
		['Phase', () => phaseService(), { name: 'Renamed' }, 'name'],
		['Round', () => roundService(), { name: 'Renamed' }, 'name'],
		['Match', () => matchService(), { tableNumber: 9 }, 'tableNumber'],
	] as const)('an update to a synced %s writes the manual fields and leaves its Melee identity', async (_kind, service, change, field) => {
		const table = { Phase: schema.phases, Round: schema.rounds, Match: schema.matches }[_kind];
		const base = { Phase: { name: 'Synced', sortOrder: 5 }, Round: { phaseId, name: 'Synced', roundNumber: 9 }, Match: { roundId } }[_kind];
		const [row] = await db.insert(table)
			.values({ eventId, ...base, externalId: `melee-${_kind}`, externalSource: 'melee' } as never)
			.returning() as { id: number }[];

		const updated = await service().update(row!.id, eventId, { ...change, externalId: 'forged-id', externalSource: 'manual' } as never) as Record<string, unknown>;

		expect(updated[field]).toBe((change as Record<string, unknown>)[field]);
		expect(updated).toMatchObject({ externalId: `melee-${_kind}`, externalSource: 'melee' });
	});
});

describe('matchService.create sort order', () => {
	it('appends after the Round\'s last Match, starting from zero', async () => {
		const [round] = await db.insert(schema.rounds)
			.values({ eventId, phaseId, name: 'Sorting', roundNumber: 20 })
			.returning({ id: schema.rounds.id });

		const first = await matchService().create(eventId, { roundId: round!.id } as never);
		const second = await matchService().create(eventId, { roundId: round!.id } as never);
		const pinned = await matchService().create(eventId, { roundId: round!.id, sortOrder: 40 } as never);
		const after = await matchService().create(eventId, { roundId: round!.id } as never);

		expect([first.sortOrder, second.sortOrder, pinned.sortOrder, after.sortOrder]).toEqual([0, 1, 40, 41]);
	});
});

describe('phaseService.getMaxSortOrder', () => {
	it('answers -1 for an Event without Phases', async () => {
		const [empty] = await db.insert(schema.events)
			.values({ name: 'Empty', game: 'mtg', featureMatchOrientation: 'horizontal' })
			.returning({ id: schema.events.id });

		expect(await phaseService().getMaxSortOrder(empty!.id)).toBe(-1);
	});
});

describe('upsertByExternalId', () => {
	it.each([
		['Phase', () => phaseService().upsertByExternalId({ eventId, name: 'Melee Phase', sortOrder: 3, externalId: 'melee-phase', externalSource: 'melee' })],
		['Round', () => roundService().upsertByExternalId({ eventId, phaseId, name: 'Melee Round', roundNumber: 4, externalId: 'melee-round', externalSource: 'melee' } as never)],
	] as const)('reports a %s as created on first sight and as updated after', async (_kind, upsert) => {
		const first = await upsert() as { created: boolean; [key: string]: unknown };
		const second = await upsert() as { created: boolean; [key: string]: unknown };

		expect(first.created).toBe(true);
		expect(second.created).toBe(false);
		const firstRow = (first.phase ?? first.round) as { id: number };
		const secondRow = (second.phase ?? second.round) as { id: number };
		expect(secondRow.id).toBe(firstRow.id);
	});
});

describe('archetypeCardService key cards', () => {
	let archetypeId: number;
	let cardIds: number[];

	beforeAll(async () => {
		const [archetype] = await db.insert(schema.archetypes)
			.values({ eventId, name: 'Burn' })
			.returning({ id: schema.archetypes.id });
		archetypeId = archetype!.id;
		const inserted = await db.insert(schema.cards)
			.values(['Lightning Bolt', 'Lava Spike', 'Rift Bolt', 'Goblin Guide', 'Monastery Swiftspear', 'Eidolon of the Great Revel'].map(name => ({ name, game: 'mtg' as const })))
			.returning({ id: schema.cards.id });
		cardIds = inserted.map(card => card.id);
	});

	it('replaces the set, keeping the order given', async () => {
		await archetypeCardService().setKeyCards(archetypeId, [cardIds[0]!, cardIds[1]!]);
		const replaced = await archetypeCardService().setKeyCards(archetypeId, [cardIds[3]!, cardIds[2]!]);

		expect(replaced.map(card => [card.id, card.sortOrder])).toEqual([[cardIds[3], 0], [cardIds[2], 1]]);
		expect(await db.select().from(schema.archetypeCards).where(eq(schema.archetypeCards.archetypeId, archetypeId))).toHaveLength(2);
	});

	it('clears the set when given none', async () => {
		await archetypeCardService().setKeyCards(archetypeId, [cardIds[0]!]);

		expect(await archetypeCardService().setKeyCards(archetypeId, [])).toEqual([]);
		expect(await archetypeCardService().getKeyCards(archetypeId)).toEqual([]);
	});

	it('refuses a sixth key card and keeps the existing set', async () => {
		await archetypeCardService().setKeyCards(archetypeId, [cardIds[0]!]);

		await expect(archetypeCardService().setKeyCards(archetypeId, cardIds)).rejects.toThrow('at most 5 key cards');
		expect((await archetypeCardService().getKeyCards(archetypeId)).map(card => card.id)).toEqual([cardIds[0]]);
	});

	it('groups key cards by Archetype, in each one\'s order', async () => {
		const [other] = await db.insert(schema.archetypes)
			.values({ eventId, name: 'Prowess' })
			.returning({ id: schema.archetypes.id });
		await archetypeCardService().setKeyCards(archetypeId, [cardIds[1]!, cardIds[0]!]);
		await archetypeCardService().setKeyCards(other!.id, [cardIds[4]!]);

		const byArchetype = await archetypeCardService().getKeyCardsByArchetypeIds([other!.id, archetypeId]);

		expect(byArchetype.get(archetypeId)?.map(card => card.id)).toEqual([cardIds[1], cardIds[0]]);
		expect(byArchetype.get(other!.id)?.map(card => card.id)).toEqual([cardIds[4]]);
		expect(await archetypeCardService().getKeyCardsByArchetypeIds([])).toEqual(new Map());
	});
});
