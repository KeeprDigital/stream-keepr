import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockFetch);

describe('useScreenOutputBroadcastDeckListRepository', () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	it('reads the list selected by the Screen with the output capability', async () => {
		mockFetch.mockResolvedValue({ id: 23, revision: 4 });
		const repository = useScreenOutputBroadcastDeckListRepository();

		await expect(repository.getSelected(5, 7, 'a-screen-output-capability-token'))
			.resolves
			.toMatchObject({ id: 23, revision: 4 });
		expect(mockFetch).toHaveBeenCalledWith(
			'/api/screen-output/events/5/screens/7/broadcast-deck-list',
			{ headers: { authorization: 'Bearer a-screen-output-capability-token' } },
		);
	});

	it('uses the operator session cookie when an embed has no capability', async () => {
		mockFetch.mockResolvedValue({ id: 23 });
		const repository = useScreenOutputBroadcastDeckListRepository();

		await repository.getSelected(5, 7, null);

		expect(mockFetch).toHaveBeenCalledWith(
			'/api/screen-output/events/5/screens/7/broadcast-deck-list',
			{ headers: undefined },
		);
	});
});
