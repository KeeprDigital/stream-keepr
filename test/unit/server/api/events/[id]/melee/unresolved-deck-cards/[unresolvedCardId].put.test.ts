import { describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

/**
 * The route's wiring — params parsing, body validation, `requestEvent`
 * threading — was bounded only by the compiler until #356: no file under
 * `test/` mentioned it, and #346's M8 row recorded the surviving mutation
 * (`requestEvent: {} as any` — 44/44 green) that the compiler alone permits
 * via a deliberate cast. These rows run the route's own zod schemas rather
 * than mocking them, because the coercion and refusals ARE the wiring under
 * test; the stubs below hand each validator the raw values a request would
 * carry.
 */
const mockGetValidatedRouterParams = vi.fn(async (
	event: { __params: unknown },
	validate: (input: unknown) => unknown,
) => validate(event.__params));
const mockReadValidatedBody = vi.fn(async (
	event: { __body: unknown },
	validate: (input: unknown) => unknown,
) => validate(event.__body));
const mockResolveUnresolvedDeckCard = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', mockGetValidatedRouterParams);
vi.stubGlobal('readValidatedBody', mockReadValidatedBody);

vi.mock('~~/server/modules/deck-list-resolution', () => ({
	deckListResolutionModule: () => ({
		resolveUnresolvedDeckCard: mockResolveUnresolvedDeckCard,
	}),
}));

const handler = (await import(
	'~~/server/api/events/[id]/melee/unresolved-deck-cards/[unresolvedCardId].put',
)).default;

const scryfallId = '3b1e5f6a-9d2c-4e8f-b7a1-0c5d4e3f2a1b';

function requestFor(params: Record<string, string>, body: Record<string, unknown>) {
	// Carries a distinguishing property on purpose: `toHaveBeenCalledWith`
	// compares deeply, so a bare `{}` could not tell this request apart from any
	// other empty object a careless edit might thread as `requestEvent` — the
	// exact mutation #346's M8 row proved the compiler permits.
	return stubH3Event({
		__requestEventFor: 'unresolved-deck-card-resolution',
		__params: params,
		__body: body,
	});
}

describe('pUT /api/events/[id]/melee/unresolved-deck-cards/[unresolvedCardId] wiring', () => {
	it('threads the coerced params, validated body, and the request itself to the resolution module', async () => {
		mockResolveUnresolvedDeckCard.mockReset();
		const resolution = { outcome: 'resolved', resolvedCardCount: 3 };
		mockResolveUnresolvedDeckCard.mockResolvedValue(resolution);
		const event = requestFor({ id: '7', unresolvedCardId: '31' }, { scryfallId });

		await expect(handler(event)).resolves.toBe(resolution);

		expect(mockResolveUnresolvedDeckCard).toHaveBeenCalledWith({
			eventId: 7,
			unresolvedCardId: 31,
			scryfallId,
			requestEvent: event,
		});
	});

	it('refuses a non-positive card id before the resolution module is asked', async () => {
		mockResolveUnresolvedDeckCard.mockReset();
		const event = requestFor({ id: '7', unresolvedCardId: '0' }, { scryfallId });

		await expect(handler(event)).rejects.toMatchObject({ name: 'ZodError' });
		expect(mockResolveUnresolvedDeckCard).not.toHaveBeenCalled();
	});

	it('refuses a scryfallId that is not a UUID before the resolution module is asked', async () => {
		mockResolveUnresolvedDeckCard.mockReset();
		const event = requestFor({ id: '7', unresolvedCardId: '31' }, { scryfallId: 'not-a-uuid' });

		await expect(handler(event)).rejects.toMatchObject({ name: 'ZodError' });
		expect(mockResolveUnresolvedDeckCard).not.toHaveBeenCalled();
	});
});
