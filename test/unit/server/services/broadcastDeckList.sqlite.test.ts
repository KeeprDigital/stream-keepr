import type { BroadcastDeckListCanonicalDocument } from '~~/server/modules/broadcast-deck-list-import';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string; data?: unknown }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const { broadcastDeckListService } = await import('~~/server/services/broadcastDeckList');

let eventId: number;

function document(name = 'Lightning Bolt'): BroadcastDeckListCanonicalDocument {
	return {
		sourceText: `4 ${name}\nSideboard\n2 Pyroblast\nCompanion\n1 Jegantha, the Wellspring`,
		mainboard: [{
			canonicalName: name,
			scryfallId: 'bolt-printing',
			oracleId: 'bolt-oracle',
			setCode: 'lea',
			collectorNumber: '161',
			cardType: 'Instant',
			colors: 'R',
			manaCost: '{R}',
			manaValue: 1,
			deckCounterTypes: [],
			quantity: 4,
			sortOrder: 0,
		}],
		sideboard: [{
			canonicalName: 'Pyroblast',
			scryfallId: 'pyroblast-printing',
			oracleId: 'pyroblast-oracle',
			setCode: 'ice',
			collectorNumber: '213',
			cardType: 'Instant',
			colors: 'R',
			manaCost: '{R}',
			manaValue: 1,
			deckCounterTypes: [],
			quantity: 2,
			sortOrder: 0,
		}],
		companion: {
			canonicalName: 'Jegantha, the Wellspring',
			scryfallId: 'jegantha-printing',
			oracleId: 'jegantha-oracle',
			setCode: 'iko',
			collectorNumber: '222',
			cardType: 'Legendary Creature — Elemental Elk',
			colors: 'WUBRG',
			manaCost: '{4}{R/G}',
			manaValue: 5,
			deckCounterTypes: ['energy'],
			quantity: 1,
			sortOrder: 0,
		},
	};
}

beforeAll(async () => {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Coverage Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	eventId = event!.id;
});

afterAll(async () => await harness.close());

