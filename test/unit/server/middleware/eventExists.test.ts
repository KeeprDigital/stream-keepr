import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const mockExists = vi.fn();

vi.mock('~~/server/services/event', () => ({
	eventService: () => ({ exists: mockExists }),
}));

const mockGetRequestURL = vi.fn();

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getRequestURL', mockGetRequestURL);
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) => Object.assign(new Error(input.message), input));

const handler = (await import('~~/server/middleware/event-exists')).default;

async function answer(path: string) {
	mockGetRequestURL.mockReturnValue(new URL(`https://stream.example${path}`));
	const event = stubH3Event({ context: {} });
	const status = await Promise.resolve(handler(event)).then(
		() => 'passed',
		(refusal: { statusCode: number }) => refusal.statusCode,
	);
	return { status, eventId: event.context.eventId };
}

// No path under `/api/events/:id` reaches a handler unless its id is a strict
// positive decimal integer naming an Event that exists.
describe('the Event existence middleware', () => {
	beforeEach(() => {
		mockExists.mockReset().mockImplementation(async (id: number) => id === 7);
	});

	it.each([
		['/api/events/7', 'passed', 7],
		['/api/events/7/players', 'passed', 7],
		['/api/events/8/players', 404, undefined],
		['/api/events/9e9/players', 400, undefined],
		['/api/events/0x10/players', 400, undefined],
		['/api/events/07/players', 400, undefined],
		['/api/events/0/players', 400, undefined],
		['/api/events/7.0/players', 400, undefined],
		['/api/events/%37/players', 400, undefined],
		['/api/events/seven', 400, undefined],
		// Not an Event path at all: the collection, and everything else.
		['/api/events', 'passed', undefined],
		['/api/events/', 'passed', undefined],
		['/api/eventsource/9e9', 'passed', undefined],
		['/api/screen-output/events/9e9/screens/1', 'passed', undefined],
	])('%s: %s', async (path, status, eventId) => {
		expect(await answer(path)).toEqual({ status, eventId });
	});

	it('asks about existence only for an id in the grammar', async () => {
		await answer('/api/events/9e9/players');

		expect(mockExists).not.toHaveBeenCalled();
	});
});
