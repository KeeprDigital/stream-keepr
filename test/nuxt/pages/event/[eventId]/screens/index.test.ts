import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive, ref } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';

const mockScreenStore = reactive({
	screens: [] as Array<{ id: number; name: string }>,
	error: null as string | null,
	isLoaded: true,
	loadScreensByEventId: vi.fn(),
	subscribeToScreenPresence: vi.fn(),
	unsubscribeFromScreenPresence: vi.fn(),
	getConnectedCount: vi.fn(() => 0),
	removeScreen: vi.fn(),
	setScreenMode: vi.fn(),
	sendScreenCommand: vi.fn(),
});

mockNuxtImport('useEventStore', () => () => reactive({
	event: { id: 1 },
}));
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useOverlay', () => () => ({
	create: vi.fn(() => ({
		open: vi.fn(),
		patch: vi.fn(),
	})),
}));
mockNuxtImport('useEventPageLoading', () => () => ({
	eventId: ref(1),
	initialLoading: ref(false),
	initialError: ref(null),
	retry: vi.fn(),
}));

async function mountPage() {
	const pagePath = '../../../../../../app/pages/event/[eventId]/screens/index.vue';
	const { default: ScreensPage } = await import(pagePath);

	return mount(ScreensPage, {
		global: {
			stubs: {
				...nuxtUiStubs,
				NuxtLayout: defineComponent({ template: '<div><slot name="actions" /><slot /></div>' }),
				UIEmptyState: true,
				ScreenList: true,
			},
		},
	});
}

describe('screens page', () => {
	it('follows presence for Screens added to and removed from the collection in place', async () => {
		mockScreenStore.screens = [
			{ id: 1, name: 'Main Overlay' },
		];

		await mountPage();
		expect(mockScreenStore.subscribeToScreenPresence).toHaveBeenCalledWith(1);

		mockScreenStore.screens.push({ id: 2, name: 'Side Control' });
		await nextTick();

		expect(mockScreenStore.subscribeToScreenPresence).toHaveBeenCalledWith(2);

		mockScreenStore.screens.splice(0, 1);
		await nextTick();

		expect(mockScreenStore.unsubscribeFromScreenPresence).toHaveBeenCalledWith(1);
	});
});
