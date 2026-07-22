import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockArchetype, createMockPlayer } from '~~/test/helpers/fixtures';

const mockRequireArchetypeInEvent = vi.fn();
const mockArchetypeService = {
	findById: vi.fn(),
};
const mockPlayerService = {
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
};
const mockPlayerDeckService = {
	reconcilePrimaryArchetype: vi.fn(),
	reviewDeck: vi.fn(),
};
const mockPlayerFeatureMatchSyncService = {
	syncMatchesFromPlayers: vi.fn(),
};
const mockPublication = {
	playerCreated: vi.fn(),
	playerUpdated: vi.fn(),
	playerDeleted: vi.fn(),
	playerDeckReviewed: vi.fn(),
	featureMatchSlotsUpdated: vi.fn(),
};

vi.mock('~~/server/utils/routeGuards', () => ({
	requireArchetypeInEvent: mockRequireArchetypeInEvent,
}));

vi.mock('~~/server/services/archetype', () => ({
	archetypeService: () => mockArchetypeService,
}));

vi.mock('~~/server/services/player', () => ({
	playerService: () => mockPlayerService,
}));

vi.mock('~~/server/services/playerDeck', () => ({
	playerDeckService: () => mockPlayerDeckService,
}));

vi.mock('~~/server/services/playerFeatureMatchSync', () => ({
	playerFeatureMatchSyncService: () => mockPlayerFeatureMatchSyncService,
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { playerUpdateModule } = await import('~~/server/modules/player-update');

describe('playerUpdateModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockArchetypeService.findById.mockResolvedValue(createMockArchetype({ id: 3, name: 'Control' }));
		mockPlayerService.create.mockResolvedValue(createMockPlayer({ id: 9, name: 'New Player' }));
		mockPlayerService.update.mockResolvedValue(createMockPlayer({ id: 5, name: 'Updated Player' }));
		mockPlayerService.remove.mockResolvedValue(true);
		mockPlayerDeckService.reconcilePrimaryArchetype.mockResolvedValue(null);
		mockPlayerDeckService.reviewDeck.mockResolvedValue({
			deck: { id: 21, playerId: 5 },
			player: createMockPlayer({ id: 5, name: 'Reviewed Player' }),
		});
		mockPublication.playerCreated.mockResolvedValue({ id: 9, eventId: 1, name: 'New Player' });
		mockPublication.playerUpdated.mockResolvedValue({
			id: 5,
			eventId: 1,
			name: 'Updated Player',
		});
		mockPublication.playerDeckReviewed.mockResolvedValue({ id: 21, playerId: 5 });
		mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers.mockImplementation(
			async (_eventId: number, playerIds: number[]) => playerIds.length === 1 ? [11, 12] : [21, 22],
		);
	});

	it('validates Player references before update', async () => {
		const input = { archetypeId: 3, name: 'Updated Player' };

		await playerUpdateModule().updatePlayer({
			eventId: 1,
			playerId: 5,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockRequireArchetypeInEvent).toHaveBeenCalledWith(1, input.archetypeId);
		expect(mockRequireArchetypeInEvent.mock.invocationCallOrder[0])
			.toBeLessThan(mockPlayerService.update.mock.invocationCallOrder[0]);
	});

	it('returns 404 when playerService.update returns null', async () => {
		mockPlayerService.update.mockResolvedValue(null);

		await expect(playerUpdateModule().updatePlayer({
			eventId: 1,
			playerId: 404,
			input: { name: 'Missing Player' },
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Player not found',
		});

		expect(mockPublication.playerUpdated).not.toHaveBeenCalled();
		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers).not.toHaveBeenCalled();
		expect(mockPublication.featureMatchSlotsUpdated).not.toHaveBeenCalled();
	});

	it('publishes player updates, reverse-syncs slots, and returns the mapped response', async () => {
		const input = { name: 'Updated Player' };

		const response = await playerUpdateModule().updatePlayer({
			eventId: 1,
			playerId: 5,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerService.update).toHaveBeenCalledWith(5, 1, input);
		expect(mockPublication.playerUpdated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 5, name: 'Updated Player' }),
			originConnectionId: 'origin-1',
		});
		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers).toHaveBeenCalledWith(1, [5]);
		expect(mockPublication.featureMatchSlotsUpdated).toHaveBeenCalledWith({
			eventId: 1,
			slotIds: [11, 12],
			originConnectionId: 'origin-1',
		});
		expect(mockPublication.playerUpdated.mock.invocationCallOrder[0])
			.toBeLessThan(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers.mock.invocationCallOrder[0]);
		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers.mock.invocationCallOrder[0])
			.toBeLessThan(mockPublication.featureMatchSlotsUpdated.mock.invocationCallOrder[0]);
		expect(response).toEqual({
			id: 5,
			eventId: 1,
			name: 'Updated Player',
		});
	});

	it('publishes batch Player snapshot updates for Melee Sync', async () => {
		const result = await playerUpdateModule().publishPlayerSnapshotUpdates({
			eventId: 1,
			playerIds: [5, 6],
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers).toHaveBeenCalledWith(1, [5, 6]);
		expect(mockPublication.featureMatchSlotsUpdated).toHaveBeenCalledWith({
			eventId: 1,
			slotIds: [21, 22],
			originConnectionId: 'origin-1',
		});
		expect(result).toEqual([21, 22]);
	});
	it('restores reviewed primary deck details after a generic player edit', async () => {
		const reviewedPlayer = createMockPlayer({
			id: 5,
			archetypeId: 3,
			gameData: { type: 'mtg', deckName: 'Reviewed Control', deckColors: 'WU' },
		});
		mockPlayerDeckService.reconcilePrimaryArchetype.mockResolvedValue(reviewedPlayer);

		await playerUpdateModule().updatePlayer({
			eventId: 1,
			playerId: 5,
			input: { gameData: { type: 'mtg', deckName: 'Manual Override', deckColors: 'R' } },
		});

		expect(mockPlayerDeckService.reconcilePrimaryArchetype).toHaveBeenCalledWith(1, 5, { reviewedOnly: true });
		expect(mockPublication.playerUpdated).toHaveBeenCalledWith(expect.objectContaining({
			entity: reviewedPlayer,
		}));
	});

	it('validates the archetype before creating a Player and returns the published response', async () => {
		const input = { archetypeId: 3, name: 'New Player' };

		const response = await playerUpdateModule().createPlayer({
			eventId: 1,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockRequireArchetypeInEvent).toHaveBeenCalledWith(1, input.archetypeId);
		expect(mockRequireArchetypeInEvent.mock.invocationCallOrder[0])
			.toBeLessThan(mockPlayerService.create.mock.invocationCallOrder[0]);
		expect(mockPlayerService.create).toHaveBeenCalledWith(1, input);
		expect(mockPublication.playerCreated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 9, name: 'New Player' }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 9, eventId: 1, name: 'New Player' });
	});

	it('deletes a Player and publishes the deletion', async () => {
		const response = await playerUpdateModule().deletePlayer({
			eventId: 1,
			playerId: 5,
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerService.remove).toHaveBeenCalledWith(5, 1);
		expect(mockPublication.playerDeleted).toHaveBeenCalledWith({
			eventId: 1,
			id: 5,
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ success: true });
	});

	it('returns 404 when deleting a missing Player', async () => {
		mockPlayerService.remove.mockResolvedValue(false);

		await expect(playerUpdateModule().deletePlayer({
			eventId: 1,
			playerId: 404,
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Player not found',
		});

		expect(mockPublication.playerDeleted).not.toHaveBeenCalled();
	});

	it('reviews a deck, publishes deck + player updates, and reverse-syncs slots', async () => {
		const response = await playerUpdateModule().reviewPlayerDeck({
			eventId: 1,
			playerId: 5,
			deckId: 21,
			archetypeId: 3,
			originConnectionId: 'origin-1',
		});

		expect(mockArchetypeService.findById).toHaveBeenCalledWith(3, 1);
		expect(mockPlayerDeckService.reviewDeck).toHaveBeenCalledWith(1, 5, 21, 3);
		expect(mockPublication.playerDeckReviewed).toHaveBeenCalledWith({
			eventId: 1,
			entity: { id: 21, playerId: 5 },
			archetype: expect.objectContaining({ id: 3 }),
			originConnectionId: 'origin-1',
		});
		expect(mockPublication.playerUpdated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 5, name: 'Reviewed Player' }),
			originConnectionId: 'origin-1',
		});
		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers).toHaveBeenCalledWith(1, [5]);
		expect(response).toEqual({
			deck: { id: 21, playerId: 5 },
			player: { id: 5, eventId: 1, name: 'Updated Player' },
		});
	});

	it('returns 404 when the reviewed archetype is missing', async () => {
		mockArchetypeService.findById.mockResolvedValue(null);

		await expect(playerUpdateModule().reviewPlayerDeck({
			eventId: 1,
			playerId: 5,
			deckId: 21,
			archetypeId: 404,
		})).rejects.toMatchObject({ statusCode: 404 });

		expect(mockPlayerDeckService.reviewDeck).not.toHaveBeenCalled();
		expect(mockPublication.playerDeckReviewed).not.toHaveBeenCalled();
	});

	it('returns 404 when the reviewed deck is missing', async () => {
		mockPlayerDeckService.reviewDeck.mockResolvedValue(null);

		await expect(playerUpdateModule().reviewPlayerDeck({
			eventId: 1,
			playerId: 5,
			deckId: 404,
			archetypeId: 3,
		})).rejects.toMatchObject({ statusCode: 404 });

		expect(mockPublication.playerDeckReviewed).not.toHaveBeenCalled();
	});

	it('skips the player publication when the reviewed deck has no player projection', async () => {
		mockPlayerDeckService.reviewDeck.mockResolvedValue({
			deck: { id: 21, playerId: 5 },
			player: null,
		});

		const response = await playerUpdateModule().reviewPlayerDeck({
			eventId: 1,
			playerId: 5,
			deckId: 21,
			archetypeId: 3,
		});

		expect(mockPublication.playerUpdated).not.toHaveBeenCalled();
		expect(mockPlayerFeatureMatchSyncService.syncMatchesFromPlayers).toHaveBeenCalledWith(1, [5]);
		expect(response.player).toBeNull();
	});
});
