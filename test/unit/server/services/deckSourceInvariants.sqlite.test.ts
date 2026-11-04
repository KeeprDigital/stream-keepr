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
	featureMatchSlotDeleted: vi.fn(),
	eventUpdated: vi.fn(async ({ entity }: { entity: unknown }) => entity),
};
vi.doMock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));
vi.doMock('~~/server/services/card', () => ({
	cardService: () => ({
		cleanupDeletedScreenCard: vi.fn(),
	}),
}));

const { broadcastDeckListService } = await import('~~/server/services/broadcastDeckList');
const { eventService } = await import('~~/server/services/event');
const { opPlayerDeckListService } = await import('~~/server/services/opPlayerDeckList');
const { screenService } = await import('~~/server/services/screen');
const { screenWriteModule } = await import('~~/server/modules/screen-write');
const { playerUpdateModule } = await import('~~/server/modules/player-update');
const { featureMatchSlotWriteModule } = await import('~~/server/modules/feature-match-slot-write');
const { eventWriteModule } = await import('~~/server/modules/event-write');

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
function provideUnusedGraphicsAssets() {
	return {
		inspectGraphicAssetRevisions: vi.fn(),
	};
}

beforeAll(async () => {
	const [event, otherEvent] = await db.insert(schema.events).values([
		{
			name: 'Source Event',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			broadcastDeckListsEnabled: true,
		},
		{
			name: 'Other Event',
			game: 'mtg',
			featureMatchOrientation: 'horizontal',
			broadcastDeckListsEnabled: true,
		},
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
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId: otherPlayer!.id },
				},
			},
		} as never, capability('cross-player'))).rejects.toMatchObject({ statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' });

		await expect(screenService().create(eventId, {
			name: 'Cross List',
			slug: 'cross-list',
			modeConfigs: {
				deck: {
					deckSource: { type: 'broadcast', broadcastDeckListId: otherList!.id },
				},
			},
		} as never, capability('cross-list'))).rejects.toMatchObject({ statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' });
	});

	it('lets a Screen source win deletion, then returns every selecting Screen in stable order', async () => {
		await screenService().create(eventId, {
			name: 'Zulu',
			slug: 'zulu-source',
			currentMode: 'card',
			modeConfigs: {
				deck: {
					deckSource: { type: 'broadcast', broadcastDeckListId: listId },
				},
			},
		} as never, capability('zulu'));
		await screenService().create(eventId, {
			name: 'Alpha',
			slug: 'alpha-source',
			currentMode: 'background',
			modeConfigs: {
				deck: {
					deckSource: { type: 'broadcast', broadcastDeckListId: listId },
				},
			},
		} as never, capability('alpha'));

		await expect(broadcastDeckListService().remove(listId, eventId, 1)).resolves.toMatchObject({
			status: 'in-use',
			screens: [
				{ name: 'Alpha' },
				{ name: 'Zulu' },
			],
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
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId },
				},
			},
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
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId },
				},
			},
		} as never, capability('route-delete-race'));

		await expect(broadcastDeckListService().remove(list!.id, eventId, 1)).resolves.toEqual({ status: 'deleted' });
		await expect(screenWriteModule().updateModeConfig({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			mode: 'deck',
			config: {
				deckSource: { type: 'broadcast', broadcastDeckListId: list!.id },
			},
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
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId },
				},
			},
		} as never, capability('generic-update'));

		await expect(screenWriteModule().updateScreen({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			input: {
				stateVersion: screen.stateVersion,
				modeConfigs: {
					deck: {
						deckSource: { type: 'broadcast', broadcastDeckListId: otherList!.id },
					},
				},
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
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId: null },
				},
			},
		} as never, capability('player-regression'));

		const accepted = await screenWriteModule().updateModeConfig({
			authoringSessionId: undefined,
			eventId,
			screenId: screen.id,
			mode: 'deck',
			config: {
				deckSource: { type: 'player', playerId },
			},
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
			config: {
				deckSource: { type: 'player', playerId: null },
			},
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
				screens: [
					expect.objectContaining({ name: 'Alpha' }),
					expect.objectContaining({ name: 'Zulu' }),
				],
			}));

		await db.update(schema.screens).set({ modeConfigs: null }).where(eq(schema.screens.eventId, eventId));
		await expect(eventService().update(eventId, { broadcastDeckListsEnabled: false }))
			.resolves
			.toMatchObject({ broadcastDeckListsEnabled: false });
		const [listCount] = await db.select({
			value: count(),
		}).from(schema.broadcastDeckLists).where(eq(schema.broadcastDeckLists.eventId, eventId));
		expect(listCount?.value).toBeGreaterThan(0);
	});

	it('lets Event disable win a later Broadcast source write', async () => {
		const screen = await screenService().create(eventId, {
			name: 'Disable Race',
			slug: 'disable-race',
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId },
				},
			},
		} as never, capability('disable-race'));

		await expect(screenService().updateModeConfig(screen.id, eventId, 'deck', {
			deckSource: { type: 'broadcast', broadcastDeckListId: listId },
		}, screen.stateVersion)).rejects.toMatchObject({ statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' });
		expect((await screenService().findById(screen.id, eventId))?.modeConfigs?.deck?.deckSource)
			.toEqual({ type: 'player', playerId });
	});
});

