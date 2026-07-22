import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, reactive } from 'vue';

vi.mock('~/composables/workflows/useEventLiveRefresh', () => ({
	useEventLiveRefresh: vi.fn(),
}));

const { mockClearPlayerDeckCache } = vi.hoisted(() => ({
	mockClearPlayerDeckCache: vi.fn(),
}));

const mockEventStore = reactive({
	eventId: 1,
	event: {
		id: 1,
		name: 'Event One',
		meleeEnabled: true,
		meleeConfigured: true,
		initialSetupCompletedAt: null as Date | null,
	},
	$reset: vi.fn(),
});

const mockScreenStore = reactive({
	screens: [] as Array<{ id: number; name: string }>,
	loadScreensByEventId: vi.fn(),
	$reset: vi.fn(),
});

const mockResetStore = () => ({ $reset: vi.fn() });
const mockPlayerStore = mockResetStore();
const mockArchetypeStore = mockResetStore();
const mockMetagameStore = mockResetStore();
const mockPlayerListStore = mockResetStore();
const mockPhaseStore = mockResetStore();
const mockRoundStore = mockResetStore();
const mockMatchStore = mockResetStore();
const mockFeatureMatchStore = mockResetStore();
const mockFeatureMatchAssignmentStore = mockResetStore();
const mockFeatureMatchStateStore = mockResetStore();
const mockCardStore = mockResetStore();
const mockMeleeStore = mockResetStore();
const mockColorMode = reactive({
	value: 'light',
	preference: 'light',
});

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useArchetypeStore', () => () => mockArchetypeStore);
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);
mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);
mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('useMatchStore', () => () => mockMatchStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchAssignmentStore', () => () => mockFeatureMatchAssignmentStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useCardStore', () => () => mockCardStore);
mockNuxtImport('useMeleeStore', () => () => mockMeleeStore);
mockNuxtImport('useColorMode', () => () => mockColorMode);
mockNuxtImport('useRoute', () => () => ({ meta: { title: 'Dashboard' }, path: '/event/1', query: {} }));
mockNuxtImport('clearPlayerDeckCache', () => mockClearPlayerDeckCache);
mockNuxtImport('navigateTo', () => vi.fn());

const UDashboardGroupStub = defineComponent({
	template: '<div><slot /></div>',
});

const UDashboardSidebarStub = defineComponent({
	template: '<aside><slot name="header" :collapsed="false" /><slot :collapsed="false" /><slot name="footer" :collapsed="false" /></aside>',
});

const UDashboardPanelStub = defineComponent({
	template: '<main><slot name="header" /><slot /></main>',
});

const UNavigationMenuStub = defineComponent({
	props: {
		items: {
			type: Array,
			required: true,
		},
	},
	setup(props: { items: Array<any> }) {
		const labels = computed(() => (props.items as Array<any>)
			.flatMap(item => [item.label, ...(item.children?.map((child: any) => child.label) ?? [])])
			.filter(Boolean)
			.join('|'));

		return { labels };
	},
	template: '<nav>{{ labels }}</nav>',
});

const UButtonStub = defineComponent({
	props: {
		label: {
			type: String,
			required: false,
		},
	},
	template: '<button type="button"><slot>{{ label }}</slot></button>',
});

async function mountLayout() {
	const layoutPath = '../../../../app/layouts/default.vue';
	const { default: DefaultLayout } = await import(layoutPath);

	return mount(DefaultLayout, {
		slots: {
			default: '<div>Page Body</div>',
		},
		global: {
			stubs: {
				UDashboardGroup: UDashboardGroupStub,
				UDashboardSidebar: UDashboardSidebarStub,
				UDashboardPanel: UDashboardPanelStub,
				UDashboardNavbar: true,
				UDashboardSidebarCollapse: true,
				UNavigationMenu: UNavigationMenuStub,
				USeparator: true,
				UIServerTimeStatus: true,
				UButton: UButtonStub,
			},
		},
	});
}

describe('default layout sync navigation', () => {
	beforeEach(() => {
		mockEventStore.eventId = 1;
		mockEventStore.event = {
			id: 1,
			name: 'Event One',
			meleeEnabled: true,
			meleeConfigured: true,
			initialSetupCompletedAt: null,
		};
		mockScreenStore.screens = [];
		mockScreenStore.loadScreensByEventId.mockReset();
		mockEventStore.$reset.mockReset();
		mockPlayerStore.$reset.mockReset();
		mockArchetypeStore.$reset.mockReset();
		mockMetagameStore.$reset.mockReset();
		mockPlayerListStore.$reset.mockReset();
		mockPhaseStore.$reset.mockReset();
		mockRoundStore.$reset.mockReset();
		mockMatchStore.$reset.mockReset();
		mockFeatureMatchStore.$reset.mockReset();
		mockFeatureMatchAssignmentStore.$reset.mockReset();
		mockFeatureMatchStateStore.$reset.mockReset();
		mockCardStore.$reset.mockReset();
		mockMeleeStore.$reset.mockReset();
		mockClearPlayerDeckCache.mockReset();
	});

	it('shows sync navigation before initial setup is complete', async () => {
		const wrapper = await mountLayout();

		expect(wrapper.text()).toContain('Sync');
	});
});
