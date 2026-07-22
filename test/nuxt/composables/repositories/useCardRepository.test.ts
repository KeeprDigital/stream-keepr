import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
const mockAbly = createMockRealtime();

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('useRealtime', () => () => mockAbly);

describe('useCardRepository', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('saves a screen card with PUT', async () => {
		const card = { id: 'abc', name: 'Bolt' };
		mockFetch.mockResolvedValue({ success: true });
		const repo = useCardRepository();

		await repo.saveScreenCard(1, 2, card as any);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/screens/2/card', expect.objectContaining({
			method: 'PUT',
			body: card,
		}));
	});

	it('gets a screen card', async () => {
		const card = { id: 'abc', name: 'Bolt' };
		mockFetch.mockResolvedValue(card);
		const repo = useCardRepository();

		const result = await repo.getScreenCard(1, 2);
		expect(result).toEqual(card);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/screens/2/card');
	});

	it('deletes a screen card with DELETE', async () => {
		mockFetch.mockResolvedValue({ success: true });
		const repo = useCardRepository();

		await repo.deleteScreenCard(1, 2);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/screens/2/card', expect.objectContaining({
			method: 'DELETE',
		}));
	});
});
