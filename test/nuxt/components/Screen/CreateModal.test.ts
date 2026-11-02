import type { Game } from '~~/shared/types/enums';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { nuxtUiStubs } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ScreenCreateModal from '~/components/Screen/CreateModal.vue';

const mockEventStore = reactive({
	event: { id: 1, game: 'op' as Game },
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
	it('offers an OP Event the modes it supports, and none of the MTG-only ones', () => {
		const wrapper = mount(ScreenCreateModal, {
			props: { eventId: 1 },
			attrs: { open: true },
			global: {
				stubs: { ...nuxtUiStubs, ScreenTypeBadge: true },
			},
		});

		const options = wrapper.get('select').findAll('option').map(option => option.text());
		expect(options).toContain('Feature Match Overlay');
		expect(options).not.toContain('Standings');
	});
});
