import type { Event } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
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
mockNuxtImport('useRequestFeedback', () => () => ({ runRequest: vi.fn() }));
mockNuxtImport('useEventConfigSubmit', () => () => ({ handleSubmit }));

const BroadcastSettingsStub = defineComponent({
	props: { event: { type: Object, required: true }, loading: { type: Boolean, required: false } },
	template: '<div data-testid="broadcast-settings">Broadcast settings</div>',
});
const BroadcastDeckListLibraryStub = defineComponent({
	props: { event: { type: Object, required: true } },
	template: '<div data-testid="deck-list-library">{{ event.name }}</div>',
});
const TalentsStub = defineComponent({
	props: { talents: { type: Array, required: false }, loading: { type: Boolean, required: false } },
	template: '<div data-testid="talents">Talents</div>',
});

describe('event Broadcast settings page', () => {
	it('hosts the Event-scoped Broadcast Deck List library beside existing settings', async () => {
		const { default: Page } = await import('../../../../../../app/pages/event/[eventId]/config/broadcast.vue');
		const wrapper = mount(Page, {
			global: {
				stubs: {
					EventConfigBroadcastSettings: BroadcastSettingsStub,
					EventBroadcastDeckListLibrary: BroadcastDeckListLibraryStub,
					EventConfigTalents: TalentsStub,
				},
			},
		});

		expect(wrapper.find('[data-testid="broadcast-settings"]').exists()).toBe(true);
		expect(wrapper.get('[data-testid="deck-list-library"]').text()).toBe('MTG Broadcast');
		expect(wrapper.find('[data-testid="talents"]').exists()).toBe(true);
	});
});
