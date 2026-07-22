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

const { resetAllEventStores } = await import('~~/app/utils/eventStores');

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
});
