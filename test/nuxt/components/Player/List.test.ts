import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, ref } from 'vue';
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

const playerHistoryScreens = ref<{ id: number; name: string }[]>([]);
mockNuxtImport('useSendPlayerHistoryToScreen', () => () => ({
	hasPlayerHistoryScreens: computed(() => playerHistoryScreens.value.length > 0),
	playerHistoryScreens,
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
		playerHistoryScreens.value = [];
	});

	async function openMenu(wrapper: ReturnType<typeof mountRows>) {
		await wrapper.get('[aria-label="Player actions"]').trigger('click');
		return wrapper.get('[role="menu"]');
	}

	async function choose(wrapper: ReturnType<typeof mountRows>, ...path: string[]) {
		for (const label of path)
			await wrapper.findAll('[role="menuitem"]').find(item => item.text() === label)!.trigger('click');
	}

	function mountRows(props: Record<string, unknown> = {}) {
		return mount(PlayerList, {
			props: {
				players: [alice as never],
				...props,
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

		const menu = await openMenu(wrapper);
		expect(menu.findAll('[role="menuitem"]')[0]!.text()).toBe('Edit Player');
		await choose(wrapper, 'Edit Player');

		expect(wrapper.emitted('editPlayer')).toEqual([
			[alice],
		]);
	});

	it.each([
		[
			'adds the Player to a list from the Add to List submenu',
			{
				lists: [
					{ id: 3, name: 'Top 8' },
				],
			},
			[],
			['Add to List', 'Top 8'],
			[
				'addToList',
				[
					3,
					[7],
				],
			],
		],
		[
			'sends their history to the one Player History Screen directly',
			{},
			[
				{ id: 4, name: 'Desk' },
			],
			['Send Match History to Screen'],
			[
				'sendMatchHistoryToScreen',
				[7],
			],
		],
		[
			'sends their history to a chosen Screen once several could take it',
			{},
			[
				{ id: 4, name: 'Desk' },
				{ id: 5, name: 'Stage' },
			],
			['Send Match History to…', 'Stage'],
			[
				'sendMatchHistoryToScreen',
				[7, 5],
			],
		],
	])('%s', async (_, props, screens, path, [event, args]) => {
		playerHistoryScreens.value = screens;
		const wrapper = mountRows(props);

		await openMenu(wrapper);
		await choose(wrapper, ...path as string[]);

		expect(wrapper.emitted(event as string)).toEqual([args]);
	});
});
