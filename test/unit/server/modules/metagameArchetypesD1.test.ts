import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

/**
 * The Metagame Archetype breakdown at the Archetype counts an Event reaches (#702).
 *
 * The breakdown looked up the represented Archetypes with one parameter per id
 * plus the Event's, so on D1 — which fails a statement on its
 * hundred-and-first parameter — a hundred represented Archetypes failed every
 * Metagame read, and a small requested limit did not help because it applied
 * after the lookup. The libSQL harness accepts several hundred parameters, so
 * this runs against a real D1 binding.
 *
 * The large Event: 120 represented Archetypes, named `Archetype 001` to `120`,
 * plus one with no Players. `001` has four Players (3-1 each, positions 1-4),
 * `002` three (1-1, positions 5-7), and every other one Player (1-1, no
 * position): 125 classified Players. Five more Players carry no Archetype.
 * `001` has two key cards and `120` — past any first group of fifty ids — one.
 */

const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const db = drizzle(harness.database, { schema });

afterAll(async () => await harness.dispose());

vi.doMock('~~/server/db', () => ({ db }));

const { metagameReadModel } = await import('~~/server/modules/metagame/readModel');

const REPRESENTED = 120;

function archetypeName(index: number) {
	return `Archetype ${String(index).padStart(3, '0')}`;
}

async function insertAll<T>(rows: T[], insert: (row: T, index: number) => Parameters<typeof db.batch>[0][number]) {
	const [first, ...rest] = rows.map(insert);
	if (first)
		await db.batch([first, ...rest]);
}

