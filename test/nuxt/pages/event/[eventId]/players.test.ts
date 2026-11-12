import type { PropType } from 'vue';
import type { Deferred } from '~~/test/helpers/deferred';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import { deferred } from '~~/test/helpers/deferred';

interface StandingsAnswer {
	standings: Array<{ playerId: number; wins: number; losses: number; draws: number; position: number; points: number }>;
}

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

vi.mock('~/modules/event-data/resync', async importOriginal => ({
	...await importOriginal<typeof import('~/modules/event-data/resync')>(),
	useConsumedEventData: () => {},
}));

const eventStore = reactive({
	eventId: 1,
	event: { id: 1, game: 'mtg', meleeEnabled: false },
});
const playerStore = reactive({
	isLoaded: true,
	loading: false,
	players: [
		{
			id: 41,
			name: 'Alice',
			wins: 9,
			losses: 0,
			draws: 0,
			position: 1,
			points: 27,
		},
	],
});
const rounds = [
	{
		id: 3,
		phaseId: 1,
		name: 'Round 3',
		roundNumber: 3,
	},
	{
		id: 4,
		phaseId: 1,
		name: 'Round 4',
		roundNumber: 4,
	},
];
const roundStore = reactive({
	isLoaded: true,
	rounds,
	getRoundById: (id: number) => rounds.find(round => round.id === id),
	loadRoundsByEventId: vi.fn(),
});

mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('usePlayerStore', () => () => playerStore);
mockNuxtImport('useRoundStore', () => () => roundStore);
mockNuxtImport('usePhaseStore', () => () => ({
	isLoaded: true,
	getPhaseById: () => undefined,
}));
mockNuxtImport('usePlayerListStore', () => () => ({
	isLoaded: true,
	lists: [],
	getCachedMemberIds: () => undefined,
}));
const meleeStore = reactive({
	syncingRound: false,
	lastOperation: null as { status: string; title: string; description: string } | null,
	syncSpecificRound: vi.fn(),
});
const toast = {
	add: vi.fn(),
};
mockNuxtImport('useMeleeStore', () => () => meleeStore);
mockNuxtImport('useScreenStore', () => () => ({ isLoaded: true, currentEventId: 1, screens: [] }));
mockNuxtImport('useOverlay', () => () => ({
	create: vi.fn(),
}));
mockNuxtImport('useToast', () => () => toast);
mockNuxtImport('usePlayerDeckListModal', () => () => ({
	openPlayerDeckList: vi.fn(),
}));
mockNuxtImport('usePlayerEditModal', () => () => ({
	openPlayerEdit: vi.fn(),
}));
mockNuxtImport('usePlayerMatchHistoryLink', () => () => {});
mockNuxtImport('useSendDeckToScreen', () => () => ({
	sendToFirstDeckScreen: vi.fn(),
	sendToScreen: vi.fn(),
}));
mockNuxtImport('useSendPlayerHistoryToScreen', () => () => ({
	sendToFirstPlayerHistoryScreen: vi.fn(),
	sendToScreen: vi.fn(),
}));
mockNuxtImport('useEventPageLoading', () => () => ({
	eventId: ref(1),
	initialLoading: ref(false),
	initialError: ref(null),
	retry: vi.fn(),
}));

const CollectionPageStub = defineComponent({
	template: '<div><slot name="toolbar" /><slot /></div>',
});

const ToolbarStub = defineComponent({
	template: '<div><slot name="left" /><slot name="right" /></div>',
});

/** The Round picker as one button per option. */
const RoundSelectStub = defineComponent({
	props: {
		items: {
			type: Array as PropType<Array<{ label: string; value: number | undefined }>>,
			default: () => [],
		},
	},
	emits: ['update:modelValue'],
	template: `<div>
		<button
			v-for="item in items"
			:key="item.label"
			type="button"
			:data-round="item.value ?? 'current'"
			@click="$emit('update:modelValue', item.value)"
		/>
	</div>`,
});

/** The table, as each Player's record: what the Round picker changes. */
const PlayerListStub = defineComponent({
	props: {
		players: {
			type: Array as PropType<Array<{ id: number; wins: number | null; losses: number | null }>>,
			default: () => [],
		},
	},
	setup: () => ({ selectedPlayerIds: [] }),
	template: '<ul><li v-for="player in players" :key="player.id" :data-player-record="player.id">{{ player.wins }}-{{ player.losses }}</li></ul>',
});

