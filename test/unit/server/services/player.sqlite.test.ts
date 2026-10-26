import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Player writes over real SQL: manual writes keep Melee provenance out, and a
// Melee snapshot reconciles the roster in one batch. Removing a Player's Deck
// Sources is proved in deckSourceInvariants.sqlite.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { playerService } = await import('~~/server/services/player');

afterAll(async () => await harness.close());

async function stageEvent() {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	return event!.id;
}

async function roster(eventId: number) {
	return await db.select().from(schema.players).where(eq(schema.players.eventId, eventId)).orderBy(asc(schema.players.externalId));
}

describe('manual writes', () => {
	it('keep Melee provenance out of a created and an updated Player', async () => {
		const eventId = await stageEvent();
		const forged = {
			externalId: 'forged-id',
			externalSource: 'melee',
			externalStatus: 2,
			isActive: false,
			lastSeenAt: new Date(0),
		};

		const created = await playerService().create(eventId, { name: 'Forger', ...forged } as never);
		await playerService().update(created.id, eventId, { name: 'Renamed', ...forged } as never);

		expect((await roster(eventId))[0]).toMatchObject({
			name: 'Renamed',
			externalId: null,
			externalSource: null,
			externalStatus: null,
			isActive: true,
			lastSeenAt: null,
		});
	});
});

