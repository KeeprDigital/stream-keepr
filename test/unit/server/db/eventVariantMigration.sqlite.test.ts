import { afterAll, describe, expect, it } from 'vitest';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// Every Magic: The Gathering Event from before Variants is Two-Player, and no
// other Card Game's Event gains one (ADR-0087).
const harness = await createSqliteD1Harness({ throughMigration: '0000' });

afterAll(async () => {
	await harness.close();
});

describe('the Event Variant migration', () => {
	it('makes an existing Magic: The Gathering Event Two-Player and gives a One Piece Card Game Event none', async () => {
		await harness.client.execute(`
			INSERT INTO events (id, name, game, feature_match_orientation)
			VALUES (1, 'Magic', 'mtg', 'horizontal'), (2, 'One Piece', 'op', 'horizontal')
		`);

		await harness.applyRemainingMigrations();

		const { rows } = await harness.client.execute('SELECT id, variant FROM events ORDER BY id');
		expect(rows.map(row => [
			Number(row.id),
			row.variant,
		])).toEqual([
			[1, 'two-player'],
			[2, null],
		]);
	});
});