async function mountPage(stubs: Record<string, unknown> = {}) {
	const pagePath = '../../../../../app/pages/event/[eventId]/players.vue';
	const { default: PlayersPage } = await import(pagePath);
	return mount(PlayersPage, {
		global: {
			stubs: {
				UICollectionPage: CollectionPageStub,
				UDashboardToolbar: ToolbarStub,
				USelectMenu: RoundSelectStub,
				PlayerList: PlayerListStub,
				PlayerListTabs: true,
				UISearchInput: true,
				UIInitialLoadError: true,
				UAlert: true,
				UButton: true,
				...stubs,
			},
		},
	});
}

function standingsFor(wins: number): StandingsAnswer {
	return {
		standings: [
			{
				playerId: 41,
				wins,
				losses: 0,
				draws: 0,
				position: 1,
				points: wins * 3,
			},
		],
	};
}

describe('players page — Round Standings', () => {
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;
	let reads: Map<string, Deferred<StandingsAnswer>>;

	beforeEach(() => {
		reads = new Map();
		mockFetch.mockReset();
		mockFetch.mockImplementation((path: string) => {
			const read = deferred<StandingsAnswer>();
			reads.set(path, read);
			return read.promise;
		});
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = null;
	});

	// Only the Round picked last may fill the table, whichever read answers last.
	it.each([
		{
			answered: 'in the order picked',
			order: [3, 4],
		},
		{
			answered: 'out of order',
			order: [4, 3],
		},
	])('shows the Round picked last when the reads answer $answered', async ({ order }) => {
		wrapper = await mountPage();

		await wrapper.get('[data-round="3"]').trigger('click');
		await wrapper.get('[data-round="4"]').trigger('click');
		for (const roundId of order) {
			reads.get(`/api/events/1/standings?roundId=${roundId}`)!.resolve(standingsFor(roundId));
			await flushPromises();
		}

		expect(wrapper.get('[data-player-record="41"]').text()).toBe('4-0');
	});

	// Back to "Current" is a pick too: a Round's late answer must not be kept for the next Round.
	it('shows current records once "Current" is picked over a Round still being read', async () => {
		wrapper = await mountPage();

		await wrapper.get('[data-round="3"]').trigger('click');
		await wrapper.get('[data-round="current"]').trigger('click');
		reads.get('/api/events/1/standings?roundId=3')!.resolve(standingsFor(3));
		await flushPromises();
		await wrapper.get('[data-round="4"]').trigger('click');

		expect(wrapper.get('[data-player-record="41"]').text()).toBe('9-0');
	});
});

// The Players page starts a Round sync from the alert over a Round with no standings.
describe('players page — Round sync', () => {
	let wrapper: Awaited<ReturnType<typeof mountPage>> | null = null;

	beforeEach(() => {
		eventStore.event.meleeEnabled = true;
		Object.assign(rounds[0]!, { externalSource: 'melee' });
		mockFetch.mockReset().mockResolvedValue({ standings: [] });
		toast.add.mockClear();
		meleeStore.lastOperation = null;
	});

	afterEach(() => {
		wrapper?.unmount();
		wrapper = null;
		eventStore.event.meleeEnabled = false;
	});

	it('tells the operator what the Melee store recorded of the sync, as the Sync page does', async () => {
		meleeStore.syncSpecificRound.mockImplementation(async () => {
			meleeStore.lastOperation = {
				status: 'warning',
				title: 'Round Synced — Reload Needed',
				description: 'Round 3 synced successfully. Reload the page before retrying the sync.',
			};
			return { success: true };
		});
		wrapper = await mountPage({
			UAlert: defineComponent({ template: '<div><slot name="actions" /></div>' }),
			UButton: defineComponent({ template: '<button type="button"><slot /></button>' }),
		});
		await wrapper.get('[data-round="3"]').trigger('click');
		await flushPromises();

		await wrapper.findAll('button').find(button => button.text() === 'Sync Round')!.trigger('click');
		await flushPromises();

		expect(meleeStore.syncSpecificRound).toHaveBeenCalledWith(3);
		expect(toast.add.mock.calls).toEqual([
			[
				{
					title: 'Round Synced — Reload Needed',
					description: 'Round 3 synced successfully. Reload the page before retrying the sync.',
					color: 'warning',
				},
			],
		]);
	});
});
