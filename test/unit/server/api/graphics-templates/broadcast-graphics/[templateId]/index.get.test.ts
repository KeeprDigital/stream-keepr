import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stubH3Event } from '~~/test/helpers/h3Event';

const {
	mockRequireGraphicsAuthorSession,
	mockFindEntry,
} = vi.hoisted(() => ({
	mockRequireGraphicsAuthorSession: vi.fn(),
	mockFindEntry: vi.fn(),
}));

vi.mock('~~/server/modules/graphics-author-session', () => ({
	requireGraphicsAuthorSession: mockRequireGraphicsAuthorSession,
}));

vi.mock('~~/server/modules/broadcast-graphic-template-library', () => ({
	findBroadcastGraphicTemplateLibraryEntry: mockFindEntry,
	broadcastGraphicTemplateLibrarySummary: (entry: { id: string }) => ({ id: entry.id }),
}));

vi.stubGlobal('defineEventHandler', vi.fn(handler => handler));
vi.stubGlobal('getValidatedRouterParams', vi.fn(async () => ({ templateId: 'template-1' })));
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input));

describe('one Broadcast Graphic Template library entry', () => {
	beforeEach(() => {
		vi.resetModules();
		mockRequireGraphicsAuthorSession.mockReset().mockResolvedValue('author-1');
		mockFindEntry.mockReset().mockResolvedValue({ id: 'template-1', document: {} });
	});

	it('rejects the read before touching the library without a graphics author session', async () => {
		// #206: the entry's document embeds Graphic Asset identities, so the
		// identifiers #172 hid from the Asset Library stayed reachable one layer
		// over until this read asked for the same session its sibling writes do.
		mockRequireGraphicsAuthorSession.mockRejectedValue(
			Object.assign(new Error('authenticated session required'), { statusCode: 401 }),
		);
		const handler = (await import(
			'../../../../../../../server/api/graphics-templates/broadcast-graphics/[templateId]/index.get',
		)).default;

		await expect(handler(stubH3Event({}))).rejects.toMatchObject({ statusCode: 401 });
		expect(mockFindEntry).not.toHaveBeenCalled();
	});

	it('returns the summary with the stored document when the session is present', async () => {
		const handler = (await import(
			'../../../../../../../server/api/graphics-templates/broadcast-graphics/[templateId]/index.get',
		)).default;

		await expect(handler(stubH3Event({}))).resolves.toMatchObject({ id: 'template-1', document: {} });
	});
});
