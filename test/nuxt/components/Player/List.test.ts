import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

mockNuxtImport('usePlayerDeckCache', () => () => ({
	getDeckLists: vi.fn(() => []),
	getActiveDeckForPlayer: vi.fn(() => null),
}));

mockNuxtImport('useSendDeckToScreen', () => () => ({
	hasDeckScreens: ref(false),
	deckScreens: ref([]),
}));

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
	template: '<div>{{ title }}|{{ description }}</div>',
});

async function mountComponent(activeListId: number | null) {
	const componentPath = '../../../../app/components/Player/List.vue';
	const { default: PlayerList } = await import(componentPath);

	return mount(PlayerList, {
		props: {
			players: [],
			activeListId,
		},
		global: {
			stubs: {
				UIEmptyState: UIEmptyStateStub,
				UTable: true,
			},
		},
	});
}

describe('playerList', () => {
	it('shows list-specific empty copy without a create-player prompt', async () => {
		const wrapper = await mountComponent(42);

		expect(wrapper.text()).toContain('No players in this list');
		expect(wrapper.text()).toContain('Add players to this list to see them here.');
	});
});
