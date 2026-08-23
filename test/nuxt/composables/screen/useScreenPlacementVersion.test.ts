import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it } from 'vitest';

const mockScreenStore = reactive({
	screens: [] as any[],
});

mockNuxtImport('useScreenStore', () => () => mockScreenStore);

describe('useScreenPlacementVersion', () => {
	beforeEach(() => {
		mockScreenStore.screens = [
			{ id: 1, stateVersion: 12 },
			{ id: 2, stateVersion: 3 },
		];
	});

	it('reads the state version of the screen a write is built against', () => {
		const version = useScreenPlacementVersion(1);

		expect(version.value).toBe(12);
	});

	it('falls back to 0 for a screen missing from the store', () => {
		const version = useScreenPlacementVersion(99);

		expect(version.value).toBe(0);
	});

	it('re-derives when the selected screen changes', () => {
		const screenId = ref(1);
		const version = useScreenPlacementVersion(screenId);

		expect(version.value).toBe(12);

		screenId.value = 2;

		expect(version.value).toBe(3);
	});

	it('re-derives when the store learns a new state version', () => {
		const version = useScreenPlacementVersion(1);

		expect(version.value).toBe(12);

		mockScreenStore.screens = [{ id: 1, stateVersion: 13 }];

		expect(version.value).toBe(13);
	});
});
