import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ScreenCreateModal from '~/components/Screen/CreateModal.vue';

const mockEventStore = reactive({
	event: { id: 1, game: 'mtg' as 'mtg' | 'op' },
});

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenStore', () => () => ({
	createScreen: vi.fn(),
	updateScreen: vi.fn(),
}));
mockNuxtImport('useToast', () => () => ({
	add: vi.fn(),
}));

describe('screenCreateModal', () => {
	// The picker offers what its Event's Card Game supports; the rule itself is the Screen Mode Definition's.
	it.each([
		['mtg', 'Standings', true],
		['op', 'Standings', false],
		['op', 'Feature Match Overlay', true],
	] as const)('on a %s Event, offers %s: %s', (game, label, offered) => {
		mockEventStore.event.game = game;

		const wrapper = mount(ScreenCreateModal, {
			props: { eventId: 1 },
			attrs: { open: true },
			global: {
				stubs: { ...nuxtUiStubs, ScreenTypeBadge: true },
			},
		});

		const options = wrapper.get('select').findAll('option').map(option => option.text());
		expect(options.includes(label)).toBe(offered);
	});
});
