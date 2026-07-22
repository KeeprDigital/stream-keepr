import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive, ref } from 'vue';

const mockEventStore = reactive({
	event: { id: 1 },
});

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

const mockOverlay = {
	create: vi.fn(() => ({
		open: vi.fn(() => ({ result: Promise.resolve(false) })),
		patch: vi.fn(),
	})),
};

const eventId = ref(1);
const initialLoading = ref(false);

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useOverlay', () => () => mockOverlay);
mockNuxtImport('useEventPageLoading', () => () => ({ eventId, initialLoading, initialError: ref(null), retry: vi.fn() }));

const NuxtLayoutStub = defineComponent({
	template: `
		<div>
			<div data-testid="actions"><slot name="actions" /></div>
			<slot />
		</div>
	`,
});

const ScreenListStub = defineComponent({
	template: '<div data-testid="screen-list" />',
});

const UIEmptyStateStub = defineComponent({
	props: {
		title: {
			type: String,
			required: true,
		},
		description: {
			type: String,
			required: false,
		},
	},
	template: '<div data-testid="empty-state">{{ title }}|{{ description }}<slot name="actions" /></div>',
});

const UButtonStub = defineComponent({
	template: '<button type="button"><slot /></button>',
});

const UContainerStub = defineComponent({
	template: '<div data-testid="container"><slot /></div>',
});

async function mountPage() {
	const pagePath = '../../../../../../app/pages/event/[eventId]/screens/index.vue';
	const { default: ScreensPage } = await import(pagePath);

	return mount(ScreensPage, {
		global: {
			stubs: {
				NuxtLayout: NuxtLayoutStub,
				UIEmptyState: UIEmptyStateStub,
				UContainer: UContainerStub,
				UButton: UButtonStub,
				ScreenList: ScreenListStub,
			},
		},
	});
}

describe('screens page', () => {
	beforeEach(() => {
		mockScreenStore.screens = [];
		mockScreenStore.error = null;
		initialLoading.value = false;
		mockOverlay.create.mockClear();
	});

	it('shows the empty-state create action when there are no screens', async () => {
		const wrapper = await mountPage();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No screens configured');
		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('Create Screen');
	});

	it('shows the navbar add action once screens exist', async () => {
		mockScreenStore.screens = [{ id: 3, name: 'Main Overlay' }];

		const wrapper = await mountPage();

		expect(wrapper.get('[data-testid="actions"]').text()).toContain('Add Screen');
	});

	it('tracks presence subscriptions when the screens array mutates in place', async () => {
		mockScreenStore.screens = [{ id: 1, name: 'Main Overlay' }];

		await mountPage();
		expect(mockScreenStore.subscribeToScreenPresence).toHaveBeenCalledWith(1);

		mockScreenStore.subscribeToScreenPresence.mockClear();
		mockScreenStore.unsubscribeFromScreenPresence.mockClear();

		mockScreenStore.screens.push({ id: 2, name: 'Side Control' });
		await nextTick();

		expect(mockScreenStore.subscribeToScreenPresence).toHaveBeenCalledWith(2);

		mockScreenStore.screens.splice(0, 1);
		await nextTick();

		expect(mockScreenStore.unsubscribeFromScreenPresence).toHaveBeenCalledWith(1);
	});
});
