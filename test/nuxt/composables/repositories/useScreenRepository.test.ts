import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useRealtime', () => () => createMockRealtime());

describe('useScreenRepository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns screen from getById when found', async () => {
		const screen = { id: 1, name: 'Test' };
		mockFetch.mockResolvedValue(screen);
		const repo = useScreenRepository();
		const result = await repo.getById(1, 1);
		expect(result).toEqual(screen);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/screens/1');
	});

	/**
	 * On the capability surface since #397, and asking with a credential.
	 *
	 * Both halves matter to a Screen Output: the path, because the old one is private
	 * and would answer 401; and the bearer, because that is what the route now
	 * requires of a caller with no session.
	 */
	it('gets screen by slug, presenting the capability as a bearer', async () => {
		const screen = { id: 1, slug: 'test-screen' };
		mockFetch.mockResolvedValue(screen);
		const repo = useScreenRepository();
		const result = await repo.getBySlug(1, 'test-screen', 'a-screen-output-capability-token');
		expect(result).toEqual(screen);
		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/slug/test-screen', {
			headers: { authorization: 'Bearer a-screen-output-capability-token' },
		});
	});

	it('sends no authorization when there is no capability, as the preview embeds do', async () => {
		// `embed=preview` holds none by design and is admitted by its operator's
		// session instead, which rides on the request without being asked for.
		const screen = { id: 1, slug: 'test-screen' };
		mockFetch.mockResolvedValue(screen);
		const repo = useScreenRepository();
		await repo.getBySlug(1, 'test-screen');
		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/slug/test-screen', {
			headers: undefined,
		});
	});

	it('updates mode config with PATCH', async () => {
		mockFetch.mockResolvedValue({ id: 1 });
		const repo = useScreenRepository();
		await repo.updateModeConfig(1, 1, 'match', { matchId: 5 });
		expect(mockFetch).toHaveBeenCalledWith(
			'/api/events/1/screens/1/config/match',
			expect.objectContaining({
				method: 'PATCH',
				body: { matchId: 5, stateVersion: 0 },
			}),
		);
	});

	it('updates screen config with PATCH', async () => {
		mockFetch.mockResolvedValue({ id: 1 });
		const repo = useScreenRepository();
		await repo.updateScreenConfig(1, 1, { background: '#000' });
		expect(mockFetch).toHaveBeenCalledWith(
			'/api/events/1/screens/1/screen-config',
			expect.objectContaining({
				method: 'PATCH',
				body: { background: '#000', stateVersion: 0 },
			}),
		);
	});
});
