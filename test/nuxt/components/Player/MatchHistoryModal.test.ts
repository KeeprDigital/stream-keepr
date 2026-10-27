import type { PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, defineComponent, reactive, ref } from 'vue';
import { createMockEvent, createMockPlayer, createMockPlayerList } from '~~/test/helpers/fixtures';
import { nuxtUiStubs, UTableStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import MatchHistoryModal from '~/components/Player/MatchHistoryModal.vue';

const { openPlayerMatchHistory, openPlayerEdit, openPlayerDeckList, sendHeadToHead } = vi.hoisted(() => ({
	sendHeadToHead: vi.fn(),
	openPlayerMatchHistory: vi.fn(),
	openPlayerEdit: vi.fn(),
	openPlayerDeckList: vi.fn(),
}));

const alice = createMockPlayer({
	id: 7,
	name: 'Alice',
	pronouns: 'she/her',
	lgs: 'Card Kingdom',
	wins: 3,
	losses: 1,
	draws: 0,
	gameData: { type: 'mtg', deckName: 'Azorius Control' },
});
const bob = createMockPlayer({ id: 8, name: 'Bob' });
const eventStore = reactive({
	eventId: 1,
	event: createMockEvent(),
	displayEvent: createMockEvent(),
});
const playerListStore = reactive({
	isLoaded: true,
	lists: [
		createMockPlayerList({ id: 3, name: 'Top 8' }),
	],
	members: { 3: [] as number[] } as Record<number, number[]>,
	getCachedMemberIds(listId: number) {
		return this.members[listId];
	},
	loadByEventId: vi.fn(),
	addMembers: vi.fn(),
	batchRemoveMembers: vi.fn(),
});

mockNuxtImport('usePlayerStore', () => () => reactive({
	players: [alice, bob],
}));
mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('usePlayerListStore', () => () => playerListStore);
mockNuxtImport('usePlayerDeckListModal', () => () => ({ openPlayerDeckList }));
mockNuxtImport('usePlayerEditModal', () => () => ({ openPlayerEdit }));
mockNuxtImport('usePlayerMatchHistoryModal', () => () => ({ openPlayerMatchHistory }));
const read = {
	playerId: null as number | null,
	history: ref<PlayerMatchHistoryEntry[]>([]),
	loading: ref(false),
	error: ref<string | null>(null),
};
mockNuxtImport('usePlayerMatchHistory', () => (playerId: () => number | null) => {
	read.playerId = playerId();
	return {
		player: ref(null),
		history: read.history,
		loading: read.loading,
		error: read.error,
	};
});
const headToHeadScreens = ref([
	{ id: 5, name: 'H2H' },
]);
mockNuxtImport('useSendHeadToHeadToScreen', () => () => ({
	headToHeadScreens,
	hasHeadToHeadScreens: computed(() => headToHeadScreens.value.length > 0),
	sendToScreen: sendHeadToHead,
}));
mockNuxtImport('useSendPlayerHistoryToScreen', () => () => ({
	hasPlayerHistoryScreens: ref(false),
	playerHistoryScreens: ref([]),
}));

const UModalStub = defineComponent({
	template: '<div><slot name="title" /><slot name="description" /><slot name="body" /><slot name="footer" /></div>',
});

function entry(opponentId: number | null, opponentName: string) {
	return {
		roundNumber: 1,
		roundName: 'Round 1',
		phaseName: 'Swiss',
		opponentId,
		opponentName,
		outcome: 'win',
	} as PlayerMatchHistoryEntry;
}

function mountModal({ history = [
	entry(8, 'Bob'),
], ...props }: { history?: PlayerMatchHistoryEntry[] } & Record<string, unknown> = {}) {
	read.history.value = history;
	return mount(MatchHistoryModal, {
		props: {
			player: alice as never,
			...props,
		},
		global: {
			stubs: {
				...nuxtUiStubs,
				UModal: UModalStub,
				UTable: UTableStub,
				MtgManaColorDisplay: true,
			},
		},
	});
}

function button(wrapper: ReturnType<typeof mountModal>, text: string) {
	return wrapper.findAll('button').find(b => b.text() === text);
}

describe('player match history modal', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		eventStore.event = createMockEvent();
		eventStore.displayEvent = createMockEvent();
		playerListStore.members[3] = [];
		headToHeadScreens.value = [
			{ id: 5, name: 'H2H' },
		];
		read.loading.value = false;
		read.error.value = null;
	});

	it.each([
		[
			'the history it read for the Player',
			false,
			null,
			'Bob',
		],
		['that it is reading', true, null, null],
		[
			'a failed read with nothing to show',
			false,
			'Failed to load match history',
			'Failed to load match history',
		],
	])('shows %s', (_, loading, error, text) => {
		read.loading.value = loading;
		read.error.value = error;

		const wrapper = mountModal({
			history: error
				? []
				: [
						entry(8, 'Bob'),
					],
		});

		expect(read.playerId).toBe(7);
		expect(wrapper.find('[data-column="opponentName"]').exists()).toBe(!loading && !error);
		if (text)
			expect(wrapper.text()).toContain(text);
	});

	it.each([
		[
			'a roster opponent',
			entry(8, 'Bob'),
			true,
		],
		[
			'an opponent off the roster',
			entry(null, 'Walk-in'),
			false,
		],
	])('names %s, opening their history only when they are a Player', async (_, row, clickable) => {
		const wrapper = mountModal({
			history: [row],
		});

		const opponent = wrapper.get('[data-column="opponentName"]');
		expect(opponent.text()).toBe(row.opponentName);
		expect(opponent.find('button').exists()).toBe(clickable);
		if (clickable) {
			await opponent.get('button').trigger('click');
			expect(openPlayerMatchHistory).toHaveBeenCalledWith(bob);
		}
	});

	it.each([
		['the Event\'s defaults', {}, '3-1'],
		[
			'a separator and shown zero draws',
			{ displayRecordSeparator: '/', displayHideZeroDraws: false },
			'3/1/0',
		],
	] as const)('shows the record with %s', (_, settings, record) => {
		eventStore.displayEvent = createMockEvent(settings);

		expect(mountModal().get('[data-testid="player-record"]').text()).toBe(record);
	});

	it.each([
		[
			'pronouns and LGS',
			{ pronounsEnabled: true, lgsEnabled: true },
			'she/her · Card Kingdom',
		],
		[
			'pronouns alone while LGS is off',
			{ pronounsEnabled: true, lgsEnabled: false },
			'she/her',
		],
		[
			'neither while both are off',
			{ pronounsEnabled: false, lgsEnabled: false },
			null,
		],
	] as const)('names the Player\'s %s', (_, settings, identity) => {
		eventStore.event = createMockEvent(settings);

		const shown = mountModal().find('[data-testid="player-identity"]');
		expect(shown.exists()
			? shown.text()
			: null).toBe(identity);
	});

	it('leads back to the Player it showed before, and offers no way back without one', async () => {
		expect(mountModal().find('[aria-label^="Back to"]').exists()).toBe(false);

		const wrapper = mountModal({ previousPlayer: bob });
		await wrapper.get('[aria-label="Back to Bob"]').trigger('click');

		expect(wrapper.emitted('back')).toHaveLength(1);
	});

	it.each([
		[
			'Edit Player',
			() => openPlayerEdit,
		],
		[
			'Deck List',
			() => openPlayerDeckList,
		],
	])('opens %s for the Player shown', async (label, opener) => {
		await button(mountModal(), label)!.trigger('click');

		expect(opener()).toHaveBeenCalledWith(alice);
	});

	it.each([
		['adds the Player to a list they are not in', [], 'addMembers'],
		[
			'removes the Player from a list they are in',
			[7],
			'batchRemoveMembers',
		],
	] as const)('%s', async (_, members, write) => {
		playerListStore.members[3] = [...members];
		const wrapper = mountModal();

		await button(wrapper, 'Lists')!.trigger('click');
		const item = wrapper.get('[role="menuitemcheckbox"]');
		expect(item.text()).toBe('Top 8');
		await item.trigger('click');

		expect(playerListStore[write]).toHaveBeenCalledWith(1, 3, [7]);
	});

	it.each([
		[
			'a roster opponent, with the Player shown on the left',
			entry(8, 'Bob'),
			[
				{ id: 5, name: 'H2H' },
			],
			true,
		],
		[
			'no opponent off the roster',
			entry(null, 'Walk-in'),
			[
				{ id: 5, name: 'H2H' },
			],
			false,
		],
		[
			'nothing while no Screen is in Head-to-Head mode',
			entry(8, 'Bob'),
			[],
			false,
		],
	])('sends a Head-to-Head with %s', async (_, row, screens, offered) => {
		headToHeadScreens.value = screens;
		const wrapper = mountModal({
			history: [row],
		});

		const action = wrapper.find('[aria-label^="Send Head-to-Head with"]');
		expect(action.exists()).toBe(offered);
		if (offered) {
			await action.trigger('click');
			await wrapper.get('[role="menuitem"]').trigger('click');
			expect(sendHeadToHead).toHaveBeenCalledWith(7, 8, screens[0]);
		}
	});
});
