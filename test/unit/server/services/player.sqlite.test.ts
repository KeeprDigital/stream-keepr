import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const client = createClient({ url: 'file::memory:' });
const sqliteDb = drizzle(client);

vi.doMock('hub:db', () => ({ db: sqliteDb }));

const { playerService } = await import('~~/server/services/player');

describe('playerService JSON bulk SQLite integration', () => {
	beforeAll(async () => {
		await client.execute(`create table players (
			id integer primary key autoincrement, event_id integer not null, name text not null,
			pronouns text, external_id text, external_source text, external_status integer,
			is_active integer not null default 1, last_seen_at integer, wins integer, losses integer,
			draws integer, position integer, points integer, archetype_id integer, lgs text,
			game_data text, created_at integer not null default (unixepoch() * 1000),
			updated_at integer not null default (unixepoch() * 1000),
			unique (event_id, external_id, external_source)
		)`);
	});

	afterAll(async () => await client.close());

	it('bulk-upserts and deterministically reports lifecycle reconciliation counts', async () => {
		const service = playerService();
		const firstSeen = new Date('2026-07-15T00:00:00.000Z');
		const first = await service.reconcileMeleeSnapshot(1, [
			{ externalId: 'player-1', externalStatus: 1, name: 'One', pronouns: 'they/them' },
			{ externalId: 'player-2', externalStatus: 1, name: 'Two' },
		], firstSeen);
		expect(first).toMatchObject({ created: 2, updated: 0, deactivated: 0 });

		const second = await service.reconcileMeleeSnapshot(1, [
			{ externalId: 'player-1', externalStatus: 2, name: 'One Updated' },
		], new Date(firstSeen.getTime() + 1));
		expect(second).toMatchObject({ created: 0, updated: 1, deactivated: 1 });

		const rows = await client.execute('select external_id, name, pronouns, external_status, is_active from players order by external_id');
		expect(rows.rows).toEqual([
			expect.objectContaining({ external_id: 'player-1', name: 'One Updated', pronouns: 'they/them', external_status: 2, is_active: 1 }),
			expect.objectContaining({ external_id: 'player-2', is_active: 0 }),
		]);
	});
});
