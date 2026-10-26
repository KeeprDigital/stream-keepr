import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';

const mockEventStore = reactive({
	eventsList: [] as Array<{ id: number; name: string }>,
	loadEventsList: vi.fn(async () => {}),
});

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useOverlay', () => () => ({
	create: vi.fn(() => ({
		open: vi.fn(),
	})),
}));

const NuxtLayoutStub = defineComponent({
	template: '<div><div data-testid="actions"><slot name="actions" /></div><slot /></div>',
});

const EventListStub = defineComponent({
	props: {
		events: { type: Array, required: true },
		error: { type: Object, required: false },
	},
	template: '<div data-testid="event-list">{{ error ? \'error:\' + error.message : events.length }}</div>',
});

const UIEmptyStateStub = defineComponent({
	props: {
		title: { type: String, required: true },
	},
	template: '<div data-testid="empty-state">{{ title }}<slot name="actions" /></div>',
});

async function mountPage() {
	const pagePath = '../../../app/pages/index.vue';
	const { default: EventsPage } = await import(pagePath);

	return mount(EventsPage, {
		global: {
			stubs: {
				...nuxtUiStubs,
				NuxtLayout: NuxtLayoutStub,
				UIEmptyState: UIEmptyStateStub,
				EventList: EventListStub,
			},
		},
	});
}

describe('events page', () => {
	beforeEach(() => {
		mockEventStore.eventsList = [];
		mockEventStore.loadEventsList.mockResolvedValue(undefined);
	});

	it('offers to create the first Event when there are none', async () => {
		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('No events yet');
		expect(wrapper.get('[data-testid="empty-state"]').text()).toContain('Create Event');
	});

	it('shows a failed load as an error, not as no Events, and still offers to create one', async () => {
		mockEventStore.loadEventsList.mockRejectedValueOnce(new Error('Network unavailable'));

		const wrapper = await mountPage();
		await flushPromises();

		expect(wrapper.get('[data-testid="event-list"]').text()).toBe('error:Network unavailable');
		expect(wrapper.find('[data-testid="empty-state"]').exists()).toBe(false);
		expect(wrapper.get('[data-testid="actions"]').text()).toContain('Create Event');
	});
});
