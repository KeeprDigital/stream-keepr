import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const getValidatedRouterParams = vi.fn();
const readValidatedBody = vi.fn();
const setResponseStatus = vi.fn();
const getOriginConnectionId = vi.fn();
const findByEventId = vi.fn();
const findById = vi.fn();
const createBroadcastDeckList = vi.fn();
const parse = vi.fn(input => input);

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', getValidatedRouterParams);
vi.stubGlobal('readValidatedBody', readValidatedBody);
vi.stubGlobal('setResponseStatus', setResponseStatus);
vi.stubGlobal('createError', (input: Record<string, unknown>) => Object.assign(new Error(String(input.message)), input));

vi.mock('~~/server/schemas/api/event', () => ({
	eventParamsSchema: { parse },
}));
vi.mock('~~/server/schemas/api/broadcastDeckList', () => ({
	broadcastDeckListParamsSchema: { parse },
	createBroadcastDeckListSchema: { parse },
	updateBroadcastDeckListSchema: { parse },
	deleteBroadcastDeckListSchema: { parse },
}));
vi.mock('~~/server/services/broadcastDeckList', () => ({
	broadcastDeckListService: () => ({ findByEventId, findById }),
}));
vi.mock('~~/server/modules/broadcast-deck-list-write', () => ({
	broadcastDeckListWriteModule: () => ({ createBroadcastDeckList }),
}));
vi.mock('~~/server/utils/ably', () => ({ getOriginConnectionId }));

const collectionHandler = (await import('~~/server/api/events/[id]/broadcast-deck-lists/index.get')).default;
const detailHandler = (await import('~~/server/api/events/[id]/broadcast-deck-lists/[listId]/index.get')).default;
const createHandler = (await import('~~/server/api/events/[id]/broadcast-deck-lists/index.post')).default;

describe('broadcast Deck List routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getValidatedRouterParams.mockResolvedValue({ id: 7, listId: 11 });
		getOriginConnectionId.mockReturnValue('origin-1');
	});

	it('returns bounded Event-scoped summaries and an Event-scoped detail', async () => {
		const event = stubH3Event();
		findByEventId.mockResolvedValue([
			{ id: 11 },
		]);
		findById.mockResolvedValue({ id: 11, sourceText: '1 Island' });

		await expect(collectionHandler(event)).resolves.toEqual({
			broadcastDeckLists: [
				{ id: 11 },
			],
			total: 1,
		});
		await expect(detailHandler(event)).resolves.toEqual({ id: 11, sourceText: '1 Island' });
		expect(findByEventId).toHaveBeenCalledWith(7);
		expect(findById).toHaveBeenCalledWith(11, 7);
	});

	it('returns 404 when the Event-scoped detail does not exist', async () => {
		findById.mockResolvedValue(undefined);
		await expect(detailHandler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });
	});

	it('answers a created list with 201', async () => {
		const event = stubH3Event();
		createBroadcastDeckList.mockResolvedValue({ id: 12 });
		readValidatedBody.mockResolvedValue({ name: 'Deck', sourceText: '1 Island' });

		await expect(createHandler(event)).resolves.toEqual({ id: 12 });
		expect(setResponseStatus).toHaveBeenCalledWith(event, 201);
	});
});