describe('reconcileMeleeSnapshot', () => {
	const seenAt = new Date('2026-07-15T00:00:00.000Z');
	const later = new Date('2026-07-15T01:00:00.000Z');

	it('creates, updates and deactivates by external identity, counting each', async () => {
		const eventId = await stageEvent();

		expect(await playerService().reconcileMeleeSnapshot(eventId, [
			{
				externalId: 'player-1',
				externalStatus: 1,
				name: 'One',
				pronouns: 'they/them',
			},
			{ externalId: 'player-2', externalStatus: 1, name: 'Two' },
		], seenAt)).toMatchObject({ created: 2, updated: 0, deactivated: 0 });
		expect(await playerService().reconcileMeleeSnapshot(eventId, [
			{ externalId: 'player-1', externalStatus: 2, name: 'One Updated' },
		], later)).toMatchObject({ created: 0, updated: 1, deactivated: 1 });

		expect((await roster(eventId)).map(player => [
			player.externalId,
			player.name,
			player.pronouns,
			player.externalStatus,
			player.isActive,
			player.lastSeenAt,
		])).toEqual([
			[
				'player-1',
				'One Updated',
				'they/them',
				2,
				true,
				later,
			],
			[
				'player-2',
				'Two',
				null,
				1,
				false,
				seenAt,
			],
		]);
	});

	it('moves a Player\'s revision only when the sync changed what they hold', async () => {
		const eventId = await stageEvent();
		const player = {
			externalId: 'revision-1',
			externalStatus: 1,
			name: 'Rev',
			wins: 1,
			losses: 0,
		};
		const at = (ms: number) => new Date(seenAt.getTime() + ms);
		const held = async () => (await roster(eventId))[0]!;

		await playerService().reconcileMeleeSnapshot(eventId, [player], seenAt);
		expect(await playerService().reconcileMeleeSnapshot(eventId, [player], at(1000)))
			.toMatchObject({ created: 0, updated: 0, deactivated: 0 });
		expect(await held()).toMatchObject({
			updatedAt: seenAt,
			lastSeenAt: at(1000),
		});

		expect(await playerService().reconcileMeleeSnapshot(eventId, [
			{ ...player, wins: 2 },
		], at(2000)))
			.toMatchObject({ updated: 1 });
		expect((await held()).updatedAt).toEqual(at(2000));

		// Melee still sends the name an operator replaced, which the sync leaves alone (ADR-0046).
		await db.update(schema.players)
			.set({
				name: 'Renamed',
				manuallyEditedFields: ['name'],
				updatedAt: at(2000),
			})
			.where(eq(schema.players.eventId, eventId));
		expect(await playerService().reconcileMeleeSnapshot(eventId, [
			{ ...player, wins: 2 },
		], at(2500)))
			.toMatchObject({ updated: 0 });
		expect((await held()).updatedAt).toEqual(at(2000));

		// Missing from one sync, then back unchanged: the reactivation is a change.
		await playerService().reconcileMeleeSnapshot(eventId, [], at(3000));
		await playerService().reconcileMeleeSnapshot(eventId, [
			{ ...player, wins: 2 },
		], at(4000));
		expect((await held()).updatedAt).toEqual(at(4000));
	});

	it('reactivates a returning Player', async () => {
		const eventId = await stageEvent();
		await playerService().reconcileMeleeSnapshot(eventId, [
			{ externalId: 'returning', externalStatus: 1, name: 'Back' },
		], seenAt);
		await playerService().reconcileMeleeSnapshot(eventId, [], seenAt);

		expect(await playerService().reconcileMeleeSnapshot(eventId, [
			{ externalId: 'returning', externalStatus: 9, name: 'Back' },
		], later))
			.toMatchObject({ created: 0, updated: 1, deactivated: 0 });
		expect((await roster(eventId))[0]).toMatchObject({ isActive: true, externalStatus: 9, lastSeenAt: later });
	});

	it('deactivates every Melee Player for an empty snapshot and leaves manual Players alone', async () => {
		const eventId = await stageEvent();
		await playerService().reconcileMeleeSnapshot(eventId, [
			{ externalId: 'a', externalStatus: 1, name: 'A' },
			{ externalId: 'b', externalStatus: 1, name: 'B' },
		], seenAt);
		await playerService().create(eventId, { name: 'Manual' } as never);

		expect(await playerService().reconcileMeleeSnapshot(eventId, [], later)).toMatchObject({
			players: [],
			created: 0,
			updated: 0,
			deactivated: 2,
		});
		expect((await roster(eventId)).map(player => [player.name, player.isActive])).toEqual([
			['Manual', true],
			['A', false],
			['B', false],
		]);
	});

	it('refuses a snapshot naming one identity twice, before writing anything', async () => {
		const eventId = await stageEvent();

		await expect(playerService().reconcileMeleeSnapshot(eventId, [
			{ externalId: 'duplicate', externalStatus: null, name: 'One' },
			{ externalId: 'duplicate', externalStatus: null, name: 'Two' },
		])).rejects.toThrow('Duplicate Melee player external identity');
		expect(await roster(eventId)).toEqual([]);
	});

	it('reconciles a thousand-Player snapshot', async () => {
		const eventId = await stageEvent();
		const snapshot = Array.from({ length: 1000 }, (_, index) => ({ externalId: `player-${index}`, externalStatus: null, name: `Player ${index}` }));

		const result = await playerService().reconcileMeleeSnapshot(eventId, snapshot, seenAt);

		expect(result).toMatchObject({ created: 1000, updated: 0, deactivated: 0 });
		expect(result.players).toHaveLength(1000);
	});
});

describe('batchUpsertByExternalId', () => {
	it('counts first sightings as created and the rest as updated', async () => {
		const eventId = await stageEvent();
		await playerService().batchUpsertByExternalId([
			{
				eventId,
				name: 'Seen',
				externalId: 'e1',
				externalSource: 'melee',
			} as never,
		]);

		const result = await playerService().batchUpsertByExternalId([
			{
				eventId,
				name: 'Seen Again',
				externalId: 'e1',
				externalSource: 'melee',
			} as never,
			{
				eventId,
				name: 'New',
				externalId: 'e2',
				externalSource: 'melee',
			} as never,
		]);

		expect(result).toMatchObject({ created: 1, updated: 1 });
		expect((await roster(eventId)).map(player => player.name)).toEqual(['Seen Again', 'New']);
	});
});
