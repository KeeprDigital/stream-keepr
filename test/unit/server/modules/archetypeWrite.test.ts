import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockArchetype } from '~~/test/helpers/fixtures';

const mockFindEvent = vi.fn();
const mockSelectWhere = vi.fn();
const mockBatch = vi.fn();

const mockArchetypeService = {
	create: vi.fn(),
	update: vi.fn(),
	findById: vi.fn(),
	buildRemoveQuery: vi.fn(() => ({ kind: 'remove-query' })),
};
const mockArchetypeCardService = {
	getKeyCards: vi.fn(),
	setKeyCards: vi.fn(),
};
const mockPlayerDeckService = {
	listPlayerIdsByArchetype: vi.fn(),
	listPrimaryPlayerIdsByArchetype: vi.fn(),
	buildClearReviewsByArchetypeQuery: vi.fn(() => ({ kind: 'clear-reviews-query' })),
};
const mockPlayerUpdateModule = {
	reconcileDeckProjections: vi.fn(),
	publishPlayerSnapshotUpdates: vi.fn(),
};
const mockPublication = {
	archetypeCreated: vi.fn(),
	archetypeUpdated: vi.fn(),
	archetypeDeleted: vi.fn(),
	archetypeKeyCardsUpdated: vi.fn(),
};

vi.mock('drizzle-orm', () => ({
	and: vi.fn(() => ({})),
	eq: vi.fn(() => ({})),
	inArray: vi.fn(() => ({})),
	or: vi.fn(() => ({})),
	sql: vi.fn(() => ({})),
}));

vi.mock('hub:db', () => ({
	db: {
		batch: mockBatch,
		query: {
			events: {
				findFirst: mockFindEvent,
			},
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: mockSelectWhere,
			})),
		})),
	},
}));

vi.mock('~~/server/db/schema', () => ({
	cards: { id: 'cards.id', game: 'cards.game', name: 'cards.name' },
	events: { id: 'events.id' },
}));

vi.mock('~~/server/services/archetype', () => ({
	archetypeService: () => mockArchetypeService,
}));

vi.mock('~~/server/services/archetypeCard', () => ({
	archetypeCardService: () => mockArchetypeCardService,
}));

vi.mock('~~/server/services/playerDeck', () => ({
	playerDeckService: () => mockPlayerDeckService,
}));

vi.mock('~~/server/modules/player-update', () => ({
	playerUpdateModule: () => mockPlayerUpdateModule,
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => mockPublication,
}));

vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string }) => {
	const error = new Error(input.message ?? input.statusMessage) as Error & { statusCode: number };
	error.statusCode = input.statusCode;
	return error;
});

const { archetypeWriteModule } = await import('~~/server/modules/archetype-write');

