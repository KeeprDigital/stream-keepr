import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { createMockPlayer } from '~~/test/helpers/fixtures';
import { nuxtUiStubs, UTableStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import PlayerList from '~/components/Player/List.vue';

const { openPlayerMatchHistory } = vi.hoisted(() => ({
	openPlayerMatchHistory: vi.fn(),
}));
mockNuxtImport('usePlayerMatchHistoryModal', () => () => ({ openPlayerMatchHistory }));

mockNuxtImport('usePlayerDeckCache', () => () => ({
	getDeckLists: vi.fn(() => []),
	getActiveDeckForPlayer: vi.fn(() => null),
}));

mockNuxtImport('useSendDeckToScreen', () => () => ({
	hasDeckScreens: ref(false),
	deckScreens: ref([]),
}));

mockNuxtImport('useSendPlayerHistoryToScreen', () => () => ({
	hasPlayerHistoryScreens: ref(false),
	playerHistoryScreens: ref([]),
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

describe('playerList rows', () => {
	const alice = createMockPlayer({ id: 7, name: 'Alice' });

	beforeEach(() => {
		openPlayerMatchHistory.mockReset();
	});

	function mountRows() {
		return mount(PlayerList, {
			props: {
				players: [alice as never],
			},
			global: {
				stubs: { ...nuxtUiStubs, UTable: UTableStub, MtgManaColorDisplay: true },
			},
		});
	}

	it('opens the Player\'s match history from their name, and nothing from the rest of the row', async () => {
		const wrapper = mountRows();

		await wrapper.get('[data-column="points"]').trigger('click');
		expect(openPlayerMatchHistory).not.toHaveBeenCalled();
		expect(wrapper.emitted('editPlayer')).toBeUndefined();

		await wrapper.get('[data-column="name"] button').trigger('click');
		expect(openPlayerMatchHistory).toHaveBeenCalledWith(alice);
	});

	it('shows the record as the Event displays records', () => {
		const wrapper = mount(PlayerList, {
			props: {
				players: [
					{
						...alice,
						wins: 3,
						losses: 1,
						draws: 0,
					} as never,
				],
			},
			global: {
				stubs: { ...nuxtUiStubs, UTable: UTableStub, MtgManaColorDisplay: true },
			},
		});

		expect(wrapper.get('[data-column="record"]').text()).toBe('3-1');
	});

	it('edits the Player from the first action in the row menu', async () => {
		const wrapper = mountRows();

		await wrapper.get('[aria-label="Player actions"]').trigger('click');
		const [first] = wrapper.get('[data-column="actions"]').findAll('button').filter(button => button.attributes('aria-label') !== 'Player actions');
		expect(first!.text()).toBe('Edit Player');
		await first!.trigger('click');

		expect(wrapper.emitted('editPlayer')).toEqual([
			[alice],
		]);
	});
});
