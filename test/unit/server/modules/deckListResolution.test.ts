import type { H3Event } from 'h3';
import type { DbPlayerDeckUnresolvedCard } from '~~/server/db/schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { refusalFrom } from '~~/test/helpers/publicServerFailure';

const mockRequireMeleeSyncEventData = vi.fn();
const mockSetResponseHeader = vi.fn();
const mockPlayerDeckCompanionService = {
	shouldSyncImportedCompanion: vi.fn(),
};
const mockPlayerDeckUnresolvedCardService = {
	findById: vi.fn(),
	listMatchingEntries: vi.fn(),
};
const mockPlayerDeckService = {
	findManyByIds: vi.fn(),
};
const mockFetchScryfallCardById = vi.fn();

class MockDeckCompanionValidationError extends Error {}

vi.mock('hub:db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	cards: {
		id: 'cards.id',
		name: 'cards.name',
		game: 'cards.game',
		scryfallId: 'cards.scryfall_id',
		oracleId: 'cards.oracle_id',
		cardType: 'cards.card_type',
		colors: 'cards.colors',
		cmc: 'cards.cmc',
		manaCost: 'cards.mana_cost',
		deckCounterTypes: 'cards.deck_counter_types',
		deckTokens: 'cards.deck_tokens',
		updatedAt: 'cards.updated_at',
	},
	eventCardNameOverrides: {
		eventId: 'event_card_name_overrides.event_id',
		inputName: 'event_card_name_overrides.input_name',
		normalizedInputName: 'event_card_name_overrides.normalized_input_name',
		inputSetCode: 'event_card_name_overrides.input_set_code',
		normalizedInputSetCode: 'event_card_name_overrides.normalized_input_set_code',
		resolvedCardId: 'event_card_name_overrides.resolved_card_id',
		updatedAt: 'event_card_name_overrides.updated_at',
	},
	playerDeckCards: {
		id: 'player_deck_cards.id',
		deckId: 'player_deck_cards.deck_id',
		cardId: 'player_deck_cards.card_id',
		quantity: 'player_deck_cards.quantity',
		compartment: 'player_deck_cards.compartment',
		sortOrder: 'player_deck_cards.sort_order',
	},
	playerDeckCompanions: {
		deckId: 'player_deck_companions.deck_id',
		companionCardId: 'player_deck_companions.companion_card_id',
		source: 'player_deck_companions.source',
		updatedAt: 'player_deck_companions.updated_at',
	},
	playerDeckUnresolvedCards: {
		id: 'player_deck_unresolved_cards.id',
		quantity: 'player_deck_unresolved_cards.quantity',
		sortOrder: 'player_deck_unresolved_cards.sort_order',
	},
}));
vi.mock('~~/server/modules/melee-sync/eventData', () => ({
	requireMeleeSyncEventData: mockRequireMeleeSyncEventData,
}));
vi.mock('~~/server/services/playerDeckCompanion', () => ({
	DeckCompanionValidationError: MockDeckCompanionValidationError,
	playerDeckCompanionService: () => mockPlayerDeckCompanionService,
}));
vi.mock('~~/server/services/playerDeckUnresolvedCard', () => ({
	playerDeckUnresolvedCardService: () => mockPlayerDeckUnresolvedCardService,
}));
vi.mock('~~/server/services/playerDeck', () => ({
	playerDeckService: () => mockPlayerDeckService,
}));
vi.mock('~~/server/utils/scryfall', () => ({
	fetchScryfallCardById: mockFetchScryfallCardById,
}));

// `cause` and `statusMessage` are carried through (#346) because the retry-after rows
// below assert on the refusal a caller actually receives — the error after
// `mapPublicNitroError` — and that mapper reads its classification off the cause. A
// stub that dropped it would let the surviving sentence be sanitized to 'Internal
// Server Error', failing the pin for a reason that has nothing to do with the header.
// The rows that predate this assert on the raw throw and are indifferent to it.
vi.stubGlobal('createError', (input: { statusCode: number; message?: string; statusMessage?: string; cause?: unknown }) => {
	return Object.assign(new Error(input.message ?? input.statusMessage), input);
});
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);

