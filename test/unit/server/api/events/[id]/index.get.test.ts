import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const { mockFindById, mockMapEventToResponse } = vi.hoisted(() => ({
	mockFindById: vi.fn(),
	mockMapEventToResponse: vi.fn(),
}));

vi.mock('~~/server/services/event', () => ({
	eventService: () => ({ findById: mockFindById }),
}));
vi.mock('~~/server/mappers/event', () => ({
	mapEventToResponse: mockMapEventToResponse,
}));
vi.mock('~~/server/schemas/api/event', () => ({
	eventParamsSchema: { parse: (input: unknown) => input },
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', vi.fn(async (
	_event: unknown,
	validate: (input: unknown) => unknown,
) => validate({ id: 7 })));
vi.stubGlobal('createError', (input: {
	statusCode: number;
	statusMessage?: string;
	message?: string;
}) => Object.assign(new Error(input.message ?? input.statusMessage), input));

/**
 * `event-exists` middleware answered a separate, earlier query, so the handler
 * asking again is not redundant work — it is the only read whose answer can
 * still be true when the response is written. A deletion landing between the
 * two used to reach the mapper as `undefined` and answer 500.
 */
describe('one Event as the API reports it', () => {
	beforeEach(() => {
		vi.resetModules();
		mockFindById.mockReset();
		mockMapEventToResponse.mockReset().mockReturnValue({ id: 7 });
	});

	it('answers 404 when the Event is gone by the time the handler reads it', async () => {
		mockFindById.mockResolvedValue(undefined);
		const handler = (await import('../../../../../../server/api/events/[id]/index.get')).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });
		expect(mockMapEventToResponse).not.toHaveBeenCalled();
	});

	it('maps the Event it found', async () => {
		mockFindById.mockResolvedValue({ id: 7, talents: [] });
		const handler = (await import('../../../../../../server/api/events/[id]/index.get')).default;

		await expect(handler(stubH3Event())).resolves.toEqual({ id: 7 });
		expect(mockMapEventToResponse).toHaveBeenCalledWith({ id: 7, talents: [] });
	});
});
