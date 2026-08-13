import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerEventDataLifecycleReset } from '~~/app/modules/event-data/lifecycle';

const mockClearPlayerDeckCache = vi.hoisted(() => vi.fn());
const mockStoreReset = vi.hoisted(() => vi.fn());

mockNuxtImport('useEventStore', () => () => ({ $reset: mockStoreReset }));
mockNuxtImport('useMetagameStore', () => () => ({ $reset: mockStoreReset }));
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => ({ $reset: mockStoreReset }));
mockNuxtImport('useFeatureMatchStateStore', () => () => ({ $reset: mockStoreReset }));
mockNuxtImport('useScreenStore', () => () => ({ $reset: mockStoreReset }));
mockNuxtImport('useCardStore', () => () => ({ $reset: mockStoreReset }));
mockNuxtImport('useMeleeStore', () => () => ({ $reset: mockStoreReset }));
mockNuxtImport('usePlayerDeckStore', () => () => ({ $reset: mockStoreReset }));
mockNuxtImport('clearPlayerDeckCache', () => mockClearPlayerDeckCache);

const { registerPendingEditFlush, resetAllEventStores } = await import('~~/app/utils/eventStores');

describe('event store reset registry', () => {
	let unregister: (() => void) | null = null;

	afterEach(() => {
		unregister?.();
		unregister = null;
		vi.clearAllMocks();
	});

	it('resets registered Event Data lifecycles and clears player Deck List cache', () => {
		const lifecycleReset = vi.fn();
		unregister = registerEventDataLifecycleReset(lifecycleReset);

		resetAllEventStores();

		expect(lifecycleReset).toHaveBeenCalledOnce();
		expect(mockStoreReset).toHaveBeenCalled();
		expect(mockClearPlayerDeckCache).toHaveBeenCalledOnce();
	});

	/**
	 * A local-first surface has an edit in hand that the operator has already been
	 * shown as saved, and the state its write needs is what these resets clear. So
	 * the order is the whole point, not an incidental detail of this function (#308).
	 */
	describe('pending edits held by a local-first surface', () => {
		it('are spent before any Event-scoped state is cleared', () => {
			const order: string[] = [];
			mockStoreReset.mockImplementation(() => order.push('reset'));
			unregister = registerPendingEditFlush(() => order.push('flush'));

			resetAllEventStores();

			expect(order[0]).toBe('flush');
			expect(order).toContain('reset');
		});

		it('stop being flushed once their surface unregisters', () => {
			const flush = vi.fn();
			registerPendingEditFlush(flush)();

			resetAllEventStores();

			expect(flush).not.toHaveBeenCalled();
		});
	});
});
