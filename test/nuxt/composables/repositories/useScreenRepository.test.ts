import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

const mockFetch = vi.fn();

vi.stubGlobal('$fetch', mockFetch);
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

	it('gets screen by slug', async () => {
		const screen = { id: 1, slug: 'test-screen' };
		mockFetch.mockResolvedValue(screen);
		const repo = useScreenRepository();
		const result = await repo.getBySlug(1, 'test-screen');
		expect(result).toEqual(screen);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/screens/slug/test-screen');
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