describe('broadcastDeckListService', () => {
	it('applies the Event flag default and owns no foreign key beyond its Event/list cascade', async () => {
		const [event] = await db.select({ enabled: schema.events.broadcastDeckListsEnabled })
			.from(schema.events)
			.where(eq(schema.events.id, eventId));
		expect(event?.enabled).toBe(false);

		const listForeignKeys = await harness.client.execute('PRAGMA foreign_key_list(broadcast_deck_lists)');
		const entryForeignKeys = await harness.client.execute('PRAGMA foreign_key_list(broadcast_deck_list_entries)');
		expect(listForeignKeys.rows.map(row => row.table)).toEqual(['events']);
		expect(entryForeignKeys.rows.map(row => row.table)).toEqual(['broadcast_deck_lists']);
	});

	it('creates one authoritative document and lists only quantity summaries', async () => {
		const created = await broadcastDeckListService().create(eventId, {
			name: '  Burn  ',
			archetypeLabel: 'Aggro',
			colors: 'RW',
		}, document());

		expect(created).toMatchObject({
			eventId,
			name: 'Burn',
			archetypeLabel: 'Aggro',
			colors: 'WR',
			revision: 1,
			mainboardQuantity: 4,
			sideboardQuantity: 2,
			hasCompanion: true,
			sourceText: document().sourceText,
		});
		expect(created.entries.map(entry => [entry.compartment, entry.quantity, entry.canonicalName])).toEqual([
			['mainboard', 4, 'Lightning Bolt'],
			['sideboard', 2, 'Pyroblast'],
			['companion', 1, 'Jegantha, the Wellspring'],
		]);

		const summaries = await broadcastDeckListService().findByEventId(eventId);
		expect(summaries).toEqual([
			expect.objectContaining({ id: created.id, name: 'Burn', mainboardQuantity: 4, sideboardQuantity: 2, hasCompanion: true }),
		]);
		expect(summaries[0]).not.toHaveProperty('sourceText');
		expect(summaries[0]).not.toHaveProperty('entries');
	});

	it('reads list metadata and entries from one authoritative SQLite snapshot', async () => {
		const service = broadcastDeckListService();
		const created = await service.create(eventId, { name: 'Snapshot Read' }, document('Shock'));
		const prepare = vi.spyOn(harness.database, 'prepare');

		await expect(service.findById(created.id, eventId)).resolves.toMatchObject({
			sourceText: document('Shock').sourceText,
			entries: [expect.objectContaining({ canonicalName: 'Shock' }), expect.anything(), expect.anything()],
		});

		const reads = prepare.mock.calls.filter(([statement]) =>
			String(statement).toLowerCase().startsWith('select'),
		);
		expect(reads).toHaveLength(1);
		prepare.mockRestore();
	});

	it('returns the created revision snapshot when a peer writes immediately after its batch', async () => {
		const service = broadcastDeckListService();
		const [createEvent] = await db.insert(schema.events)
			.values({ name: 'Create Response Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
			.returning({ id: schema.events.id });
		const originalBatch = harness.database.batch.bind(harness.database);
		let intercept = true;
		const batch = vi.spyOn(harness.database, 'batch').mockImplementation(async (statements) => {
			const results = await originalBatch(statements);
			if (intercept) {
				intercept = false;
				const id = Number(results[0]?.meta.last_row_id);
				await db.update(schema.broadcastDeckLists)
					.set({ name: 'Peer revision', normalizedName: 'peer revision', revision: 2 })
					.where(eq(schema.broadcastDeckLists.id, id));
			}
			return results;
		});

		const created = await service.create(createEvent!.id, { name: 'Created revision' }, document('Consider'));

		expect(created).toMatchObject({ name: 'Created revision', revision: 1 });
		expect(await service.findById(created.id, createEvent!.id)).toMatchObject({ name: 'Peer revision', revision: 2 });
		batch.mockRestore();
	});

	it('enforces case-insensitive names per Event and orders collections by normalized name then id', async () => {
		const service = broadcastDeckListService();
		const [otherEvent] = await db.insert(schema.events)
			.values({ name: 'Other Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
			.returning({ id: schema.events.id });
		await service.create(otherEvent!.id, { name: 'zoo' }, document('Forest'));
		await service.create(otherEvent!.id, { name: 'Alpha' }, document('Island'));

		const duplicate = service.create(otherEvent!.id, { name: '  ZOO  ' }, document('Mountain'));
		await expect(duplicate).rejects.toMatchObject({
			name: 'BroadcastDeckListNameConflict',
			message: 'A Broadcast Deck List with this name already exists in this Event',
		});
		expect((await service.findByEventId(otherEvent!.id)).map(list => list.name)).toEqual(['Alpha', 'zoo']);

		// The same normalized name belongs to a different Event and is valid there.
		await expect(service.create(eventId, { name: 'zoo' }, document('Plains'))).resolves.toMatchObject({ name: 'zoo' });
	});

	it('atomically replaces source and entries once, while stale updates preserve the winner', async () => {
		const service = broadcastDeckListService();
		const [raceEvent] = await db.insert(schema.events)
			.values({ name: 'Race Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
			.returning({ id: schema.events.id });
		const created = await service.create(raceEvent!.id, { name: 'Control' }, document('Counterspell'));
		const replacement = document('Brainstorm');

		const winner = await service.update(created.id, raceEvent!.id, {
			expectedRevision: 1,
			name: 'Blue Control',
			sourceText: replacement.sourceText,
		}, replacement);
		expect(winner).toMatchObject({
			status: 'updated',
			item: {
				revision: 2,
				name: 'Blue Control',
				sourceText: replacement.sourceText,
				entries: [expect.objectContaining({ canonicalName: 'Brainstorm' }), expect.anything(), expect.anything()],
			},
		});

		const stale = await service.update(created.id, raceEvent!.id, {
			expectedRevision: 1,
			name: 'Stale Rename',
			sourceText: document('Ancestral Recall').sourceText,
		}, document('Ancestral Recall'));
		expect(stale).toMatchObject({
			status: 'conflict',
			current: { revision: 2, name: 'Blue Control', sourceText: replacement.sourceText },
		});
		expect((await service.findById(created.id, raceEvent!.id))?.entries[0]?.canonicalName).toBe('Brainstorm');
	});

	it('accepts exactly one of two concurrent compare-and-swap edits', async () => {
		const service = broadcastDeckListService();
		const [raceEvent] = await db.insert(schema.events)
			.values({ name: 'Concurrent Race Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
			.returning({ id: schema.events.id });
		const created = await service.create(raceEvent!.id, { name: 'Race Deck' }, document('Opt'));

		const outcomes = await Promise.all([
			service.update(created.id, raceEvent!.id, { expectedRevision: 1, name: 'First contender' }),
			service.update(created.id, raceEvent!.id, { expectedRevision: 1, name: 'Second contender' }),
		]);

		expect(outcomes.filter(outcome => outcome.status === 'updated')).toHaveLength(1);
		expect(outcomes.filter(outcome => outcome.status === 'conflict')).toHaveLength(1);
		expect((await service.findById(created.id, raceEvent!.id))?.revision).toBe(2);
	});

	it('returns the accepted revision snapshot when a peer writes immediately after its CAS batch', async () => {
		const service = broadcastDeckListService();
		const [raceEvent] = await db.insert(schema.events)
			.values({ name: 'Response Snapshot Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
			.returning({ id: schema.events.id });
		const created = await service.create(raceEvent!.id, { name: 'Response Race' }, document('Opt'));
		const originalBatch = harness.database.batch.bind(harness.database);
		let intercept = true;
		const batch = vi.spyOn(harness.database, 'batch').mockImplementation(async (statements) => {
			const results = await originalBatch(statements);
			if (intercept) {
				intercept = false;
				await db.update(schema.broadcastDeckLists)
					.set({ name: 'Peer revision', normalizedName: 'peer revision', revision: 3 })
					.where(eq(schema.broadcastDeckLists.id, created.id));
			}
			return results;
		});

		const accepted = await service.update(created.id, raceEvent!.id, {
			expectedRevision: 1,
			name: 'Accepted revision',
		});

		expect(accepted).toMatchObject({ status: 'updated', item: { name: 'Accepted revision', revision: 2 } });
		expect(await service.findById(created.id, raceEvent!.id)).toMatchObject({ name: 'Peer revision', revision: 3 });
		batch.mockRestore();
	});

	it('scopes reads and revisioned deletes to the Event and cascades entries', async () => {
		const service = broadcastDeckListService();
		const [owner, stranger] = await db.insert(schema.events)
			.values([
				{ name: 'Owner Event', game: 'mtg' as const, featureMatchOrientation: 'horizontal' as const },
				{ name: 'Stranger Event', game: 'mtg' as const, featureMatchOrientation: 'horizontal' as const },
			])
			.returning({ id: schema.events.id });
		const created = await service.create(owner!.id, { name: 'Scoped' }, document());

		expect(await service.findById(created.id, stranger!.id)).toBeUndefined();
		expect(await service.remove(created.id, stranger!.id, 1)).toEqual({ status: 'missing' });
		expect(await service.remove(created.id, owner!.id, 99)).toMatchObject({
			status: 'conflict',
			current: { revision: 1, name: 'Scoped' },
		});
		expect(await service.remove(created.id, owner!.id, 1)).toEqual({ status: 'deleted' });
		expect(await db.select().from(schema.broadcastDeckListEntries).where(eq(schema.broadcastDeckListEntries.listId, created.id))).toEqual([]);
	});

	it('deleting an Event cascades its lists and entries', async () => {
		const service = broadcastDeckListService();
		const [owner] = await db.insert(schema.events)
			.values({ name: 'Disposable Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
			.returning({ id: schema.events.id });
		const created = await service.create(owner!.id, { name: 'Disposable' }, document());

		await db.delete(schema.events).where(eq(schema.events.id, owner!.id));

		expect(await service.findById(created.id, owner!.id)).toBeUndefined();
		expect(await db.select().from(schema.broadcastDeckListEntries).where(eq(schema.broadcastDeckListEntries.listId, created.id))).toEqual([]);
	});
});
