import type { BroadcastDeckListsInUseError } from '~~/server/utils/errors';
import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const mockPublication = {
	screenUpdated: vi.fn(async ({ entity }: { entity: unknown }) => entity),
	playerDeleted: vi.fn(),
};
vi.doMock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));
vi.doMock('~~/server/services/card', () => ({
	cardService: () => ({ cleanupDeletedScreenCard: vi.fn() }),
}));

const { broadcastDeckListService } = await import('~~/server/services/broadcastDeckList');
const { eventService } = await import('~~/server/services/event');
const { screenService } = await import('~~/server/services/screen');
const { screenWriteModule } = await import('~~/server/modules/screen-write');
const { playerUpdateModule } = await import('~~/server/modules/player-update');

let eventId: number;
let otherEventId: number;
let playerId: number;
let listId: number;

function capability(suffix: string) {
	return {
		assetCapabilitySeed: `seed-${suffix}`,
		assetCapabilityVersion: 1,
		assetCapabilityDigest: `digest-${suffix}`,
	};
}
const provideUnusedGraphicsAssets = () => ({ inspectGraphicAssetRevisions: vi.fn() });

beforeAll(async () => {
	const [event, otherEvent] = await db.insert(schema.events).values([
		{ name: 'Source Event', game: 'mtg', featureMatchOrientation: 'horizontal', broadcastDeckListsEnabled: true },
		{ name: 'Other Event', game: 'mtg', featureMatchOrientation: 'horizontal', broadcastDeckListsEnabled: true },
	]).returning({ id: schema.events.id });
	eventId = event!.id;
	otherEventId = otherEvent!.id;
	const [player] = await db.insert(schema.players).values({ eventId, name: 'Player' }).returning({ id: schema.players.id });
	playerId = player!.id;
	const [list] = await db.insert(schema.broadcastDeckLists).values({
		eventId,
		name: 'Source List',
		normalizedName: 'source list',
		sourceText: '1 Island',
	}).returning({ id: schema.broadcastDeckLists.id });
	listId = list!.id;
});

afterAll(async () => await harness.close());

