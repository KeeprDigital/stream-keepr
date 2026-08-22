import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { selectForInsert } from '~~/server/utils/db';

/**
 * #467: `db.insert(t).select(sql`…`)` emits its column list from the table's
 * declared column order, so a raw positional select silently corrupts data the
 * day two same-affinity columns swap places in the schema. `selectForInsert`
 * names every expression by column and orders them itself, so the map — not
 * declaration order — is what a reader and the database both see.
 */

const gadgets = sqliteTable('gadgets', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	eventId: integer('event_id').notNull(),
	name: text('name').notNull(),
	sortOrder: integer('sort_order').notNull().default(0),
});

const client = createClient({ url: 'file::memory:' });
const db = drizzle(client);

describe('selectForInsert', () => {
	beforeAll(async () => {
		await client.execute(`create table gadgets (
			id integer primary key autoincrement,
			event_id integer not null,
			name text not null,
			sort_order integer not null default 0
		)`);
	});

	beforeEach(async () => {
		await client.execute('delete from gadgets');
	});

	it('lands each expression in its named column regardless of map key order', async () => {
		const payload = JSON.stringify([
			{ name: 'left', sortOrder: 7 },
			{ name: 'right', sortOrder: 9 },
		]);

		// Keys deliberately scrambled relative to the table declaration: the map
		// names columns, so its ordering must not matter.
		await db.insert(gadgets).select(selectForInsert(gadgets, {
			sortOrder: sql`json_extract(value, '$.sortOrder')`,
			name: sql`json_extract(value, '$.name')`,
			id: sql`null`,
			eventId: sql`${41}`,
		}, sql`from json_each(${payload})`));

		const rows = await db.select().from(gadgets).orderBy(gadgets.sortOrder);
		expect(rows).toEqual([
			{ id: expect.any(Number), eventId: 41, name: 'left', sortOrder: 7 },
			{ id: expect.any(Number), eventId: 41, name: 'right', sortOrder: 9 },
		]);
	});

	it('composes with upsert and returning through the drizzle builder', async () => {
		await db.insert(gadgets).values({ eventId: 41, name: 'solo', sortOrder: 1 });
		await client.execute('create unique index if not exists gadgets_name_unique on gadgets(name)');

		const payload = JSON.stringify([{ name: 'solo', sortOrder: 5 }]);
		const returned = await db.insert(gadgets).select(selectForInsert(gadgets, {
			id: sql`null`,
			eventId: sql`${41}`,
			name: sql`json_extract(value, '$.name')`,
			sortOrder: sql`json_extract(value, '$.sortOrder')`,
		}, sql`from json_each(${payload}) where true`)).onConflictDoUpdate({
			target: gadgets.name,
			set: { sortOrder: sql.raw('excluded.sort_order') },
		}).returning();

		expect(returned).toEqual([{ id: expect.any(Number), eventId: 41, name: 'solo', sortOrder: 5 }]);
	});

	it('rejects a map missing a column, naming it', () => {
		// @ts-expect-error — the omission under test
		expect(() => selectForInsert(gadgets, {
			id: sql`null`,
			eventId: sql`${41}`,
			name: sql`'x'`,
		}, sql`where true`)).toThrow(/sortOrder/);
	});

	it('rejects a map with an unknown column, naming it', () => {
		expect(() => selectForInsert(gadgets, {
			id: sql`null`,
			eventId: sql`${41}`,
			name: sql`'x'`,
			sortOrder: sql`0`,
			// @ts-expect-error — the stray key under test
			colour: sql`'red'`,
		}, sql`where true`)).toThrow(/colour/);
	});
});