const { deckListResolutionModule } = await import('~~/server/modules/deck-list-resolution');

const NOW = new Date('2026-01-01T00:00:00.000Z');
// Carries a distinguishing property on purpose: `toHaveBeenCalledWith` compares
// deeply, so a bare `{}` cannot tell the request the route was answering apart from
// any other empty object a careless edit might hand `setResponseHeader`.
const requestEvent = { __requestEventFor: 'deck-list-resolution' } as unknown as H3Event;

function createUnresolvedEntry(overrides: Partial<DbPlayerDeckUnresolvedCard> = {}): DbPlayerDeckUnresolvedCard {
	return {
		id: 11,
		deckId: 101,
		entryType: 'card',
		originalName: 'Lightnng Bolt',
		normalizedOriginalName: 'lightnng bolt',
		setCode: 'M11',
		normalizedSetCode: 'm11',
		quantity: 4,
		compartment: 'mainboard',
		sortOrder: 2,
		cardType: 'Instant',
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

describe('deck List Resolution server module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		resetDbMocks();
		mockRequireMeleeSyncEventData.mockResolvedValue(undefined);
		mockPlayerDeckCompanionService.shouldSyncImportedCompanion.mockResolvedValue(true);
		mockPlayerDeckUnresolvedCardService.findById.mockResolvedValue(createUnresolvedEntry());
		mockPlayerDeckUnresolvedCardService.listMatchingEntries.mockResolvedValue([
			createUnresolvedEntry({ id: 11, deckId: 101, sortOrder: 2 }),
			createUnresolvedEntry({ id: 12, deckId: 102, quantity: 1, compartment: null, sortOrder: 8 }),
		]);
		mockPlayerDeckService.findManyByIds.mockResolvedValue([{ id: 101 }, { id: 102 }]);
		mockFetchScryfallCardById.mockResolvedValue({
			id: '11111111-1111-4111-8111-111111111111',
			name: 'Lightning Bolt',
			oracleId: 'oracle-bolt',
			typeLine: 'Instant',
			colors: 'R',
			cmc: 1,
			manaCost: '{R}',
			deckCounterTypes: ['charge'],
			deckTokens: [{ id: 'treasure', scryfallId: null, name: 'Treasure', typeLine: 'Token Artifact', uri: null }],
		});
	});

	it('resolves a grouped card entry and owns persistence side effects', async () => {
		getChain('select').where.mockResolvedValue([]);
		const result = await deckListResolutionModule().resolveUnresolvedDeckCard({
			eventId: 1,
			unresolvedCardId: 11,
			scryfallId: '11111111-1111-4111-8111-111111111111',
			requestEvent,
		});

		expect(mockRequireMeleeSyncEventData).toHaveBeenCalledWith(1);
		expect(mockPlayerDeckUnresolvedCardService.findById).toHaveBeenCalledWith(11, 1);
		expect(mockPlayerDeckUnresolvedCardService.listMatchingEntries).toHaveBeenCalledWith(1, 'lightnng bolt', 'm11', 'card');
		expect(mockFetchScryfallCardById).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
		expect(mockDb.batch).toHaveBeenCalledOnce();
		expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(5);
		expect(getChain('insert').values).toHaveBeenNthCalledWith(1, expect.objectContaining({
			name: 'Lightning Bolt',
			game: 'mtg',
			scryfallId: '11111111-1111-4111-8111-111111111111',
			deckCounterTypes: ['charge'],
			deckTokens: [expect.objectContaining({ id: 'treasure', name: 'Treasure' })],
		}));
		expect(getChain('insert').onConflictDoUpdate.mock.calls[0]![0]).toEqual(expect.objectContaining({
			set: expect.objectContaining({
				deckCounterTypes: ['charge'],
				deckTokens: [expect.objectContaining({ id: 'treasure', name: 'Treasure' })],
			}),
		}));
		expect(getChain('insert').values).toHaveBeenNthCalledWith(2, expect.objectContaining({
			eventId: 1,
			inputName: 'Lightnng Bolt',
			normalizedInputName: 'lightnng bolt',
		}));
		expect(result).toEqual({
			success: true,
			message: 'Resolved 2 entries for Lightnng Bolt as Lightning Bolt',
			resolvedCardName: 'Lightning Bolt',
			unresolvedId: 11,
			resolvedCount: 2,
		});
	});

	it('maps imported companion validation failures to a 400 response error', async () => {
		mockPlayerDeckUnresolvedCardService.findById.mockResolvedValue(createUnresolvedEntry({ entryType: 'companion' }));
		mockPlayerDeckUnresolvedCardService.listMatchingEntries.mockResolvedValue([
			createUnresolvedEntry({ id: 20, entryType: 'companion' }),
		]);
		mockPlayerDeckService.findManyByIds.mockResolvedValue([{ id: 101 }]);
		getChain('select').limit.mockResolvedValue([{ id: 501 }]);
		mockPlayerDeckCompanionService.shouldSyncImportedCompanion.mockRejectedValue(
			new MockDeckCompanionValidationError('Imported companion requires an open sideboard slot or an existing sideboard copy.'),
		);

		await expect(deckListResolutionModule().resolveUnresolvedDeckCard({
			eventId: 1,
			unresolvedCardId: 20,
			scryfallId: '11111111-1111-4111-8111-111111111111',
			requestEvent,
		})).rejects.toMatchObject({
			statusCode: 400,
			message: 'Imported companion requires an open sideboard slot or an existing sideboard copy.',
		});

		expect(mockDb.batch).not.toHaveBeenCalled();
	});

	it('preserves a manual companion while atomically resolving its imported entry', async () => {
		mockPlayerDeckUnresolvedCardService.findById.mockResolvedValue(createUnresolvedEntry({ entryType: 'companion' }));
		mockPlayerDeckUnresolvedCardService.listMatchingEntries.mockResolvedValue([
			createUnresolvedEntry({ id: 20, entryType: 'companion' }),
		]);
		mockPlayerDeckService.findManyByIds.mockResolvedValue([{ id: 101 }]);
		getChain('select').limit.mockResolvedValue([{ id: 501 }]);
		mockPlayerDeckCompanionService.shouldSyncImportedCompanion.mockResolvedValue(false);

		await deckListResolutionModule().resolveUnresolvedDeckCard({
			eventId: 1,
			unresolvedCardId: 20,
			scryfallId: '11111111-1111-4111-8111-111111111111',
			requestEvent,
		});

		expect(mockDb.batch).toHaveBeenCalledOnce();
		expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(3);
		expect(getChain('insert').select).not.toHaveBeenCalled();
	});

	it('rejects matching entries that reference players outside the Event', async () => {
		mockPlayerDeckService.findManyByIds.mockResolvedValue([{ id: 101 }]);

		await expect(deckListResolutionModule().resolveUnresolvedDeckCard({
			eventId: 1,
			unresolvedCardId: 11,
			scryfallId: '11111111-1111-4111-8111-111111111111',
			requestEvent,
		})).rejects.toMatchObject({
			statusCode: 409,
			message: 'Unresolved deck card references a deck outside this event',
		});

		expect(mockFetchScryfallCardById).not.toHaveBeenCalled();
	});

	it('maps an unavailable card provider to a safe gateway error before writing', async () => {
		// Asserted at the public seam since #355 — the throw site no longer spells the
		// refusal, so the raw throw carries nothing a caller receives. What is this
		// row's: the provider's own response body never reaches a caller, and nothing
		// is written before the refusal.
		mockFetchScryfallCardById.mockRejectedValue({
			code: 'SCRYFALL_UPSTREAM_FAILURE',
			notFound: false,
			message: 'private upstream response body',
		});

		const refusal = await refusalFrom(deckListResolutionModule().resolveUnresolvedDeckCard({
			eventId: 1,
			unresolvedCardId: 11,
			scryfallId: '11111111-1111-4111-8111-111111111111',
			requestEvent,
		}));

		expect(refusal.statusCode).toBe(502);
		expect(refusal.message).toBe('Card data provider is temporarily unavailable. Try again later.');
		expect(refusal.message).not.toContain('private upstream response body');
		expect(mockDb.batch).not.toHaveBeenCalled();
	});

	it('maps an unknown Scryfall card ID to a client error', async () => {
		mockFetchScryfallCardById.mockRejectedValue({
			code: 'SCRYFALL_UPSTREAM_FAILURE',
			notFound: true,
		});

		await expect(deckListResolutionModule().resolveUnresolvedDeckCard({
			eventId: 1,
			unresolvedCardId: 11,
			scryfallId: '11111111-1111-4111-8111-111111111111',
			requestEvent,
		})).rejects.toMatchObject({
			statusCode: 400,
			message: 'The selected Scryfall card was not found',
		});
	});

	/**
	 * The number that goes with the word *temporarily*.
	 *
	 * #346, the second of the two sites #337's review found still carrying its defect:
	 * the sentence called the outage momentary and the response carried no
	 * `retry-after`, so a caller told to come back had to invent an interval. Asserted
	 * after `mapPublicNitroError` because that is the response a caller actually
	 * receives — the header and the sentence are one piece of guidance, and #321's
	 * finding was precisely the two halves disagreeing. A row reading the header off
	 * the raw throw would pass with the sentence sanitized away.
	 */
	it('tells a caller how long to wait for the card provider, beside a sentence saying what for', async () => {
		mockFetchScryfallCardById.mockRejectedValue({
			code: 'SCRYFALL_UPSTREAM_FAILURE',
			notFound: false,
			message: 'private upstream response body',
		});

		const refusal = await refusalFrom(deckListResolutionModule().resolveUnresolvedDeckCard({
			eventId: 1,
			unresolvedCardId: 11,
			scryfallId: '11111111-1111-4111-8111-111111111111',
			requestEvent,
		}));

		expect(refusal.statusCode).toBe(502);
		expect(refusal.message).toBe('Card data provider is temporarily unavailable. Try again later.');
		expect(mockSetResponseHeader).toHaveBeenCalledWith(requestEvent, 'retry-after', 5);
	});

	it('does not tell a caller to wait for a card ID that no waiting will resolve', async () => {
		// The counterweight to the row above, and the same distinction
		// `requireGraphicsAdministrator` makes: an unreachable provider resolves by
		// waiting and a card ID the provider does not have does not — waiting only makes
		// it later. A `retry-after` set once for the whole catch block would satisfy the
		// row above and be wrong here, which is what this exists to catch.
		mockFetchScryfallCardById.mockRejectedValue({
			code: 'SCRYFALL_UPSTREAM_FAILURE',
			notFound: true,
		});

		await expect(deckListResolutionModule().resolveUnresolvedDeckCard({
			eventId: 1,
			unresolvedCardId: 11,
			scryfallId: '11111111-1111-4111-8111-111111111111',
			requestEvent,
		})).rejects.toMatchObject({ statusCode: 400 });

		expect(mockSetResponseHeader).not.toHaveBeenCalled();
	});

	it('merges pre-existing duplicate card rows inside the same retry-safe batch', async () => {
		getChain('select').where.mockResolvedValue([
			{ id: 31, deckId: 101, quantity: 2, compartment: 'mainboard', sortOrder: 0 },
			{ id: 32, deckId: 101, quantity: 1, compartment: 'mainboard', sortOrder: 4 },
		]);
		mockPlayerDeckUnresolvedCardService.listMatchingEntries.mockResolvedValue([
			createUnresolvedEntry({ id: 11, deckId: 101, quantity: 4, sortOrder: 2 }),
		]);
		mockPlayerDeckService.findManyByIds.mockResolvedValue([{ id: 101 }]);

		await deckListResolutionModule().resolveUnresolvedDeckCard({
			eventId: 1,
			unresolvedCardId: 11,
			scryfallId: '11111111-1111-4111-8111-111111111111',
			requestEvent,
		});

		expect(mockDb.batch).toHaveBeenCalledOnce();
		expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(5);
		expect(getChain('update').set).toHaveBeenCalledOnce();
		expect(getChain('delete').where).toHaveBeenCalledTimes(2);
	});
});