describe('deleting the Player a Deck Source selects (#651)', () => {
	/** A One Piece Card Game Player holds a Deck List the delete takes with them (ADR-0074). */
	async function stageOpPlayer() {
		const [event] = await db.insert(schema.events).values({ name: 'OP Source Event', game: 'op', featureMatchOrientation: 'horizontal' }).returning({ id: schema.events.id });
		const [bystanderPlayer, deleted] = await db.insert(schema.players).values([
			{ eventId: event!.id, name: 'Player' },
			{ eventId: event!.id, name: '', nickname: 'deleted_op' },
		]).returning({ id: schema.players.id });
		await opPlayerDeckListService().replace({
			eventId: event!.id,
			playerId: deleted!.id,
			view: {
				entries: [
					{ number: 'OP99-001', quantity: 4, card: null },
				],
				leaderNumber: null,
				mainboardCount: 4,
				warnings: [],
			},
			archetypeId: null,
			handEdited: true,
		});
		return { eventId: event!.id, playerId: bystanderPlayer!.id, deletedId: deleted!.id };
	}

	it.each([
		{
			game: 'Magic: The Gathering',
			stage: async () => {
				const [deleted] = await db.insert(schema.players).values({ eventId, name: 'Deleted Player' }).returning({ id: schema.players.id });
				return { eventId, playerId, deletedId: deleted!.id };
			},
		},
		{ game: 'One Piece Card Game', stage: stageOpPlayer },
	])('clears every Deck Source naming the Player to no Player, announces each, and keeps later writes open on a $game Event', async ({ stage }) => {
		const { eventId, playerId, deletedId } = await stage();
		const selecting = await screenService().create(eventId, {
			name: 'Selects Deleted',
			slug: `selects-deleted-${deletedId}`,
			currentMode: 'deck',
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId: deletedId },
				},
			},
		} as never, capability(`selects-deleted-${deletedId}`));
		const bystander = await screenService().create(eventId, {
			name: 'Selects Other',
			slug: `selects-other-${deletedId}`,
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId },
				},
			},
		} as never, capability(`selects-other-${deletedId}`));
		mockPublication.screenUpdated.mockClear();

		await expect(playerUpdateModule().deletePlayer({ eventId, playerId: deletedId, originConnectionId: 'delete-origin' }))
			.resolves
			.toEqual({ success: true });

		await expect(screenService().updateModeConfig(selecting.id, eventId, 'standings', { headerText: 'After delete' }))
			.resolves
			.toMatchObject({
				modeConfigs: {
					standings: expect.objectContaining({ headerText: 'After delete' }),
				},
			});
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
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId },
				},
			},
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
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId: imported!.id },
				},
			},
		} as never, capability('selects-imported'));
		const manual = await screenService().create(eventId, {
			name: 'Selects Manual',
			slug: 'selects-manual',
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId },
				},
			},
		} as never, capability('selects-manual'));

		const reset = await eventService().updateMeleeConfig(eventId, { meleeEnabled: false, meleeEventId: null, meleeClientId: null });

		expect(reset?.clearedScreens).toEqual([
			expect.objectContaining({ id: selecting.id, stateVersion: selecting.stateVersion + 1 }),
		]);
		expect(await screenService().findById(selecting.id, eventId)).toMatchObject({
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId: null },
				},
			},
		});
		expect(await screenService().findById(manual.id, eventId)).toMatchObject({
			stateVersion: manual.stateVersion,
			modeConfigs: {
				deck: {
					deckSource: { type: 'player', playerId },
				},
			},
		});
		await expect(screenService().updateModeConfig(selecting.id, eventId, 'standings', { headerText: 'After reset' }))
			.resolves
			.toBeDefined();
	});
});