describe('deck source write invariants', () => {
	it('rejects cross-Event Player and Broadcast references at generic Screen create', async () => {
		const [otherPlayer] = await db.insert(schema.players).values({ eventId: otherEventId, name: 'Other Player' }).returning({ id: schema.players.id });
		const [otherList] = await db.insert(schema.broadcastDeckLists).values({
			eventId: otherEventId,
			name: 'Other List',
			normalizedName: 'other list',
			sourceText: '1 Mountain',
		}).returning({ id: schema.broadcastDeckLists.id });

		await expect(screenService().create(eventId, {
			name: 'Cross Player',
			slug: 'cross-player',
			modeConfigs: { deck: { deckSource: { type: 'player', playerId: otherPlayer!.id } } },
		} as never, capability('cross-player'))).rejects.toMatchObject({ statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' });

		await expect(screenService().create(eventId, {
			name: 'Cross List',
			slug: 'cross-list',
			modeConfigs: { deck: { deckSource: { type: 'broadcast', broadcastDeckListId: otherList!.id } } },
		} as never, capability('cross-list'))).rejects.toMatchObject({ statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' });
	});

	it('lets a Screen source win deletion, then returns every selecting Screen in stable order', async () => {
		await screenService().create(eventId, {
			name: 'Zulu',
			slug: 'zulu-source',
			currentMode: 'card',
			modeConfigs: { deck: { deckSource: { type: 'broadcast', broadcastDeckListId: listId } } },
		} as never, capability('zulu'));
		await screenService().create(eventId, {
			name: 'Alpha',
			slug: 'alpha-source',
			currentMode: 'background',
			modeConfigs: { deck: { deckSource: { type: 'broadcast', broadcastDeckListId: listId } } },
		} as never, capability('alpha'));

		await expect(broadcastDeckListService().remove(listId, eventId, 1)).resolves.toMatchObject({
			status: 'in-use',
			screens: [{ name: 'Alpha' }, { name: 'Zulu' }],
		});
		expect(await broadcastDeckListService().findById(listId, eventId)).toBeDefined();
	});

	it('lets deletion win a later Screen write and commits no dangling source', async () => {
		const [list] = await db.insert(schema.broadcastDeckLists).values({
			eventId,
			name: 'Delete Winner',
			normalizedName: 'delete winner',
			sourceText: '1 Plains',
		}).returning({ id: schema.broadcastDeckLists.id });
		const screen = await screenService().create(eventId, {
			name: 'Delete Race',
			slug: 'delete-race',
			modeConfigs: { deck: { deckSource: { type: 'player', playerId } } },
		} as never, capability('delete-race'));

		await expect(broadcastDeckListService().remove(list!.id, eventId, 1)).resolves.toEqual({ status: 'deleted' });
		await expect(screenService().updateModeConfig(screen.id, eventId, 'deck', {
			deckSource: { type: 'broadcast', broadcastDeckListId: list!.id },
		}, screen.stateVersion)).rejects.toMatchObject({ statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' });
		expect((await screenService().findById(screen.id, eventId))?.modeConfigs?.deck?.deckSource)
			.toEqual({ type: 'player', playerId });
	});

	it('returns the stable conflict through the Screen Mode write when deletion wins before pre-validation', async () => {
		const [list] = await db.insert(schema.broadcastDeckLists).values({
			eventId,
			name: 'Route Delete Winner',
			normalizedName: 'route delete winner',
			sourceText: '1 Plains',
		}).returning({ id: schema.broadcastDeckLists.id });
		const screen = await screenService().create(eventId, {
			name: 'Route Delete Race',
			slug: 'route-delete-race',
			modeConfigs: { deck: { deckSource: { type: 'player', playerId } } },
		} as never, capability('route-delete-race'));

		await expect(broadcastDeckListService().remove(list!.id, eventId, 1)).resolves.toEqual({ status: 'deleted' });
		await expect(screenWriteModule().updateModeConfig({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			mode: 'deck',
			config: { deckSource: { type: 'broadcast', broadcastDeckListId: list!.id } },
			stateVersion: screen.stateVersion,
			graphicsAssets: provideUnusedGraphicsAssets,
		})).rejects.toMatchObject({ statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' });
		expect(mockPublication.screenUpdated).not.toHaveBeenCalled();
		expect((await screenService().findById(screen.id, eventId))?.modeConfigs?.deck?.deckSource)
			.toEqual({ type: 'player', playerId });
	});

	it('keeps generic updates behind the same Deck source invariant', async () => {
		const [otherList] = await db.insert(schema.broadcastDeckLists).values({
			eventId: otherEventId,
			name: 'Generic Other List',
			normalizedName: 'generic other list',
			sourceText: '1 Mountain',
		}).returning({ id: schema.broadcastDeckLists.id });
		const screen = await screenService().create(eventId, {
			name: 'Generic Update',
			slug: 'generic-update',
			modeConfigs: { deck: { deckSource: { type: 'player', playerId } } },
		} as never, capability('generic-update'));

		await expect(screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			input: {
				stateVersion: screen.stateVersion,
				modeConfigs: { deck: { deckSource: { type: 'broadcast', broadcastDeckListId: otherList!.id } } },
			} as never,
		})).rejects.toMatchObject({ statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' });
		expect((await screenService().findById(screen.id, eventId))?.modeConfigs?.deck?.deckSource)
			.toEqual({ type: 'player', playerId });
	});

	it('preserves Player writes, stateVersion conflicts, and one announcement per accepted write', async () => {
		mockPublication.screenUpdated.mockClear();
		const screen = await screenService().create(eventId, {
			name: 'Player Regression',
			slug: 'player-regression',
			modeConfigs: { deck: { deckSource: { type: 'player', playerId: null } } },
		} as never, capability('player-regression'));

		const accepted = await screenWriteModule().updateModeConfig({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			mode: 'deck',
			config: { deckSource: { type: 'player', playerId } },
			stateVersion: screen.stateVersion,
			originConnectionId: 'player-origin',
			graphicsAssets: provideUnusedGraphicsAssets,
		});
		expect(accepted.stateVersion).toBe(screen.stateVersion + 1);
		expect(accepted.modeConfigs?.deck?.deckSource).toEqual({ type: 'player', playerId });
		expect(mockPublication.screenUpdated).toHaveBeenCalledOnce();
		expect(mockPublication.screenUpdated).toHaveBeenCalledWith({
			eventId,
			entity: expect.objectContaining({ id: screen.id, stateVersion: screen.stateVersion + 1 }),
			originConnectionId: 'player-origin',
		});

		await expect(screenWriteModule().updateModeConfig({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			mode: 'deck',
			config: { deckSource: { type: 'player', playerId: null } },
			stateVersion: screen.stateVersion,
			graphicsAssets: provideUnusedGraphicsAssets,
		})).rejects.toMatchObject({ statusCode: 409 });
		expect(mockPublication.screenUpdated).toHaveBeenCalledOnce();
		expect((await screenService().findById(screen.id, eventId))?.modeConfigs?.deck?.deckSource)
			.toEqual({ type: 'player', playerId });
	});

	it('refuses disable while any saved Deck config selects Broadcast, then preserves lists across a successful disable', async () => {
		await expect(eventService().update(eventId, { broadcastDeckListsEnabled: false }))
			.rejects
			.toEqual(expect.objectContaining<Partial<BroadcastDeckListsInUseError>>({
				name: 'BroadcastDeckListsInUseError',
				screens: [expect.objectContaining({ name: 'Alpha' }), expect.objectContaining({ name: 'Zulu' })],
			}));

		await db.update(schema.screens).set({ modeConfigs: null }).where(eq(schema.screens.eventId, eventId));
		await expect(eventService().update(eventId, { broadcastDeckListsEnabled: false }))
			.resolves
			.toMatchObject({ broadcastDeckListsEnabled: false });
		const [listCount] = await db.select({ value: count() }).from(schema.broadcastDeckLists).where(eq(schema.broadcastDeckLists.eventId, eventId));
		expect(listCount?.value).toBeGreaterThan(0);
	});

	it('lets Event disable win a later Broadcast source write', async () => {
		const screen = await screenService().create(eventId, {
			name: 'Disable Race',
			slug: 'disable-race',
			modeConfigs: { deck: { deckSource: { type: 'player', playerId } } },
		} as never, capability('disable-race'));

		await expect(screenService().updateModeConfig(screen.id, eventId, 'deck', {
			deckSource: { type: 'broadcast', broadcastDeckListId: listId },
		}, screen.stateVersion)).rejects.toMatchObject({ statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' });
		expect((await screenService().findById(screen.id, eventId))?.modeConfigs?.deck?.deckSource)
			.toEqual({ type: 'player', playerId });
	});
});

describe('deleting the Player a Deck Source selects (#651)', () => {
	it('clears every Deck Source naming the Player to no Player, announces each, and keeps later writes open', async () => {
		const [deleted] = await db.insert(schema.players).values({ eventId, name: 'Deleted Player' }).returning({ id: schema.players.id });
		const selecting = await screenService().create(eventId, {
			name: 'Selects Deleted',
			slug: 'selects-deleted',
			currentMode: 'deck',
			modeConfigs: { deck: { deckSource: { type: 'player', playerId: deleted!.id } } },
		} as never, capability('selects-deleted'));
		const bystander = await screenService().create(eventId, {
			name: 'Selects Other',
			slug: 'selects-other',
			modeConfigs: { deck: { deckSource: { type: 'player', playerId } } },
		} as never, capability('selects-other'));
		mockPublication.screenUpdated.mockClear();

		await expect(playerUpdateModule().deletePlayer({ eventId, playerId: deleted!.id, originConnectionId: 'delete-origin' }))
			.resolves
			.toEqual({ success: true });

		await expect(screenService().updateModeConfig(selecting.id, eventId, 'standings', { headerText: 'After delete' }))
			.resolves
			.toMatchObject({ modeConfigs: { standings: expect.objectContaining({ headerText: 'After delete' }) } });
		const later = await screenService().findById(selecting.id, eventId);
		expect(later?.modeConfigs?.deck?.deckSource).toEqual({ type: 'player', playerId: null });
		expect(later?.stateVersion).toBe(selecting.stateVersion + 2);
		expect(mockPublication.screenUpdated).toHaveBeenCalledOnce();
		expect(mockPublication.screenUpdated).toHaveBeenCalledWith({
			eventId,
			entity: expect.objectContaining({ id: selecting.id, stateVersion: selecting.stateVersion + 1 }),
		});
		// The deleting client holds the Screen at its old version too.
		expect(mockPublication.screenUpdated.mock.calls[0]?.[0]).not.toHaveProperty('originConnectionId');
		expect(await screenService().findById(bystander.id, eventId)).toMatchObject({
			stateVersion: bystander.stateVersion,
			modeConfigs: { deck: { deckSource: { type: 'player', playerId } } },
		});
	});

	it('clears the Deck Sources of the Players a Melee data reset deletes, and answers the Screens it cleared', async () => {
		const [imported] = await db.insert(schema.players).values({
			eventId,
			name: 'Imported Player',
			externalSource: 'melee',
			externalId: 'melee-651',
		}).returning({ id: schema.players.id });
		const selecting = await screenService().create(eventId, {
			name: 'Selects Imported',
			slug: 'selects-imported',
			modeConfigs: { deck: { deckSource: { type: 'player', playerId: imported!.id } } },
		} as never, capability('selects-imported'));
		const manual = await screenService().create(eventId, {
			name: 'Selects Manual',
			slug: 'selects-manual',
			modeConfigs: { deck: { deckSource: { type: 'player', playerId } } },
		} as never, capability('selects-manual'));

		const reset = await eventService().updateMeleeConfig(eventId, { meleeEnabled: false, meleeEventId: null, meleeClientId: null });

		expect(reset?.clearedScreens).toEqual([expect.objectContaining({ id: selecting.id, stateVersion: selecting.stateVersion + 1 })]);
		expect(await screenService().findById(selecting.id, eventId)).toMatchObject({
			modeConfigs: { deck: { deckSource: { type: 'player', playerId: null } } },
		});
		expect(await screenService().findById(manual.id, eventId)).toMatchObject({
			stateVersion: manual.stateVersion,
			modeConfigs: { deck: { deckSource: { type: 'player', playerId } } },
		});
		await expect(screenService().updateModeConfig(selecting.id, eventId, 'standings', { headerText: 'After reset' }))
			.resolves
			.toBeDefined();
	});
});