describe('archetypeWriteModule', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockArchetypeService.create.mockResolvedValue(createMockArchetype({ id: 11, name: 'New Deck' }));
		mockArchetypeService.update.mockResolvedValue(createMockArchetype({ id: 11, name: 'Updated Deck' }));
		mockArchetypeService.findById.mockResolvedValue(createMockArchetype({ id: 11 }));
		mockArchetypeCardService.getKeyCards.mockResolvedValue([]);
		mockArchetypeCardService.setKeyCards.mockResolvedValue([]);
		mockPlayerDeckService.listPlayerIdsByArchetype.mockResolvedValue([]);
		mockPlayerDeckService.listPrimaryPlayerIdsByArchetype.mockResolvedValue([]);
		mockBatch.mockResolvedValue([[], [{ id: 11 }]]);
		mockFindEvent.mockResolvedValue({ game: 'mtg' });
		mockSelectWhere.mockResolvedValue([]);
		mockPublication.archetypeCreated.mockResolvedValue({ id: 11, name: 'New Deck', keyCards: [] });
		mockPublication.archetypeUpdated.mockResolvedValue({ id: 11, name: 'Updated Deck', keyCards: [] });
		mockPublication.archetypeKeyCardsUpdated.mockResolvedValue([]);
	});

	it('creates an Archetype and publishes the created event', async () => {
		const input = { name: 'New Deck', colors: 'WU' };

		const response = await archetypeWriteModule().createArchetype({
			eventId: 1,
			input,
			originConnectionId: 'origin-1',
		});

		expect(mockArchetypeService.create).toHaveBeenCalledWith(1, input);
		expect(mockPublication.archetypeCreated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 11, name: 'New Deck' }),
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 11, name: 'New Deck', keyCards: [] });
	});

	it('updates an Archetype, reconciles decks, and publishes with key cards', async () => {
		mockPlayerDeckService.listPlayerIdsByArchetype.mockResolvedValue([5, 6, 7]);
		mockPlayerDeckService.listPrimaryPlayerIdsByArchetype.mockResolvedValue([5]);
		mockArchetypeCardService.getKeyCards.mockResolvedValue([{ id: 99 }]);

		const response = await archetypeWriteModule().updateArchetype({
			eventId: 1,
			archetypeId: 11,
			input: { name: 'Updated Deck' },
			originConnectionId: 'origin-1',
		});

		expect(mockArchetypeService.update).toHaveBeenCalledWith(11, 1, { name: 'Updated Deck' });
		expect(mockPlayerUpdateModule.reconcileDeckProjections).toHaveBeenCalledWith({
			eventId: 1,
			playerIds: [5],
			originConnectionId: 'origin-1',
		});
		// Secondary players are those affected but not primary.
		expect(mockPlayerUpdateModule.publishPlayerSnapshotUpdates).toHaveBeenCalledWith({
			eventId: 1,
			playerIds: [6, 7],
			originConnectionId: 'origin-1',
		});
		expect(mockPublication.archetypeUpdated).toHaveBeenCalledWith({
			eventId: 1,
			entity: expect.objectContaining({ id: 11 }),
			keyCards: [{ id: 99 }],
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ id: 11, name: 'Updated Deck', keyCards: [] });
	});

	it('returns 404 when archetypeService.update returns undefined', async () => {
		mockArchetypeService.update.mockResolvedValue(undefined);

		await expect(archetypeWriteModule().updateArchetype({
			eventId: 1,
			archetypeId: 404,
			input: { name: 'Missing' },
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Archetype not found',
		});

		expect(mockPublication.archetypeUpdated).not.toHaveBeenCalled();
		expect(mockPlayerUpdateModule.reconcileDeckProjections).not.toHaveBeenCalled();
	});

	it('deletes an Archetype atomically with review clearing and publishes the deletion', async () => {
		mockPlayerDeckService.listPlayerIdsByArchetype.mockResolvedValue([5, 6]);
		mockPlayerDeckService.listPrimaryPlayerIdsByArchetype.mockResolvedValue([5]);

		const response = await archetypeWriteModule().deleteArchetype({
			eventId: 1,
			archetypeId: 11,
			originConnectionId: 'origin-1',
		});

		expect(mockPlayerDeckService.buildClearReviewsByArchetypeQuery).toHaveBeenCalledWith(1, 11);
		expect(mockArchetypeService.buildRemoveQuery).toHaveBeenCalledWith(11, 1);
		expect(mockBatch).toHaveBeenCalledWith([
			{ kind: 'clear-reviews-query' },
			{ kind: 'remove-query' },
		]);
		expect(mockPlayerUpdateModule.reconcileDeckProjections).toHaveBeenCalledWith({
			eventId: 1,
			playerIds: [5],
			originConnectionId: 'origin-1',
		});
		expect(mockPlayerUpdateModule.publishPlayerSnapshotUpdates).toHaveBeenCalledWith({
			eventId: 1,
			playerIds: [6],
			originConnectionId: 'origin-1',
		});
		expect(mockPublication.archetypeDeleted).toHaveBeenCalledWith({
			eventId: 1,
			id: 11,
			originConnectionId: 'origin-1',
		});
		expect(response).toEqual({ success: true });
	});

	it('returns 404 when the archetype does not exist before delete', async () => {
		mockArchetypeService.findById.mockResolvedValue(undefined);

		await expect(archetypeWriteModule().deleteArchetype({
			eventId: 1,
			archetypeId: 404,
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Archetype not found',
		});

		expect(mockBatch).not.toHaveBeenCalled();
		expect(mockPublication.archetypeDeleted).not.toHaveBeenCalled();
	});

	it('returns 404 when the batch delete removes no archetype rows', async () => {
		mockBatch.mockResolvedValue([[], []]);

		await expect(archetypeWriteModule().deleteArchetype({
			eventId: 1,
			archetypeId: 11,
		})).rejects.toMatchObject({
			statusCode: 404,
			message: 'Archetype not found',
		});

		expect(mockPublication.archetypeDeleted).not.toHaveBeenCalled();
	});

	describe('updateCards', () => {
		it('resolves explicit cardIds, sets key cards, and publishes', async () => {
			mockSelectWhere.mockResolvedValue([{ id: 3 }, { id: 4 }]);
			mockArchetypeCardService.setKeyCards.mockResolvedValue([{ id: 3 }, { id: 4 }]);

			const response = await archetypeWriteModule().updateCards({
				eventId: 1,
				archetypeId: 11,
				input: { cardIds: [3, 4] },
				originConnectionId: 'origin-1',
			});

			expect(mockArchetypeCardService.setKeyCards).toHaveBeenCalledWith(11, [3, 4]);
			expect(mockPublication.archetypeKeyCardsUpdated).toHaveBeenCalledWith({
				eventId: 1,
				archetypeId: 11,
				keyCards: [{ id: 3 }, { id: 4 }],
				originConnectionId: 'origin-1',
			});
			expect(response).toEqual({ keyCards: [{ id: 3 }, { id: 4 }] });
		});

		it('returns 404 when the archetype does not belong to the event', async () => {
			mockArchetypeService.findById.mockResolvedValue(undefined);

			await expect(archetypeWriteModule().updateCards({
				eventId: 1,
				archetypeId: 404,
				input: { cardIds: [] },
			})).rejects.toMatchObject({
				statusCode: 404,
				message: 'Archetype not found',
			});

			expect(mockArchetypeCardService.setKeyCards).not.toHaveBeenCalled();
		});

		it('rejects key cards for non-MTG events', async () => {
			mockFindEvent.mockResolvedValue({ game: 'lorcana' });

			await expect(archetypeWriteModule().updateCards({
				eventId: 1,
				archetypeId: 11,
				input: { cardIds: [3] },
			})).rejects.toMatchObject({
				statusCode: 400,
				message: 'Key cards are only supported for MTG events',
			});

			expect(mockArchetypeCardService.setKeyCards).not.toHaveBeenCalled();
		});

		it('rejects cardIds that do not reference MTG cards', async () => {
			mockSelectWhere.mockResolvedValue([{ id: 3 }]);

			await expect(archetypeWriteModule().updateCards({
				eventId: 1,
				archetypeId: 11,
				input: { cardIds: [3, 4] },
			})).rejects.toMatchObject({
				statusCode: 400,
				message: 'One or more cardIds do not reference MTG cards',
			});

			expect(mockArchetypeCardService.setKeyCards).not.toHaveBeenCalled();
		});
	});
});