describe('a Feature Match Slot side Deck Source (ADR-0057)', () => {
	/** An OP Event with two Slots in display order, and a Screen showing a side of each. */
	let seeded = 0;
	async function seedSlotSides(name: string) {
		const label = `${name}-${++seeded}`;
		const [event] = await db.insert(schema.events).values({
			name: `${label} Event`,
			game: 'op',
			featureMatchOrientation: 'horizontal',
			numFeatureMatches: 2,
		}).returning({ id: schema.events.id });
		const [kept, deleted] = await db.insert(schema.featureMatchSlots).values([
			{ eventId: event!.id, sortOrder: 0 },
			{ eventId: event!.id, sortOrder: 1 },
		]).returning({ id: schema.featureMatchSlots.id });
		const showing = (name: string, slotId: number) => screenService().create(event!.id, {
			name,
			slug: `${label}-${name}`.toLowerCase(),
			currentMode: 'deck',
			modeConfigs: {
				deck: {
					deckSource: { type: 'featureMatchSlot', slotId, side: 'player2' },
				},
			},
		} as never, capability(`${label}-${name}`));
		return {
			eventId: event!.id,
			deletedSlotId: deleted!.id,
			selecting: await showing('Selecting', deleted!.id),
			bystander: await showing('Bystander', kept!.id),
		};
	}

	it.each([
		{
			name: 'deleting the Slot',
			remove: (eventId: number, slotId: number) =>
				featureMatchSlotWriteModule().remove({ eventId, slotId, originConnectionId: 'delete-origin' }),
			deleteAnnouncement: mockPublication.featureMatchSlotDeleted,
		},
		{
			name: 'lowering the Event\'s Slot count past it',
			remove: (eventId: number) =>
				eventWriteModule().updateEvent({
					eventId,
					input: { numFeatureMatches: 1 },
					originConnectionId: 'delete-origin',
				}),
			deleteAnnouncement: mockPublication.eventUpdated,
		},
	])('$name clears every Deck Source naming it in the same write, and announces each first', async ({ remove, deleteAnnouncement }) => {
		const { eventId, deletedSlotId, selecting, bystander } = await seedSlotSides('Delete');
		mockPublication.screenUpdated.mockClear();
		deleteAnnouncement.mockClear();

		await remove(eventId, deletedSlotId);

		expect(await db.query.featureMatchSlots.findFirst({
			where: eq(schema.featureMatchSlots.id, deletedSlotId),
		})).toBeUndefined();
		expect(await screenService().findById(selecting.id, eventId)).toMatchObject({
			stateVersion: selecting.stateVersion + 1,
			modeConfigs: {
				deck: {
					deckSource: { type: 'featureMatchSlot', slotId: null, side: 'player2' },
				},
			},
		});
		expect(await screenService().findById(bystander.id, eventId)).toMatchObject({
			stateVersion: bystander.stateVersion,
			modeConfigs: bystander.modeConfigs,
		});
		// The deleting client holds the Screen at its old version too, so no origin.
		expect(mockPublication.screenUpdated.mock.calls).toEqual([
			[
				{
					eventId,
					entity: expect.objectContaining({ id: selecting.id, stateVersion: selecting.stateVersion + 1 }),
				},
			],
		]);
		expect(mockPublication.screenUpdated.mock.invocationCallOrder[0]).toBeLessThan(deleteAnnouncement.mock.invocationCallOrder[0]!);
		await expect(screenService().updateModeConfig(selecting.id, eventId, 'deck', { showCostCurve: false }))
			.resolves
			.toMatchObject({ stateVersion: selecting.stateVersion + 2 });
	});

	it.each([
		{
			name: 'another Event\'s Slot at Screen create',
			write: async (eventId: number, _screenId: number, slotId: number) => screenService().create(eventId, {
				name: 'Foreign Slot',
				slug: 'foreign-slot',
				modeConfigs: {
					deck: {
						deckSource: { type: 'featureMatchSlot', slotId, side: 'player1' },
					},
				},
			} as never, capability('foreign-slot')),
			slotOf: (other: Awaited<ReturnType<typeof seedSlotSides>>) => other.deletedSlotId,
		},
		{
			name: 'a Slot deleted before the write lands',
			write: async (eventId: number, screenId: number, slotId: number) => {
				await db.delete(schema.featureMatchSlots).where(eq(schema.featureMatchSlots.id, slotId));
				const screen = await screenService().findById(screenId, eventId);
				return screenService().updateModeConfig(screenId, eventId, 'deck', {
					deckSource: { type: 'featureMatchSlot', slotId, side: 'player1' },
				}, screen!.stateVersion);
			},
			slotOf: null,
		},
	])('refuses a Slot side Deck Source naming $name', async ({ write, slotOf }) => {
		const own = await seedSlotSides('Guard');
		const other = await seedSlotSides('Other');
		const slotId = slotOf
			? slotOf(other)
			: own.deletedSlotId;

		await expect(write(own.eventId, own.bystander.id, slotId))
			.rejects
			.toMatchObject({ statusCode: 409, code: 'SCREEN_DECK_SOURCE_CONFLICT' });
	});
});
