import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick, reactive } from 'vue';

// The mode-settings module pulls in every mode's Display/Settings component
// (feature-match overlay, metagame, etc.) via defineAsyncComponent. None of
// that is relevant to the screenId race-condition behavior under test, so
// stub it down to plain, synchronous no-ops.
vi.mock('~/modules/screen-mode', () => ({
	getScreenModeConfigurationPolicy: vi.fn(() => null),
	getScreenModeLabel: vi.fn((mode: string) => mode),
	getScreenModeSelectOptions: vi.fn(() => []),
	getScreenModeSettingsComponent: vi.fn(() => null),
}));

const route = reactive({
	params: { eventId: '1', screenId: '1' } as Record<string, string>,
});

const mockEventStore = reactive({
	event: { id: 1 },
});

interface PendingLoad {
	screenId: number;
	resolve: (screen: unknown) => void;
}

let pendingLoads: PendingLoad[] = [];

const mockScreenStore = reactive({
	screens: [] as Array<{ id: number; screenConfig?: Record<string, unknown> }>,
	subscribeToScreenPresence: vi.fn(),
	unsubscribeFromScreenPresence: vi.fn(),
	getConnectedCount: vi.fn(() => 0),
	updateScreenConfig: vi.fn(),
	getScreenById: vi.fn((_eventId: number, screenId: number) => new Promise((resolve) => {
		pendingLoads.push({ screenId, resolve });
	})),
});

const mockToast = { add: vi.fn() };

mockNuxtImport('useRoute', () => () => route);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useToast', () => () => mockToast);

const NuxtLayoutStub = defineComponent({
	template: '<div><slot name="actions" /><slot /></div>',
});

const UContainerStub = defineComponent({
	template: '<div><slot /></div>',
});

const CardStub = defineComponent({
	template: '<div><slot /></div>',
});

function makeScreen(id: number) {
	return {
		id,
		name: `Screen ${id}`,
		slug: `screen-${id}`,
		currentMode: 'idle',
		screenConfig: {},
	};
}

/** Resolve the getScreenById(...) call for a specific screenId, in whatever order the test wants. */
function resolveLoad(screenId: number, screen: unknown) {
	const index = pendingLoads.findIndex(load => load.screenId === screenId);
	if (index === -1)
		throw new Error(`No pending load for screen ${screenId}`);
	const [load] = pendingLoads.splice(index, 1);
	load!.resolve(screen);
}

async function mountPage() {
	const pagePath = '../../../../../../app/pages/event/[eventId]/screens/[screenId].vue';
	const { default: ScreenPage } = await import(pagePath);

	return mount(ScreenPage, {
		global: {
			stubs: {
				NuxtLayout: NuxtLayoutStub,
				UContainer: UContainerStub,
				UILoadingSpinner: true,
				UIEmptyState: true,
				UButton: true,
				UCard: CardStub,
				UBadge: true,
				UIcon: true,
				UTooltip: true,
				USelect: true,
				UFieldGroup: true,
				UDropdownMenu: true,
				USeparator: true,
				UPopover: true,
				UAlert: true,
			},
		},
	});
}

describe('screen config page — screenId route changes', () => {
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;

	beforeEach(() => {
		pendingLoads = [];
		route.params.screenId = '1';
		mockScreenStore.screens = [];
		mockScreenStore.subscribeToScreenPresence.mockClear();
		mockScreenStore.unsubscribeFromScreenPresence.mockClear();
		mockScreenStore.getScreenById.mockClear();
		mockToast.add.mockClear();
	});

	afterEach(() => {
		// The mocked route is a module-level singleton shared across tests — an
		// un-unmounted page instance would keep reacting to route changes made
		// by the next test and double up on loadScreen calls.
		wrapper?.unmount();
		wrapper = null;
	});

	it('loads and subscribes to the initial screenId on mount', async () => {
		wrapper = await mountPage();
		await flushPromises();

		expect(mockScreenStore.getScreenById).toHaveBeenCalledWith(1, 1);
		resolveLoad(1, makeScreen(1));
		await flushPromises();

		expect(mockScreenStore.subscribeToScreenPresence).toHaveBeenCalledWith(1);
	});

	it('discards a stale load and never subscribes an intermediate screenId when screenId changes rapidly', async () => {
		wrapper = await mountPage();
		await flushPromises();

		resolveLoad(1, makeScreen(1));
		await flushPromises();
		expect(mockScreenStore.subscribeToScreenPresence).toHaveBeenCalledWith(1);
		mockScreenStore.subscribeToScreenPresence.mockClear();

		// Rapid screenId change 1 -> 2 -> 3, before either the 2 or 3 load resolves
		route.params.screenId = '2';
		await nextTick();
		expect(mockScreenStore.unsubscribeFromScreenPresence).toHaveBeenCalledWith(1);
		expect(mockScreenStore.getScreenById).toHaveBeenCalledWith(1, 2);

		route.params.screenId = '3';
		await nextTick();
		expect(mockScreenStore.unsubscribeFromScreenPresence).toHaveBeenCalledWith(2);
		expect(mockScreenStore.getScreenById).toHaveBeenCalledWith(1, 3);

		// The intermediate (screenId=2) load resolves late, after screenId has already
		// moved on to 3 — its result must be discarded rather than applied.
		resolveLoad(2, makeScreen(2));
		await flushPromises();

		expect(mockScreenStore.subscribeToScreenPresence).not.toHaveBeenCalledWith(2);
		expect(wrapper.text()).not.toContain('Screen 2');

		// The current (screenId=3) load resolves and is applied normally.
		resolveLoad(3, makeScreen(3));
		await flushPromises();

		expect(mockScreenStore.subscribeToScreenPresence).toHaveBeenCalledWith(3);
		expect(wrapper.text()).toContain('Screen 3');
	});
});
