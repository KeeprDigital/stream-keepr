import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const { mockFindById } = vi.hoisted(() => ({ mockFindById: vi.fn() }));

vi.mock('~~/server/services/event', () => ({
	eventService: () => ({ findById: mockFindById }),
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

describe('one Event\'s Melee configuration', () => {
	beforeEach(() => {
		vi.resetModules();
		mockFindById.mockReset();
	});

	it('answers 404 when the Event is gone by the time the handler reads it', async () => {
		mockFindById.mockResolvedValue(undefined);
		const handler = (await import('../../../../../../server/api/events/[id]/melee-config.get')).default;

		await expect(handler(stubH3Event())).rejects.toMatchObject({ statusCode: 404 });
	});

	it('reports credentials as configured without disclosing the stored secret', async () => {
		mockFindById.mockResolvedValue({
			id: 7,
			meleeEnabled: true,
			meleeEventId: '123',
			meleeClientId: 'client-id',
			meleeClientSecret: 'stored-envelope',
		});
		const handler = (await import('../../../../../../server/api/events/[id]/melee-config.get')).default;

		const result = await handler(stubH3Event());

		expect(result).toEqual({
			meleeEnabled: true,
			meleeEventId: '123',
			meleeClientId: 'client-id',
			meleeConfigured: true,
		});
		expect(JSON.stringify(result)).not.toContain('stored-envelope');
	});
});
