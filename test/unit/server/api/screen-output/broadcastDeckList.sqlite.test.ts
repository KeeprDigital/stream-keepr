import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// A Deck List Screen's Broadcast Deck List read once its saved Deck Source no longer
// holds, read as an operator's Session so only the source decides. Admission and the
// read of a list that is there are `screenOutputReads.sqlite.test.ts`'s.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));
vi.doMock('~~/server/utils/auth', () => ({
	optionalUserSession: async () => ({
		user: { id: 'user-1' },
		session: { id: 'session-1' },
	}),
}));

interface StubEvent { params: Record<string, string> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('getRequestHeader', () => undefined);
vi.stubGlobal('setResponseHeader', vi.fn());
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

type Handler = (event: StubEvent) => Promise<unknown>;
const readBroadcastDeckList = (await import('~~/server/api/screen-output/events/[id]/screens/[screenId]/broadcast-deck-list.get')).default as unknown as Handler;

let screens = 0;
/** An Event with Broadcast Deck Lists on, a list in it, and a Deck List Screen whose Deck Source is that list. */
async function stageDeckListScreen() {
	const [event] = await db.insert(schema.events)
		.values({
			name: 'Event',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			broadcastDeckListsEnabled: true,
		})
		.returning({ id: schema.events.id });
	const eventId = event!.id;
	const [list] = await db.insert(schema.broadcastDeckLists)
		.values({
			eventId,
			name: 'Feature Table',
			normalizedName: 'feature table',
			sourceText: '4 Lightning Bolt',
		})
		.returning({ id: schema.broadcastDeckLists.id });
	screens += 1;
	const [screen] = await db.insert(schema.screens).values({
		eventId,
		name: `Screen ${screens}`,
		slug: `screen-${screens}`,
		currentMode: 'deck',
		modeConfigs: {
			deck: {
				deckSource: { type: 'broadcast', broadcastDeckListId: list!.id },
			},
		} as never,
		assetCapabilitySeed: `seed-${screens}`,
		assetCapabilityDigest: `digest-${screens}`,
	}).returning({ id: schema.screens.id });
	return { eventId, listId: list!.id, screenId: screen!.id };
}

function read(eventId: number, screenId: number) {
	return readBroadcastDeckList({
		params: {
			id: String(eventId),
			screenId: String(screenId),
		},
	});
}

const NOT_FOUND = { statusCode: 404, message: 'Not found' };

afterAll(async () => await harness.close());

describe('a Deck List Screen whose saved Deck Source no longer holds', () => {
	it('refuses a list whose Event has since switched Broadcast Deck Lists off', async () => {
		const { eventId, screenId } = await stageDeckListScreen();
		await db.update(schema.events).set({ broadcastDeckListsEnabled: false }).where(eq(schema.events.id, eventId));

		await expect(read(eventId, screenId)).rejects.toMatchObject(NOT_FOUND);
	});

	it('refuses a list deleted between the check of its Deck Source and its read', async () => {
		const { eventId, listId, screenId } = await stageDeckListScreen();
		const execute = harness.client.execute.bind(harness.client) as (statement: { sql: string; args: unknown[] }) => Promise<unknown>;
		vi.spyOn(harness.client, 'execute').mockImplementation((async (statement: { sql: string; args: unknown[] }) => {
			const result = await execute(statement);
			// The check that the Deck Source is selectable has answered; the list goes before it is read.
			if (statement.sql.includes('from "broadcast_deck_lists" inner join "events"')) {
				await execute({
					sql: 'DELETE FROM broadcast_deck_lists WHERE id = ?',
					args: [listId],
				});
			}
			return result;
		}) as never);

		await expect(read(eventId, screenId)).rejects.toMatchObject(NOT_FOUND);
	});
});
