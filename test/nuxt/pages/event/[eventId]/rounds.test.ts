import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';

const mockEventStore = reactive({
	event: { id: 1, meleeEnabled: false },
	eventId: 1,
	loadEvent: vi.fn(),
});

const mockPhaseStore = reactive({
	phases: [] as Array<{ id: number; name: string; sortOrder: number }>,
	isLoaded: true,
	loadPhasesByEventId: vi.fn(),
	createPhase: vi.fn(),
	removePhase: vi.fn(),
});

const mockRoundStore = reactive({
	rounds: [] as Array<{ id: number; phaseId: number; status: string; name: string; roundNumber: number; externalSource?: string | null; externalId?: string | null; lastSyncedAt?: string | null }>,
	isLoaded: true,
	loadRoundsByEventId: vi.fn(),
	createRound: vi.fn(),
	removeRound: vi.fn(),
});

const mockMeleeStore = {
	syncSpecificRound: vi.fn(),
};

const mockToast = {
	add: vi.fn(),
};

const mockOverlay = {
	create: vi.fn(() => ({
		open: vi.fn(() => ({ result: Promise.resolve(false) })),
	})),
};

const eventId = ref(1);
const initialLoading = ref(false);

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('usePhaseStore', () => () => mockPhaseStore);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('useMeleeStore', () => () => mockMeleeStore);
mockNuxtImport('useToast', () => () => mockToast);
mockNuxtImport('useOverlay', () => () => mockOverlay);
mockNuxtImport('useEventPageLoading', () => () => ({ eventId, initialLoading, initialError: ref(null), retry: vi.fn() }));
mockNuxtImport('navigateTo', () => vi.fn());

const NuxtLayoutStub = defineComponent({
	template: `
		<div>
			<div data-testid="actions"><slot name="actions" /></div>
			<div data-testid="toolbar"><slot name="toolbar" /></div>
			<slot />
		</div>
	`,
});

const UDashboardToolbarStub = defineComponent({
	template: '<div data-testid="toolbar-content"><slot name="left" /><slot name="right" /></div>',
});

const RoundPhaseListStub = defineComponent({
	template: '<div data-testid="phase-list" />',
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
	template: '<button type="button"><slot />{{ label }}</button>',
	props: {
		label: {
			type: String,
			required: false,
		},
	},
});

async function mountPage() {
	const pagePath = '../../../../../app/pages/event/[eventId]/rounds.vue';
	const { default: RoundsPage } = await import(pagePath);

	return mount(RoundsPage, {
		global: {
			stubs: {
				NuxtLayout: NuxtLayoutStub,
				UDashboardToolbar: UDashboardToolbarStub,
				UIEmptyState: UIEmptyStateStub,
				RoundPhaseList: RoundPhaseListStub,
				UButton: UButtonStub,
				UBadge: true,
				UIcon: true,
			},
		},
	});
}

describe('rounds page', () => {
	beforeEach(() => {
		mockPhaseStore.phases = [];
		mockRoundStore.rounds = [];
		initialLoading.value = false;
		mockOverlay.create.mockClear();
		mockToast.add.mockClear();
	});

	it('shows the empty-state add action when there are no phases', async () => {
		const wrapper = await mountPage();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No event structure yet');
		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('Add Phase');
	});

	it('shows the navbar add action once phases exist', async () => {
		mockPhaseStore.phases = [{ id: 1, name: 'Swiss', sortOrder: 0 }];

		const wrapper = await mountPage();

		expect(wrapper.get('[data-testid="actions"]').text()).toContain('Add Phase');
	});
});
