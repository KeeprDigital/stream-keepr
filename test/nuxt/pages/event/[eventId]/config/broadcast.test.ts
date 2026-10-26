import type { Event } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { createMockEvent } from '~~/test/helpers/fixtures';

const configuredEvent = createMockEvent({
	id: 15,
	name: 'MTG Broadcast',
	game: 'mtg',
	broadcastDeckListsEnabled: false,
}) as unknown as Event;

const eventStore = reactive({
	event: configuredEvent as Event | null,
	loading: false,
	removeTalent: vi.fn(),
	addTalent: vi.fn(),
	updateTalent: vi.fn(),
});
const handleSubmit = vi.fn();

mockNuxtImport('useEventStore', () => () => eventStore);
const resetTalentsForm = vi.fn();

// Runs the request the way the real one does, minus the toasts: a throw is
// reported, never rethrown.
mockNuxtImport('useRequestFeedback', () => () => ({
	runRequest: async (request: () => Promise<unknown>) => {
		try {
			return await request();
		}
		catch {
			return undefined;
		}
	},
}));
mockNuxtImport('useEventConfigSubmit', () => () => ({ handleSubmit }));

const BroadcastSettingsStub = defineComponent({
	props: {
		event: { type: Object, required: true },
		loading: { type: Boolean, required: false },
	},
	template: '<div data-testid="broadcast-settings">Broadcast settings</div>',
});
const BroadcastDeckListLibraryStub = defineComponent({
	props: {
		event: { type: Object, required: true },
	},
	template: '<div data-testid="deck-list-library">{{ event.name }}</div>',
});
const TalentsStub = defineComponent({
	props: {
		talents: { type: Array, required: false },
		loading: { type: Boolean, required: false },
	},
	emits: ['submit'],
	setup(_, { expose }) {
		expose({ resetForm: resetTalentsForm });
	},
	template: '<div data-testid="talents">Talents</div>',
});

const stubs = {
	EventConfigBroadcastSettings: BroadcastSettingsStub,
	EventBroadcastDeckListLibrary: BroadcastDeckListLibraryStub,
	EventConfigTalents: TalentsStub,
};

describe('event Broadcast settings page', () => {
	it('hosts the Event-scoped Broadcast Deck List library beside existing settings', async () => {
		const { default: Page } = await import('../../../../../../app/pages/event/[eventId]/config/broadcast.vue');
		const wrapper = mount(Page, {
			global: { stubs },
		});

		expect(wrapper.find('[data-testid="broadcast-settings"]').exists()).toBe(true);
		expect(wrapper.get('[data-testid="deck-list-library"]').text()).toBe('MTG Broadcast');
		expect(wrapper.find('[data-testid="talents"]').exists()).toBe(true);
	});

	// #612: the card merges each landed Talent into its staged list, beside the
	// row with no id that asked for it. Left staged after a failure, a retry
	// would add that Talent again, so the card resets to the event either way.
	it('resets the Talents card to the event after a save fails part-way', async () => {
		eventStore.addTalent.mockResolvedValue(null);
		const { default: Page } = await import('../../../../../../app/pages/event/[eventId]/config/broadcast.vue');
		const wrapper = mount(Page, {
			global: { stubs },
		});

		wrapper.getComponent(TalentsStub).vm.$emit('submit', [
			{ name: 'Dana', socialProfiles: {} },
		]);
		await flushPromises();

		expect(eventStore.addTalent).toHaveBeenCalledOnce();
		expect(resetTalentsForm).toHaveBeenCalledOnce();
	});
});
