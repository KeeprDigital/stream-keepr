import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const mockGetValidatedRouterParams = vi.fn();
const mockReadValidatedBody = vi.fn();
const mockGetOriginConnectionId = vi.fn();
const mockFindArchetypeById = vi.fn();
const mockFindEvent = vi.fn();
const mockSetKeyCards = vi.fn();
const mockArchetypeKeyCardsUpdated = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', mockGetValidatedRouterParams);
vi.stubGlobal('readValidatedBody', mockReadValidatedBody);
vi.stubGlobal('createError', (input: { statusCode?: number; statusMessage?: string; message?: string }) =>
	Object.assign(new Error(input.message ?? input.statusMessage), input));

vi.mock('drizzle-orm', () => ({
	and: vi.fn(() => ({})),
	eq: vi.fn(() => ({})),
	inArray: vi.fn(() => ({})),
	or: vi.fn(() => ({})),
	sql: vi.fn(() => ({})),
}));

vi.mock('~~/server/db', () => ({
	db: {
		query: {
			events: {
				findFirst: mockFindEvent,
			},
		},
	},
}));

vi.mock('~~/server/db/schema', () => ({
	cards: {
		id: 'cards.id',
		game: 'cards.game',
		name: 'cards.name',
	},
	events: {
		id: 'events.id',
	},
}));

vi.mock('~~/server/schemas/api/archetype', () => ({
	archetypeParamsSchema: { parse: vi.fn(input => input) },
	setArchetypeKeyCardsSchema: { parse: vi.fn(input => input) },
}));

vi.mock('~~/server/services/archetype', () => ({
	archetypeService: () => ({
		findById: mockFindArchetypeById,
	}),
}));

vi.mock('~~/server/services/archetypeCard', () => ({
	archetypeCardService: () => ({
		setKeyCards: mockSetKeyCards,
	}),
}));

vi.mock('~~/server/modules/event-data-publication', () => ({
	eventDataPublicationModule: () => ({
		archetypeKeyCardsUpdated: mockArchetypeKeyCardsUpdated,
	}),
}));

vi.mock('~~/server/utils/ably', () => ({
	getOriginConnectionId: mockGetOriginConnectionId,
}));

describe('patch /api/events/[id]/archetypes/[archetypeId]/cards', () => {
	beforeEach(() => {
		vi.resetModules();
		mockGetValidatedRouterParams.mockReset().mockResolvedValue({ id: 1, archetypeId: 11 });
		mockReadValidatedBody.mockReset().mockResolvedValue({ cardIds: [] });
		mockGetOriginConnectionId.mockReset().mockReturnValue('origin-1');
		mockFindArchetypeById.mockReset().mockResolvedValue({ id: 11, eventId: 1 });
		mockFindEvent.mockReset().mockResolvedValue({ game: 'mtg' });
		mockSetKeyCards.mockReset().mockResolvedValue([]);
		mockArchetypeKeyCardsUpdated.mockReset().mockResolvedValue([]);
	});

	it('publishes key-card changes after persistence', async () => {
		const handler = (await import('~~/server/api/events/[id]/archetypes/[archetypeId]/cards.patch.ts')).default;

		await expect(handler(stubH3Event())).resolves.toEqual({ keyCards: [] });

		expect(mockFindArchetypeById).toHaveBeenCalledWith(11, 1);
		expect(mockSetKeyCards).toHaveBeenCalledWith(11, []);
		expect(mockArchetypeKeyCardsUpdated).toHaveBeenCalledWith({
			eventId: 1,
			archetypeId: 11,
			keyCards: [],
			originConnectionId: 'origin-1',
		});
	});
});
