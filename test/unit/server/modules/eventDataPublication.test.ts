import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPublishMessage = vi.fn();
const mockPublishMessageStrict = vi.fn();
const mockFeatureMatchService = {
	findById: vi.fn(),
	findByEventId: vi.fn(),
};

const mockRefreshBindings = vi.fn();

vi.mock('~~/server/modules/broadcast-graphics-live-session', () => ({
	refreshBroadcastGraphicsBindings: mockRefreshBindings,
}));

vi.mock('~~/server/utils/ably', () => ({
	publishMessage: mockPublishMessage,
	publishMessageStrict: mockPublishMessageStrict,
}));

vi.mock('~~/server/services/featureMatch', () => ({
	featureMatchService: () => mockFeatureMatchService,
}));

const { eventDataPublicationModule } = await import('~~/server/modules/event-data-publication');

const NOW = new Date('2026-01-01T00:00:00.000Z');

function createEvent(overrides: Record<string, unknown> = {}) {
	return {
		id: 1,
		name: 'Regional Championship',
		slug: 'regional-championship',
		game: 'mtg',
		meleeEnabled: true,
		meleeEventId: '12345',
		meleeClientId: 'client-id',
		meleeClientSecret: 'client-secret',
		numFeatureMatches: 4,
		talents: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createPhase(overrides: Record<string, unknown> = {}) {
	return {
		id: 2,
		eventId: 1,
		name: 'Swiss',
		sortOrder: 0,
		externalId: 'phase-2',
		externalSource: 'melee',
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createRound(overrides: Record<string, unknown> = {}) {
	return {
		id: 3,
		eventId: 1,
		phaseId: 2,
		externalId: 'round-3',
		externalSource: 'melee',
		name: 'Round 3',
		roundNumber: 3,
		controlMode: 'melee',
		lastSyncedAt: null,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createTalent(overrides: Record<string, unknown> = {}) {
	return {
		id: 5,
		eventId: 1,
		name: 'Casey',
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createPlayerList(overrides: Record<string, unknown> = {}) {
	return {
		id: 10,
		eventId: 1,
		name: 'Featured Players',
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createPlayerDeck(overrides: Record<string, unknown> = {}) {
	return {
		id: 20,
		eventId: 1,
		playerId: 4,
		externalId: 'deck-20',
		externalSource: 'melee',
		formatExternalId: 'modern',
		name: 'Imported Deck',
		colors: 'UR',
		sortOrder: 0,
		isPrimary: true,
		archetypeId: 7,
		reviewedAt: NOW,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createFeatureMatch(overrides: Record<string, unknown> = {}) {
	return {
		id: 4,
		eventId: 1,
		matchId: 7,
		externalId: 'match-7',
		externalSource: 'melee',
		tableNumber: 12,
		player1Id: 101,
		player2Id: 102,
		player1Data: { name: 'Alice' },
		player2Data: { name: 'Bob' },
		bestOf: 3,
		sortOrder: 0,
		playerDisplayMode: 'score',
		activeSessionId: null,
		roundName: 'Round 3',
		formatName: null,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createArchetype(overrides: Record<string, unknown> = {}) {
	return {
		id: 11,
		eventId: 1,
		name: 'Izzet Prowess',
		colors: 'UR',
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createKeyCard(overrides: Record<string, unknown> = {}) {
	return {
		id: 12,
		name: 'Sleight of Hand',
		game: 'mtg',
		scryfallId: 'scryfall-12',
		oracleId: 'oracle-12',
		cardType: 'Sorcery',
		colors: ['U'],
		cmc: 1,
		manaCost: '{U}',
		deckCounterTypes: [],
		deckTokens: [],
		sortOrder: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createMatch(overrides: Record<string, unknown> = {}) {
	return {
		id: 7,
		eventId: 1,
		roundId: 3,
		externalId: 'match-7',
		externalSource: 'melee',
		tableNumber: 12,
		player1Id: 101,
		player2Id: 102,
		player1Data: { name: 'Alice' },
		player2Data: { name: 'Bob' },
		player1Wins: 1,
		player2Wins: 0,
		draws: 0,
		status: 'pending',
		sortOrder: 0,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

function createScreen(overrides: Record<string, unknown> = {}) {
	return {
		id: 8,
		eventId: 1,
		name: 'Main Screen',
		slug: 'main-screen',
		currentMode: 'feature-match',
		modeConfigs: {},
		screenConfig: {},
		stateVersion: 3,
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

describe('event Data publication module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('publishes Phase and Round changes through domain-shaped methods', async () => {
		const publication = eventDataPublicationModule();

		const phase = await publication.phaseCreated({
			eventId: 1,
			entity: createPhase() as any,
			originConnectionId: 'origin-1',
		});
		const updatedPhase = await publication.phaseUpdated({
			eventId: 1,
			entity: createPhase({ name: 'Top 8' }) as any,
			originConnectionId: 'origin-1',
		});
		await publication.phaseDeleted({
			eventId: 1,
			id: 2,
			originConnectionId: 'origin-1',
		});
		const createdRound = await publication.roundCreated({
			eventId: 1,
			entity: createRound({ id: 4, name: 'Round 4' }) as any,
			originConnectionId: 'origin-1',
		});
		const round = await publication.roundUpdated({
			eventId: 1,
			entity: createRound() as any,
			originConnectionId: 'origin-1',
		});
		await publication.roundDeleted({
			eventId: 1,
			id: 3,
			originConnectionId: 'origin-1',
		});

		expect(phase).toEqual(expect.objectContaining({ id: 2, name: 'Swiss' }));
		expect(updatedPhase).toEqual(expect.objectContaining({ id: 2, name: 'Top 8' }));
		expect(createdRound).toEqual(expect.objectContaining({ id: 4, name: 'Round 4' }));
		expect(round).toEqual(expect.objectContaining({ id: 3, name: 'Round 3' }));
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'phase:created', {
			phase: expect.objectContaining({ id: 2, name: 'Swiss' }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'phase:updated', {
			phase: expect.objectContaining({ id: 2, name: 'Top 8' }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'phase:deleted', {
			phaseId: 2,
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'round:created', {
			round: expect.objectContaining({ id: 4, name: 'Round 4' }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'round:updated', {
			round: expect.objectContaining({ id: 3, name: 'Round 3' }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'round:deleted', {
			roundId: 3,
		}, 'origin-1');
	});

	it('publishes Talent changes through mapped domain methods', async () => {
		const publication = eventDataPublicationModule();

		const createdTalent = await publication.talentCreated({
			eventId: 1,
			entity: createTalent() as any,
			originConnectionId: 'origin-1',
		});
		const updatedTalent = await publication.talentUpdated({
			eventId: 1,
			entity: createTalent({ name: 'Riley' }) as any,
			originConnectionId: 'origin-1',
		});
		await publication.talentDeleted({
			eventId: 1,
			id: 5,
			originConnectionId: 'origin-1',
		});

		expect(createdTalent).toEqual(expect.objectContaining({ id: 5, name: 'Casey' }));
		expect(updatedTalent).toEqual(expect.objectContaining({ id: 5, name: 'Riley' }));
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'talent:created', {
			talent: expect.objectContaining({ id: 5, name: 'Casey' }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'talent:updated', {
			talent: expect.objectContaining({ id: 5, name: 'Riley' }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'talent:deleted', {
			talentId: 5,
		}, 'origin-1');
	});

	it('publishes Player List entity and member changes through domain methods', async () => {
		const publication = eventDataPublicationModule();

		const created = await publication.playerListCreated({
			eventId: 1,
			entity: createPlayerList() as any,
			originConnectionId: 'origin-1',
		});
		const updated = await publication.playerListUpdated({
			eventId: 1,
			entity: createPlayerList({ name: 'Coverage Players' }) as any,
			originConnectionId: 'origin-1',
		});
		await publication.playerListDeleted({
			eventId: 1,
			id: 10,
			originConnectionId: 'origin-1',
		});
		await publication.playerListMembersChanged({
			eventId: 1,
			listId: 10,
			playerIds: [101, 102],
			action: 'reordered',
			memberCount: 2,
			originConnectionId: 'origin-1',
		});

		expect(created).toEqual(expect.objectContaining({ id: 10, name: 'Featured Players' }));
		expect(updated).toEqual(expect.objectContaining({ id: 10, name: 'Coverage Players' }));
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'playerList:created', {
			playerList: expect.objectContaining({ id: 10, name: 'Featured Players' }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'playerList:updated', {
			playerList: expect.objectContaining({ id: 10, name: 'Coverage Players' }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'playerList:deleted', {
			listId: 10,
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'playerList:membersChanged', {
			listId: 10,
			playerIds: [101, 102],
			action: 'reordered',
			memberCount: 2,
		}, 'origin-1');
	});

	it('publishes Melee Sync summaries without exposing message payload shape to callers', async () => {
		await eventDataPublicationModule().roundMatchesRefreshed({
			eventId: 1,
			originConnectionId: 'origin-1',
			roundId: 3,
			matchCount: 4,
			created: 2,
			updated: 1,
			staleDeleted: 1,
		});

		await eventDataPublicationModule().meleeDeckListsSynced({
			eventId: 1,
			originConnectionId: 'origin-1',
			playerCount: 16,
			deckCount: 16,
		});

		await eventDataPublicationModule().meleeStructureSynced({
			eventId: 1,
			originConnectionId: 'origin-1',
			phaseCount: 2,
			roundCount: 8,
			changes: {
				phases: { created: [2], updated: [3], deleted: [] },
				rounds: { created: [4], updated: [5], deleted: [6] },
			},
		});

		await eventDataPublicationModule().meleeFeatureMatchesSynced({
			eventId: 1,
			originConnectionId: 'origin-1',
			slotIds: [7, 8],
		});

		await eventDataPublicationModule().meleeRoundSynced({
			eventId: 1,
			originConnectionId: 'origin-1',
			roundId: 3,
			matchCount: 4,
			created: 2,
			updated: 1,
			staleDeleted: 1,
		});

		await eventDataPublicationModule().meleeDataReset({
			eventId: 1,
			originConnectionId: 'origin-1',
			reason: 'event-changed',
		});

		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'round:matchesRefreshed', {
			roundId: 3,
			matchCount: 4,
			created: 2,
			updated: 1,
			staleDeleted: 1,
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'melee:dataReset', {
			reason: 'event-changed',
		}, 'origin-1');
		expect(mockPublishMessageStrict).toHaveBeenCalledWith(1, 'melee:decklistsSynced', {
			playerCount: 16,
			deckCount: 16,
		}, 'origin-1');
		expect(mockPublishMessageStrict).toHaveBeenCalledWith(1, 'melee:structureSynced', {
			phaseCount: 2,
			roundCount: 8,
			changes: {
				phases: { created: [2], updated: [3], deleted: [] },
				rounds: { created: [4], updated: [5], deleted: [6] },
			},
		}, 'origin-1');
		expect(mockPublishMessageStrict).toHaveBeenCalledWith(1, 'melee:featureMatchesSynced', {
			slotIds: [7, 8],
		}, 'origin-1');
		expect(mockPublishMessageStrict).toHaveBeenCalledWith(1, 'melee:roundSynced', {
			roundId: 3,
			matchCount: 4,
			created: 2,
			updated: 1,
			staleDeleted: 1,
		}, 'origin-1');
	});

	it('wraps strict Melee Sync publication failures with the message type', async () => {
		const cause = new Error('Ably unavailable');
		mockPublishMessageStrict.mockRejectedValueOnce(cause);

		await expect(eventDataPublicationModule().meleePlayersSynced({
			eventId: 1,
			originConnectionId: 'origin-1',
			playerCount: 12,
		})).rejects.toMatchObject({
			name: 'RealtimePublicationError',
			messageType: 'melee:playersSynced',
			cause,
		});
	});

	it('publishes Archetype entity and key-card changes through domain methods', async () => {
		const publication = eventDataPublicationModule();

		const created = await publication.archetypeCreated({
			eventId: 1,
			entity: createArchetype() as any,
			originConnectionId: 'origin-1',
		});
		const updated = await publication.archetypeUpdated({
			eventId: 1,
			entity: createArchetype({ name: 'Mono-Red Aggro', colors: 'R' }) as any,
			keyCards: [createKeyCard({ id: 13, name: 'Monastery Swiftspear', sortOrder: 0 }) as any],
			originConnectionId: 'origin-1',
		});
		await publication.archetypeDeleted({
			eventId: 1,
			id: 11,
			originConnectionId: 'origin-1',
		});
		const keyCards = await publication.archetypeKeyCardsUpdated({
			eventId: 1,
			archetypeId: 11,
			keyCards: [createKeyCard({ sortOrder: 2 }) as any],
			originConnectionId: 'origin-1',
		});

		expect(created).toEqual(expect.objectContaining({ id: 11, name: 'Izzet Prowess', keyCards: [] }));
		expect(updated).toEqual(expect.objectContaining({
			id: 11,
			name: 'Mono-Red Aggro',
			keyCards: [expect.objectContaining({ id: 13, name: 'Monastery Swiftspear' })],
		}));
		expect(keyCards).toEqual([
			expect.objectContaining({ archetypeId: 11, id: 12, name: 'Sleight of Hand', sortOrder: 2 }),
		]);
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'archetype:created', {
			archetype: expect.objectContaining({ id: 11, name: 'Izzet Prowess', keyCards: [] }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'archetype:updated', {
			archetype: expect.objectContaining({
				id: 11,
				name: 'Mono-Red Aggro',
				keyCards: [expect.objectContaining({ id: 13, name: 'Monastery Swiftspear' })],
			}),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'archetype:deleted', {
			archetypeId: 11,
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'archetype:keyCardsUpdated', {
			archetypeId: 11,
			keyCards: [expect.objectContaining({ archetypeId: 11, id: 12, name: 'Sleight of Hand', sortOrder: 2 })],
		}, 'origin-1');
	});

	it('publishes stable player deck review state', async () => {
		const deck = createPlayerDeck();
		const archetype = createArchetype({ id: 7, name: 'Reviewed Control', colors: 'WU' });

		const result = await eventDataPublicationModule().playerDeckReviewed({
			eventId: 1,
			entity: deck as any,
			archetype: archetype as any,
			originConnectionId: 'origin-1',
		});

		expect(result).toMatchObject({
			name: 'Reviewed Control',
			colors: 'WU',
			submittedName: 'Imported Deck',
			submittedColors: 'UR',
		});
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'playerDeck:reviewed', { deck: result }, 'origin-1');
	});

	it('publishes Event changes without exposing credentials', async () => {
		const publication = eventDataPublicationModule();

		const event = await publication.eventUpdated({
			eventId: 1,
			entity: createEvent() as any,
			originConnectionId: 'origin-1',
		});
		await publication.eventDeleted({
			eventId: 1,
			originConnectionId: 'origin-1',
		});

		expect(event).toEqual(expect.objectContaining({
			id: 1,
			name: 'Regional Championship',
			meleeConfigured: true,
		}));
		expect(event).not.toHaveProperty('meleeClientId');
		expect(event).not.toHaveProperty('meleeClientSecret');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'event:updated', {
			event: expect.objectContaining({
				id: 1,
				name: 'Regional Championship',
				meleeConfigured: true,
			}),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'event:deleted', {
			eventId: 1,
		}, 'origin-1');
	});

	it('publishes Match and Screen changes through mapped domain methods', async () => {
		const publication = eventDataPublicationModule();

		const createdMatch = await publication.matchCreated({
			eventId: 1,
			entity: createMatch({ id: 6 }) as any,
			originConnectionId: 'origin-1',
		});
		const match = await publication.matchUpdated({
			eventId: 1,
			entity: createMatch() as any,
			originConnectionId: 'origin-1',
		});
		const createdScreen = await publication.screenCreated({
			eventId: 1,
			entity: createScreen({ id: 9 }) as any,
			originConnectionId: 'origin-1',
		});
		const screen = await publication.screenUpdated({
			eventId: 1,
			entity: createScreen() as any,
			originConnectionId: 'origin-1',
		});
		await publication.matchDeleted({
			eventId: 1,
			id: 7,
			originConnectionId: 'origin-1',
		});
		await publication.screenDeleted({
			eventId: 1,
			id: 8,
			originConnectionId: 'origin-1',
		});

		expect(createdMatch).toEqual(expect.objectContaining({ id: 6, tableNumber: 12 }));
		expect(match).toEqual(expect.objectContaining({ id: 7, tableNumber: 12 }));
		expect(createdScreen).toEqual(expect.objectContaining({ id: 9, name: 'Main Screen', stateVersion: 3 }));
		expect(screen).toEqual(expect.objectContaining({ id: 8, name: 'Main Screen', stateVersion: 3 }));
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'match:created', {
			match: expect.objectContaining({ id: 6, tableNumber: 12 }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'match:updated', {
			match: expect.objectContaining({ id: 7, tableNumber: 12 }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'screen:created', {
			screen: expect.objectContaining({ id: 9, name: 'Main Screen' }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'screen:updated', {
			screen: expect.objectContaining({ id: 8, name: 'Main Screen', stateVersion: 3 }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'match:deleted', {
			matchId: 7,
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'screen:deleted', {
			screenId: 8,
		}, 'origin-1');
	});

	it('loads all Feature Match Slots for the Event once before publishing batch updates', async () => {
		mockFeatureMatchService.findByEventId.mockResolvedValueOnce([
			createFeatureMatch({ id: 4 }),
			createFeatureMatch({ id: 6, matchId: null }),
		]);

		const published = await eventDataPublicationModule().featureMatchSlotsUpdated({
			eventId: 1,
			slotIds: [4, 5, 6],
			originConnectionId: 'origin-1',
		});

		expect(mockFeatureMatchService.findByEventId).toHaveBeenCalledTimes(1);
		expect(mockFeatureMatchService.findByEventId).toHaveBeenCalledWith(1);
		expect(mockFeatureMatchService.findById).not.toHaveBeenCalled();
		expect(published).toEqual([
			expect.objectContaining({ id: 4 }),
			expect.objectContaining({ id: 6 }),
		]);
		expect(mockPublishMessage).toHaveBeenCalledTimes(2);
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'featureMatch:updated', {
			featureMatch: expect.objectContaining({ id: 4 }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'featureMatch:updated', {
			featureMatch: expect.objectContaining({ id: 6 }),
		}, 'origin-1');
	});

	it('skips the Feature Match Slot lookup entirely when no Slots were affected', async () => {
		const published = await eventDataPublicationModule().featureMatchSlotsUpdated({
			eventId: 1,
			slotIds: [],
			originConnectionId: 'origin-1',
		});

		expect(mockFeatureMatchService.findByEventId).not.toHaveBeenCalled();
		expect(published).toEqual([]);
	});

	it('publishes Feature Match Slot entity and reorder changes through domain methods', async () => {
		const publication = eventDataPublicationModule();

		const created = await publication.featureMatchSlotCreated({
			eventId: 1,
			entity: createFeatureMatch({ id: 4 }) as any,
			originConnectionId: 'origin-1',
		});
		const updated = await publication.featureMatchSlotUpdated({
			eventId: 1,
			entity: createFeatureMatch({ id: 5, tableNumber: 16 }) as any,
			originConnectionId: 'origin-1',
		});
		await publication.featureMatchSlotDeleted({
			eventId: 1,
			id: 4,
			originConnectionId: 'origin-1',
		});
		const reordered = await publication.featureMatchSlotsReordered({
			eventId: 1,
			slots: [
				{ matchId: 4, sortOrder: 1 },
				{ matchId: 5, sortOrder: 0 },
			],
			originConnectionId: 'origin-1',
		});

		expect(created).toEqual(expect.objectContaining({ id: 4, tableNumber: 12 }));
		expect(updated).toEqual(expect.objectContaining({ id: 5, tableNumber: 16 }));
		expect(reordered).toEqual([
			{ featureMatchId: 4, sortOrder: 1 },
			{ featureMatchId: 5, sortOrder: 0 },
		]);
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'featureMatch:created', {
			featureMatch: expect.objectContaining({ id: 4, tableNumber: 12 }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'featureMatch:updated', {
			featureMatch: expect.objectContaining({ id: 5, tableNumber: 16 }),
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'featureMatch:deleted', {
			featureMatchId: 4,
		}, 'origin-1');
		expect(mockPublishMessage).toHaveBeenCalledWith(1, 'featureMatch:reordered', {
			featureMatches: [
				{ featureMatchId: 4, sortOrder: 1 },
				{ featureMatchId: 5, sortOrder: 0 },
			],
		}, 'origin-1');
	});

	/**
	 * Which publications wake a Broadcast Graphic up.
	 *
	 * The settled rule is that relevant Realtime Event Session changes re-resolve
	 * affected Graphic Input Bindings, and this module is where the server decides one
	 * has happened. Without this, the trigger could be deleted from every publication
	 * and the only thing that would notice is a lower third on air holding a stale name.
	 */
	describe('re-resolving Broadcast Graphic bindings', () => {
		it('catches Broadcast Graphics up on Event Data a binding may read', async () => {
			const publication = eventDataPublicationModule();

			await publication.roundUpdated({
				eventId: 1,
				entity: createRound({ name: 'Round 4' }) as any,
				originConnectionId: 'origin-1',
			});

			expect(mockRefreshBindings).toHaveBeenCalledWith(1);
		});

		it('never tells the re-resolution which connection changed the Event Data', async () => {
			const publication = eventDataPublicationModule();

			await publication.roundUpdated({
				eventId: 1,
				entity: createRound({ name: 'Round 4' }) as any,
				originConnectionId: 'origin-1',
			});

			// The message announcing the Round carries the origin, because the browser that
			// made that edit already applied it and must not echo it back to itself. The
			// re-resolution is a different change, which nobody issued and no client
			// predicted — so an origin here would make the one browser that caused it the
			// only client never told its graphics moved, leaving its Live Control behind
			// until some later command forced a reload.
			expect(mockPublishMessage).toHaveBeenCalledWith(1, 'round:updated', expect.anything(), 'origin-1');
			expect(mockRefreshBindings).not.toHaveBeenCalledWith(expect.objectContaining({ originConnectionId: 'origin-1' }));
			expect(mockRefreshBindings.mock.calls).toEqual([[1]]);
		});

		it('catches them up on a Melee Sync, which reports a count rather than each entity', async () => {
			const publication = eventDataPublicationModule();

			await publication.meleePlayersSynced({ eventId: 1, playerCount: 120 });

			expect(mockRefreshBindings).toHaveBeenCalledWith(1);
		});

		it('catches them up once for a whole run of Feature Match Slots, not once each', async () => {
			mockFeatureMatchService.findByEventId.mockResolvedValue([
				createFeatureMatch({ id: 4 }),
				createFeatureMatch({ id: 5 }),
				createFeatureMatch({ id: 6 }),
			]);
			const publication = eventDataPublicationModule();

			const published = await publication.featureMatchSlotsUpdated({ eventId: 1, slotIds: [4, 5, 6] });

			// Every Slot is announced, because each message names one Slot. Re-resolution is
			// per Event, so fifty Slots moving in one operation is one Event Data change as
			// far as a Graphic Input Binding is concerned — sweeping per Slot would repeat
			// the whole Event's work fifty times inside one request.
			expect(published).toHaveLength(3);
			expect(mockRefreshBindings.mock.calls).toEqual([[1]]);
		});

		it('leaves them alone for a change no Graphic Input Binding can read', async () => {
			const publication = eventDataPublicationModule();

			// A Screen and a Player List are Event-scoped, but no Graphic Source Selection
			// names either, so re-resolving on them would be work that can never change a
			// value — on every Screen in the Event, every time one is saved.
			await publication.screenUpdated({ eventId: 1, entity: createScreen() as any });
			await publication.playerListUpdated({ eventId: 1, entity: createPlayerList() as any });

			expect(mockRefreshBindings).not.toHaveBeenCalled();
		});
	});
});
