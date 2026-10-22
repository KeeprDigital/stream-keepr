import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, reactive } from 'vue';
import { LOCAL_DEVELOPER_USER_EMAIL, LOCAL_DEVELOPER_USER_ID, LOCAL_DEVELOPER_USER_NAME } from '~~/shared/utils/localDeveloperAuth';

vi.mock('~/composables/workflows/useEventLiveRefresh', () => ({
	useEventLiveRefresh: vi.fn(),
}));

const { mockClearPlayerDeckCache, mockNavigateTo, mockSignOut, mockToastAdd, mockUser } = vi.hoisted(() => ({
	mockClearPlayerDeckCache: vi.fn(),
	mockNavigateTo: vi.fn(),
	mockSignOut: vi.fn(),
	mockToastAdd: vi.fn(),
	mockUser: { value: null as { id: string; email: string; name: string } | null },
}));

// `user` has to be a real ref for the layout's template to unwrap it, and a
// hoisted factory cannot call `ref`; a computed over the hoisted container is
// both, and each test sets the container before it mounts.
vi.mock('~/modules/auth/session', () => ({
	useAuthSession: () => ({ signOut: mockSignOut, user: computed(() => mockUser.value) }),
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
mockNuxtImport('navigateTo', () => mockNavigateTo);
mockNuxtImport('useToast', () => () => ({ add: mockToastAdd }));

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
	// Each item gets a button so a test can take the action the sidebar offers,
	// not merely read the label it offers it under.
	template: '<nav>{{ labels }}<button v-for="item in items" :key="item.label" type="button" :data-nav-item="item.label" @click="item.onSelect?.()" /></nav>',
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

/** The navbar's own slots, and whether it would offer the mobile sidebar toggle. */
const UDashboardNavbarStub = defineComponent({
	props: { toggle: { type: Boolean, default: true } },
	template: '<header data-testid="navbar" :data-toggle="String(toggle)"><slot name="leading" /><slot /><slot name="right" /></header>',
});

async function mountLayout(props: Record<string, unknown> = {}) {
	const layoutPath = '../../../../app/layouts/default.vue';
	const { default: DefaultLayout } = await import(layoutPath);

	return mount(DefaultLayout, {
		props,
		slots: {
			default: '<div>Page Body</div>',
		},
		global: {
			stubs: {
				UDashboardGroup: UDashboardGroupStub,
				UDashboardSidebar: UDashboardSidebarStub,
				UDashboardPanel: UDashboardPanelStub,
				UDashboardNavbar: UDashboardNavbarStub,
				UDashboardSidebarCollapse: true,
				UIRealtimeStatus: true,
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

describe('default layout sign-out', () => {
	beforeEach(() => {
		mockNavigateTo.mockReset();
		mockSignOut.mockReset();
		mockToastAdd.mockReset();
		mockUser.value = { id: 'usr_1', email: 'operator@example.test', name: 'Operator' };
	});

	it('names the signed-in operator, so a shared machine says whose session it is', async () => {
		const wrapper = await mountLayout();

		expect(wrapper.text()).toContain('operator@example.test');
	});

	it('names the Local Developer User and offers no meaningless sign-out', async () => {
		mockUser.value = {
			id: LOCAL_DEVELOPER_USER_ID,
			email: LOCAL_DEVELOPER_USER_EMAIL,
			name: LOCAL_DEVELOPER_USER_NAME,
		};

		const wrapper = await mountLayout();

		expect(wrapper.text()).toContain(LOCAL_DEVELOPER_USER_NAME);
		expect(wrapper.find('[data-nav-item="Sign out"]').exists()).toBe(false);
	});

	it('signs out and sends the browser to the login page', async () => {
		mockSignOut.mockResolvedValue({ ok: true });

		const wrapper = await mountLayout();
		await wrapper.find('[data-nav-item="Sign out"]').trigger('click');
		await flushPromises();

		expect(mockSignOut).toHaveBeenCalledOnce();
		expect(mockNavigateTo).toHaveBeenCalledWith('/login');
	});

	it('stays put and says so when the sign-out did not land', async () => {
		mockSignOut.mockResolvedValue({ ok: false, message: 'Could not sign out — the session is still open. Try again.' });

		const wrapper = await mountLayout();
		await wrapper.find('[data-nav-item="Sign out"]').trigger('click');
		await flushPromises();

		expect(mockNavigateTo).not.toHaveBeenCalled();
		expect(mockToastAdd).toHaveBeenCalledWith(expect.objectContaining({
			description: 'Could not sign out — the session is still open. Try again.',
		}));
	});
});

/**
 * Editor Focus Mode (#744): a page whose graphics editor wants the width hides
 * the app sidebar entirely, keeping the connection statuses its footer carried.
 */
describe('default layout Editor Focus Mode', () => {
	it('shows the app sidebar outside Focus Mode', async () => {
		const wrapper = await mountLayout();

		expect(wrapper.find('aside').exists()).toBe(true);
		expect(wrapper.get('[data-testid="navbar"]').find('u-i-realtime-status-stub').exists()).toBe(false);
	});

	it('hides the app sidebar and its toggles in Focus Mode, keeping the connection statuses in the navbar', async () => {
		const wrapper = await mountLayout({ focus: true });

		expect(wrapper.find('aside').exists()).toBe(false);
		expect(wrapper.find('u-dashboard-sidebar-collapse-stub').exists()).toBe(false);

		const navbar = wrapper.get('[data-testid="navbar"]');
		expect(navbar.attributes('data-toggle')).toBe('false');
		expect(navbar.find('u-i-realtime-status-stub').exists()).toBe(true);
		expect(navbar.find('u-i-server-time-status-stub').exists()).toBe(true);
	});
});
