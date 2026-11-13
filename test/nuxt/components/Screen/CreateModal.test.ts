import type { Game, Variant } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ScreenCreateModal from '~/components/Screen/CreateModal.vue';

const mockEventStore = reactive({
	event: { id: 1, game: 'op' as Game, variant: null as Variant | null },
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
	// The picker offers what its Event is offered, by Card Game and by Variant; the rule itself is the Screen Mode Definition's.
	it.each([
		['op', null, 'Standings'],
		['mtg', 'commander', 'Metagame'],
	] as const)('offers a %s Event of Variant %s the modes it supports, without %s', (game, variant, withheld) => {
		Object.assign(mockEventStore.event, { game, variant });
		const wrapper = mount(ScreenCreateModal, {
			props: { eventId: 1 },
			attrs: { open: true },
			global: {
				stubs: { ...nuxtUiStubs, ScreenTypeBadge: true },
			},
		});

		const options = wrapper.get('select').findAll('option').map(option => option.text());
		expect(options).toContain('Feature Match Overlay');
		expect(options).not.toContain(withheld);
	});
});
