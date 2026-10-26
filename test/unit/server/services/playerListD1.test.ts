import type { MiniflareD1Harness } from '~~/test/helpers/miniflare-d1';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createMiniflareD1Harness } from '~~/test/helpers/miniflare-d1';

// Player List membership on a real D1 binding, which refuses a statement past
// its hundredth bound parameter: the 500-member API maximum must still fit.

vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const harness: MiniflareD1Harness = await createMiniflareD1Harness();
const db = drizzle(harness.database, { schema });

vi.doMock('~~/server/db', () => ({ db }));

const { playerListService } = await import('~~/server/services/playerList');

afterAll(async () => await harness.dispose());

let eventId: number;
let playerIds: number[];

beforeAll(async () => {
	const [event] = await db.insert(schema.events)
		.values({ name: 'Event', game: 'mtg', featureMatchOrientation: 'horizontal' })
		.returning({ id: schema.events.id });
	eventId = event!.id;
	playerIds = [];
	for (let start = 0; start < 500; start += 20) {
		const rows = await db.insert(schema.players)
			.values(Array.from({ length: 20 }, (_, index) => ({ eventId, name: `Player ${start + index}` })))
			.returning({ id: schema.players.id });
		playerIds.push(...rows.map(row => row.id));
	}
});

async function stageList() {
	return await playerListService().create(eventId, { name: 'List' });
}

async function members(listId: number) {
	return (await db.select().from(schema.playerListMembers).where(eq(schema.playerListMembers.listId, listId)).orderBy(asc(schema.playerListMembers.sortOrder)))
		.map(member => member.playerId);
}

describe('playerListService membership', () => {
	it('adds and removes the 500-Player maximum in one write each', async () => {
		const list = await stageList();

		expect(await playerListService().addMembers(list.id, eventId, playerIds)).toEqual({ added: 500 });
		expect(await playerListService().getMemberCount(list.id, eventId)).toBe(500);
		expect(await playerListService().batchRemoveMembers(list.id, eventId, playerIds)).toBe(500);
		expect(await members(list.id)).toEqual([]);
	});

	it('appends after the existing members, in the order given', async () => {
		const list = await stageList();
		await playerListService().addMembers(list.id, eventId, [playerIds[0]!]);

		await playerListService().addMembers(list.id, eventId, [playerIds[2]!, playerIds[1]!]);

		expect(await members(list.id)).toEqual([playerIds[0], playerIds[2], playerIds[1]]);
	});

	it('reorders to exactly the permutation given', async () => {
		const list = await stageList();
		const [a, b, c] = playerIds;
		await playerListService().addMembers(list.id, eventId, [a!, b!, c!]);

		expect(await playerListService().reorderMembers(list.id, eventId, [c!, a!, b!])).toEqual({ reordered: 3 });
		expect(await members(list.id)).toEqual([c, a, b]);
	});

	it.each([
		['a subset', (ids: number[]) => [ids[1]!, ids[0]!]],
		['a duplicated member', (ids: number[]) => [ids[1]!, ids[1]!, ids[2]!]],
	])('refuses to reorder by %s, keeping the order', async (_case, order) => {
		const list = await stageList();
		await playerListService().addMembers(list.id, eventId, playerIds.slice(0, 3));

		await expect(playerListService().reorderMembers(list.id, eventId, order(playerIds))).rejects.toMatchObject({ statusCode: 400 });
		expect(await members(list.id)).toEqual(playerIds.slice(0, 3));
	});
});
