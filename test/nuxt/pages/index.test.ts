import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';

const mockEventStore = reactive({
	eventsList: [] as Array<{ id: number; name: string }>,
	loadEventsList: vi.fn(async () => {}),
});

const mockModalOpen = vi.fn();
const mockOverlay = {
	create: vi.fn(() => ({ open: mockModalOpen })),
};

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useOverlay', () => () => mockOverlay);

const NuxtLayoutStub = defineComponent({
	template: `
		<div>
			<div data-testid="actions"><slot name="actions" /></div>
			<slot />
		</div>
	`,
});

const EventListStub = defineComponent({
	props: {
		events: {
			type: Array,
			required: true,
		},
		error: {
			type: Object,
			required: false,
		},
	},
	template: '<div data-testid="event-list">{{ error ? \'error:\' + error.message : events.length }}</div>',
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

async function mountPage() {
	const pagePath = '../../../app/pages/index.vue';
	const { default: EventsPage } = await import(pagePath);

	return mount(EventsPage, {
		global: {
			stubs: {
				NuxtLayout: NuxtLayoutStub,
				UIEmptyState: UIEmptyStateStub,
				UContainer: true,
				UButton: UButtonStub,
				EventList: EventListStub,
			},
		},
	});
}

describe('events page', () => {
	beforeEach(() => {
		mockEventStore.eventsList = [];
		mockEventStore.loadEventsList.mockClear();
		mockEventStore.loadEventsList.mockResolvedValue(undefined);
		mockOverlay.create.mockClear();
		mockModalOpen.mockClear();
	});

	it('shows the empty-state create action when the list is empty', async () => {
		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No events yet');
		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('Create Event');
	});

	it('shows the navbar create action once events exist', async () => {
		mockEventStore.eventsList = [{ id: 1, name: 'Regional Championship' }];

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="actions"]').text()).toContain('Create Event');
	});

	it('shows a load error instead of the empty-events state', async () => {
		mockEventStore.loadEventsList.mockRejectedValueOnce(new Error('Network unavailable'));

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="event-list"]').text()).toBe('error:Network unavailable');
		expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(false);
	});

	it('still shows the create-event action when the list errors', async () => {
		mockEventStore.loadEventsList.mockRejectedValueOnce(new Error('Network unavailable'));

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="actions"]').text()).toContain('Create Event');
	});
});
