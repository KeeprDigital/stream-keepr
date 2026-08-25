import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const getValidatedRouterParams = vi.fn();
const readValidatedBody = vi.fn();
const setResponseStatus = vi.fn();
const getOriginConnectionId = vi.fn();
const findByEventId = vi.fn();
const findById = vi.fn();
const createBroadcastDeckList = vi.fn();
const updateBroadcastDeckList = vi.fn();
const deleteBroadcastDeckList = vi.fn();
const parse = vi.fn(input => input);

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', getValidatedRouterParams);
vi.stubGlobal('readValidatedBody', readValidatedBody);
vi.stubGlobal('setResponseStatus', setResponseStatus);
vi.stubGlobal('createError', (input: Record<string, unknown>) => Object.assign(new Error(String(input.message)), input));

vi.mock('~~/server/schemas/api/event', () => ({ eventParamsSchema: { parse } }));
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
	broadcastDeckListWriteModule: () => ({ createBroadcastDeckList, updateBroadcastDeckList, deleteBroadcastDeckList }),
}));
vi.mock('~~/server/utils/ably', () => ({ getOriginConnectionId }));

const collectionHandler = (await import('~~/server/api/events/[id]/broadcast-deck-lists/index.get')).default;
const detailHandler = (await import('~~/server/api/events/[id]/broadcast-deck-lists/[listId]/index.get')).default;
const createHandler = (await import('~~/server/api/events/[id]/broadcast-deck-lists/index.post')).default;
const updateHandler = (await import('~~/server/api/events/[id]/broadcast-deck-lists/[listId]/index.patch')).default;
const deleteHandler = (await import('~~/server/api/events/[id]/broadcast-deck-lists/[listId]/index.delete')).default;

describe('broadcast Deck List routes', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		getValidatedRouterParams.mockResolvedValue({ id: 7, listId: 11 });
		getOriginConnectionId.mockReturnValue('origin-1');
	});

	it('returns bounded Event-scoped summaries and an Event-scoped detail', async () => {
		const event = stubH3Event();
		findByEventId.mockResolvedValue([{ id: 11 }]);
		findById.mockResolvedValue({ id: 11, sourceText: '1 Island' });

		await expect(collectionHandler(event)).resolves.toEqual({ broadcastDeckLists: [{ id: 11 }], total: 1 });
		await expect(detailHandler(event)).resolves.toEqual({ id: 11, sourceText: '1 Island' });
		expect(findByEventId).toHaveBeenCalledWith(7);
		expect(findById).toHaveBeenCalledWith(11, 7);
	});

	it('returns 404 when the Event-scoped detail does not exist', async () => {
		findById.mockResolvedValue(undefined);
		await expect(detailHandler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });
	});

	it('delegates create, partial update, and revisioned delete with origin identity', async () => {
		const event = stubH3Event();
		createBroadcastDeckList.mockResolvedValue({ id: 12 });
		updateBroadcastDeckList.mockResolvedValue({ id: 11, revision: 2 });
		deleteBroadcastDeckList.mockResolvedValue({ success: true });
		readValidatedBody
			.mockResolvedValueOnce({ name: 'Deck', sourceText: '1 Island' })
			.mockResolvedValueOnce({ expectedRevision: 1, name: 'Renamed' })
			.mockResolvedValueOnce({ expectedRevision: 2 });

		await expect(createHandler(event)).resolves.toEqual({ id: 12 });
		await expect(updateHandler(event)).resolves.toEqual({ id: 11, revision: 2 });
		await expect(deleteHandler(event)).resolves.toEqual({ success: true });

		expect(setResponseStatus).toHaveBeenCalledWith(event, 201);
		expect(createBroadcastDeckList).toHaveBeenCalledWith({
			eventId: 7,
			input: { name: 'Deck', sourceText: '1 Island' },
			originConnectionId: 'origin-1',
		});
		expect(updateBroadcastDeckList).toHaveBeenCalledWith({
			eventId: 7,
			listId: 11,
			input: { expectedRevision: 1, name: 'Renamed' },
			originConnectionId: 'origin-1',
		});
		expect(deleteBroadcastDeckList).toHaveBeenCalledWith({
			eventId: 7,
			listId: 11,
			expectedRevision: 2,
			originConnectionId: 'origin-1',
		});
	});
});
