import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockRequireUserId,
	mockFindAll,
} = vi.hoisted(() => ({
	mockRequireUserId: vi.fn(),
	mockFindAll: vi.fn(),
}));

vi.mock('~~/server/utils/auth', () => ({
	requireUserId: mockRequireUserId,
}));

vi.mock('~~/server/services/graphicStyleSet', () => ({
	graphicStyleSetService: () => ({ findAll: mockFindAll }),
}));

vi.mock('~~/server/mappers/graphicStyleSet', () => ({
	mapGraphicStyleSetToSummary: (styleSet: { id: string }) => ({ id: styleSet.id }),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));

describe('graphic Style Set browsing', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireUserId.mockReset().mockResolvedValue('author-1');
		mockFindAll.mockReset().mockResolvedValue([{ id: 'style-set-1' }]);
	});

	it('rejects the listing before touching the service without a graphics author session', async () => {
		// #206: the same session the sibling writes ask for, asked as
		// authentication and never consulted again — session-scoping, not access
		// control (ADR-0008).
		mockRequireUserId.mockRejectedValue(
			Object.assign(new Error('authenticated session required'), { statusCode: 401 }),
		);
		const handler = (await import('../../../../../server/api/graphics-style-sets/index.get')).default;

		await expect(handler(stubH3Event({}))).rejects.toMatchObject({ statusCode: 401 });
		expect(mockFindAll).not.toHaveBeenCalled();
	});

	it('returns the summaries when the session is present', async () => {
		const handler = (await import('../../../../../server/api/graphics-style-sets/index.get')).default;

		await expect(handler(stubH3Event({}))).resolves.toEqual({ styleSets: [{ id: 'style-set-1' }] });
	});
});