async function stageEvent(name: string) {
	const [event] = await db.insert(schema.events)
		.values({ name, game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning();
	return event!.id;
}

async function stageArchetypes(eventId: number, names: string[]) {
	await insertAll(names, name => db.insert(schema.archetypes).values({ eventId, name }));
	const rows = await db.query.archetypes.findMany({
		where: (archetypes, { eq }) => eq(archetypes.eventId, eventId),
	});
	return new Map(rows.map(row => [row.name, row.id]));
}

interface StagedPlayer {
	archetypeId: number | null;
	wins: number;
	losses: number;
	position: number | null;
}

async function stagePlayers(eventId: number, players: StagedPlayer[]) {
	await insertAll(players, (player, index) => db.insert(schema.players).values({
		eventId,
		name: `Player ${index}`,
		...player,
	}));
}

async function stageCard(name: string) {
	const [card] = await db.insert(schema.cards).values({ name, game: 'mtg' }).returning();
	return card!;
}

let largeEventId: number;
let keyCards: { first: string[]; last: string[] };

beforeAll(async () => {
	largeEventId = await stageEvent('Large Metagame');
	const names = Array.from({ length: REPRESENTED + 1 }, (_, index) => archetypeName(index + 1));
	const ids = await stageArchetypes(largeEventId, names);
	const idOf = (index: number) => ids.get(archetypeName(index))!;

	const players: StagedPlayer[] = [
		...[1, 2, 3, 4].map(position => ({
			archetypeId: idOf(1),
			wins: 3,
			losses: 1,
			position,
		})),
		...[5, 6, 7].map(position => ({
			archetypeId: idOf(2),
			wins: 1,
			losses: 1,
			position,
		})),
		...Array.from({ length: REPRESENTED - 2 }, (_, index) => ({
			archetypeId: idOf(index + 3),
			wins: 1,
			losses: 1,
			position: null,
		})),
		...Array.from({ length: 5 }, () => ({
			archetypeId: null,
			wins: 0,
			losses: 0,
			position: null,
		})),
	];
	await stagePlayers(largeEventId, players);

	const [bolt, guide, wrath] = [await stageCard('Lightning Bolt'), await stageCard('Goblin Guide'), await stageCard('Wrath of God')];
	await db.insert(schema.archetypeCards).values([
		{
			archetypeId: idOf(1),
			cardId: guide!.id,
			sortOrder: 0,
		},
		{
			archetypeId: idOf(1),
			cardId: bolt!.id,
			sortOrder: 1,
		},
		{
			archetypeId: idOf(REPRESENTED),
			cardId: wrath!.id,
			sortOrder: 0,
		},
	]);
	keyCards = {
		first: ['Goblin Guide', 'Lightning Bolt'],
		last: ['Wrath of God'],
	};
});

describe('the Metagame Archetype breakdown on D1', () => {
	describe('with a hundred and more represented Archetypes', () => {
		it('answers every represented Archetype with its counts, shares, ordering and key cards', async () => {
			const breakdown = await metagameReadModel().getArchetypeBreakdown(largeEventId, { scope: 'all' });

			expect(breakdown).toMatchObject({ totalPlayers: 130, classifiedPlayers: 125, scope: 'all' });
			expect(breakdown.entries).toHaveLength(REPRESENTED);
			expect(breakdown.entries.map(entry => entry.name))
				.toEqual(Array.from({ length: REPRESENTED }, (_, index) => archetypeName(index + 1)));

			const [first, second, third] = breakdown.entries;
			expect(first).toMatchObject({
				count: 4,
				metaShare: 3.2,
				winRate: 75,
				avgPosition: 2.5,
			});
			expect(first!.keyCards.map(card => card.name)).toEqual(keyCards.first);
			expect(second).toMatchObject({
				count: 3,
				metaShare: 2.4,
				winRate: 50,
				avgPosition: 6,
				keyCards: [],
			});
			expect(third).toMatchObject({
				count: 1,
				metaShare: 0.8,
				winRate: 50,
				avgPosition: null,
				keyCards: [],
			});
			expect(breakdown.entries.at(-1)!.keyCards.map(card => card.name)).toEqual(keyCards.last);
		});

		it('answers a small requested limit with the leading Archetypes and the rest aggregated as Other', async () => {
			const breakdown = await metagameReadModel().getArchetypeBreakdown(largeEventId, { scope: 'all', limit: 5 });

			expect(breakdown.entries.map(entry => entry.name))
				.toEqual([1, 2, 3, 4, 5].map(archetypeName).concat('Other'));
			expect(breakdown.entries[0]!.keyCards.map(card => card.name)).toEqual(keyCards.first);
			expect(breakdown.entries.at(-1)).toEqual({
				id: -1,
				name: 'Other',
				colors: null,
				count: 115,
				metaShare: 92,
				winRate: 50,
				avgPosition: null,
				conversionRate: null,
				keyCards: [],
			});
		});

		it('answers the operator summary', async () => {
			const summary = await metagameReadModel().getSummary(largeEventId, { scope: 'all' });

			expect(summary).toMatchObject({
				totalPlayers: 130,
				classifiedPlayers: 125,
				totalArchetypes: REPRESENTED + 1,
				scopedArchetypeCount: REPRESENTED,
			});
			expect(summary.topArchetypes.map(entry => entry.name)).toEqual([1, 2, 3, 4, 5].map(archetypeName));
			expect(summary.topArchetypes[0]!.keyCards.map(card => card.name)).toEqual(keyCards.first);
		});
	});

	it('answers an empty scope with no entries', async () => {
		const eventId = await stageEvent('Empty Metagame');

		expect(await metagameReadModel().getArchetypeBreakdown(eventId, { scope: 'all', limit: 5 }))
			.toEqual({
				entries: [],
				totalPlayers: 0,
				classifiedPlayers: 0,
				scope: 'all',
			});
	});

	it('answers an ordinary small scope, naming only the Event\'s own Archetypes', async () => {
		const eventId = await stageEvent('Small Metagame');
		const ids = await stageArchetypes(eventId, ['Mono Red', 'Azorius Control']);
		const elsewhere = await stageArchetypes(await stageEvent('Elsewhere'), ['Foreign']);
		await stagePlayers(eventId, [
			{
				archetypeId: ids.get('Mono Red')!,
				wins: 2,
				losses: 0,
				position: 1,
			},
			{
				archetypeId: ids.get('Mono Red')!,
				wins: 0,
				losses: 2,
				position: 3,
			},
			{
				archetypeId: ids.get('Azorius Control')!,
				wins: 1,
				losses: 1,
				position: 2,
			},
			{
				archetypeId: elsewhere.get('Foreign')!,
				wins: 1,
				losses: 1,
				position: 4,
			},
		]);

		const breakdown = await metagameReadModel().getArchetypeBreakdown(eventId, { scope: 'all', limit: 5 });

		expect(breakdown.entries.map(({ name, count, winRate, avgPosition }) => ({ name, count, winRate, avgPosition }))).toEqual([
			{
				name: 'Mono Red',
				count: 2,
				winRate: 50,
				avgPosition: 2,
			},
			{
				name: 'Azorius Control',
				count: 1,
				winRate: 50,
				avgPosition: 2,
			},
		]);
	});
});
