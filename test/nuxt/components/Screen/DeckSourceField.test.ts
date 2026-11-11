import type { DeckSource } from '~~/shared/screenModeConfigs/deck';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive, ref } from 'vue';
import { opSlotSide } from '~~/test/helpers/opCards';
import { UInputMenuStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import DeckSourceField from '~/components/Screen/DeckSourceField.vue';

// The Deck Source picker (ADR-0032): a tab per source its Event's Card Game offers,
// opening a tab changes nothing, picking emits the whole Deck Source, and a source
// the Screen would show nothing for says so.

enableAutoUnmount(afterEach);

const MTG_PLAYERS = [
	{
		id: 1,
		name: 'Alice',
		gameData: { type: 'mtg', deckName: 'Mono Blue', deckColors: 'U' },
	},
];
/** One Piece Players: one imported, known by Nickname and member number, with a Deck List; one hand-added with none. */
const OP_PLAYERS = [
	{
		id: 5,
		name: '',
		nickname: 'zoro_main',
		externalSource: 'tcgplus',
		externalId: '0001234',
		gameData: {
			type: 'op',
			deckList: { id: 601, mainboardCount: 50, leaderNumber: 'OP01-001' },
		},
	},
	{
		id: 6,
		name: 'Bea',
		nickname: null,
		gameData: { type: 'op' },
	},
];

const mockPlayerStore = {
	isLoaded: true,
	players: MTG_PLAYERS as Array<Record<string, unknown>>,
	loadPlayersByEventId: vi.fn().mockResolvedValue(undefined),
};
const mockEventStore = reactive({
	event: {
		id: 1,
		game: 'mtg',
		broadcastDeckListsEnabled: true,
	},
});
const mockBroadcastDeckListStore = reactive({
	summaries: [
		{
			id: 23,
			name: 'Feature Table',
			mainboardQuantity: 60,
			sideboardQuantity: 15,
		},
	],
	loadCollection: vi.fn(),
});

/** An OP Slot whose first player has a Deck List and whose second has none. */
const ALICE = opSlotSide('Alice', null, 501);
const BOB = opSlotSide('Bob', null, null);
const mockFeatureMatchStore = reactive({
	isLoaded: true,
	featureMatches: <Array<{ id: number; player1Id: null; player2Id: null; player1Data: unknown; player2Data: unknown; activeSession: null }>>[],
	loadFeatureMatchesByEventId: vi.fn(),
});
const mockFeatureMatchStateStore = reactive({
	featureMatchSessions: new Map<number, unknown>(),
	sessionIdBySlotId: new Map<number, number>(),
});

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);
mockNuxtImport('useFeatureMatchStateStore', () => () => mockFeatureMatchStateStore);
mockNuxtImport('useFeatureMatchMenuItems', () => () => ref([
	{ label: 'Alice vs Bob', value: 11 },
]));
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useBroadcastDeckListStore', () => () => mockBroadcastDeckListStore);

const UFormFieldStub = defineComponent({
	props: {
		label: { type: String, required: false },
	},
	template: '<div data-testid="form-field" :data-label="label"><span>{{ label }}</span><slot /></div>',
});

const USelectStub = defineComponent({
	props: {
		modelValue: {
			type: [String, Number, Boolean, Object],
			required: false,
		},
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="u-select"><button v-for="item in (items || [])" :key="String(item.value)" type="button" :data-value="String(item.value)" @click="$emit(\'update:modelValue\', item.value)">{{ item.label }}</button></div>',
});

const UTabsStub = defineComponent({
	props: {
		modelValue: { type: String, required: false },
		items: { type: Array, required: false },
	},
	emits: ['update:modelValue'],
	template: '<div data-testid="source-tabs"><button v-for="item in (items || [])" :key="item.value" type="button" :data-value="item.value" @click="$emit(\'update:modelValue\', item.value)">{{ item.label }}</button></div>',
});

async function mountField(modelValue: DeckSource) {
	const wrapper = mount(DeckSourceField, {
		props: { modelValue, eventId: 1 },
		global: {
			stubs: {
				UFormField: UFormFieldStub,
				USelect: USelectStub,
				UTabs: UTabsStub,
				UInputMenu: UInputMenuStub,
				UIcon: true,
			},
		},
	});
	await flushPromises();
	return wrapper;
}

const emitted = (wrapper: Awaited<ReturnType<typeof mountField>>) => wrapper.emitted('update:modelValue')?.map(([deckSource]) => deckSource) ?? [];

describe('the Deck Source picker on a Magic: The Gathering Event', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventStore.event = { id: 1, game: 'mtg', broadcastDeckListsEnabled: true };
		mockPlayerStore.players = MTG_PLAYERS;
		mockBroadcastDeckListStore.summaries = [
			{
				id: 23,
				name: 'Feature Table',
				mainboardQuantity: 60,
				sideboardQuantity: 15,
			},
		];
	});

	it.each([
		{ enabled: true, tabs: ['Player Deck', 'Broadcast Deck List'] },
		{ enabled: false, tabs: [] },
	])('offers a tab per source while Broadcast Deck Lists are enabled: $enabled', async ({ enabled, tabs }) => {
		mockEventStore.event.broadcastDeckListsEnabled = enabled;
		const wrapper = await mountField({ type: 'player', playerId: 1 });

		expect(wrapper.findAll('[data-testid="source-tabs"] button').map(tab => tab.text())).toEqual(tabs);
	});

	it('changes nothing on opening a tab, and emits the Broadcast Deck List picked there', async () => {
		const wrapper = await mountField({ type: 'player', playerId: 1 });

		await wrapper.get('[data-testid="source-tabs"] [data-value="broadcast"]').trigger('click');
		expect(emitted(wrapper)).toEqual([]);

		await wrapper.get('[data-testid="form-field"][data-label="Broadcast Deck List"] [data-value="23"]').trigger('click');
		expect(emitted(wrapper)).toEqual([
			{ type: 'broadcast', broadcastDeckListId: 23 },
		]);
	});

	it('says so, and changes nothing, when the Event has no Broadcast Deck List', async () => {
		mockBroadcastDeckListStore.summaries = [];
		const wrapper = await mountField({ type: 'player', playerId: 1 });

		await wrapper.get('[data-testid="source-tabs"] [data-value="broadcast"]').trigger('click');

		expect(wrapper.text()).toContain('No Broadcast Deck Lists are available');
		expect(emitted(wrapper)).toEqual([]);
	});
});

describe('the Deck Source picker on a One Piece Card Game Event', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEventStore.event = { id: 1, game: 'op', broadcastDeckListsEnabled: false };
		mockPlayerStore.players = OP_PLAYERS;
		mockFeatureMatchStore.featureMatches = [
			{
				id: 11,
				player1Id: null,
				player2Id: null,
				player1Data: ALICE,
				player2Data: BOB,
				activeSession: null,
			},
		];
		mockFeatureMatchStateStore.featureMatchSessions = new Map();
		mockFeatureMatchStateStore.sessionIdBySlotId = new Map();
	});

	it('picks a Feature Match Slot, then its side', async () => {
		const wrapper = await mountField({ type: 'player', playerId: null });

		await wrapper.get('[data-testid="deck-source-slot"] [data-value="11"]').trigger('click');
		await wrapper.setProps({ modelValue: emitted(wrapper)[0] as DeckSource });
		await wrapper.get('[data-testid="deck-source-side"] [data-value="player2"]').trigger('click');

		expect(emitted(wrapper)).toEqual([
			{ type: 'featureMatchSlot', slotId: 11, side: 'player1' },
			{ type: 'featureMatchSlot', slotId: 11, side: 'player2' },
		]);
	});

	it.each([
		{ by: 'Nickname', search: 'zoro' },
		{ by: 'Bandai member number', search: '0001234' },
	])('picks a Player, found by $by', async ({ search }) => {
		const wrapper = await mountField({ type: 'player', playerId: null });

		await wrapper.get('[data-testid="source-tabs"] [data-value="player"]').trigger('click');
		await wrapper.get('[data-testid="deck-source-player"] [role="combobox"]').setValue(search);
		const options = wrapper.findAll('[role="option"]');
		expect(options.map(option => option.text())).toEqual(['zoro_main']);
		await options[0]!.trigger('click');

		expect(emitted(wrapper)).toEqual([
			{ type: 'player', playerId: 5 },
		]);
	});

	it.each([
		{ name: 'a Player holding a Deck List', playerId: 5, hint: false },
		{ name: 'a Player holding none', playerId: 6, hint: true },
	])('says the Screen shows nothing only for $name', async ({ playerId, hint }) => {
		const wrapper = await mountField({ type: 'player', playerId });

		expect(wrapper.find('[data-testid="empty-player-hint"]').exists()).toBe(hint);
	});

	it.each([
		{
			name: 'a side holding a Deck List',
			side: 'player1',
			swapped: false,
			hint: false,
		},
		{
			name: 'a side holding none',
			side: 'player2',
			swapped: false,
			hint: true,
		},
		{
			name: 'a side Swap Players moved the player with none to',
			side: 'player1',
			swapped: true,
			hint: true,
		},
		{
			name: 'a side a Player holding a Deck List is linked into',
			side: 'player2',
			swapped: false,
			linked: true,
			hint: false,
		},
	] as const)('says the Screen shows nothing only for $name of a Slot', async ({ side, swapped, hint, ...rest }) => {
		mockFeatureMatchStore.featureMatches[0]!.player2Data = 'linked' in rest
			? {
					name: '',
					nickname: 'zoro_main',
					gameData: {
						type: 'op',
						leader: null,
						deckList: { id: 601, mainboardCount: 50, leaderNumber: null },
					},
				}
			: BOB;
		if (swapped) {
			mockFeatureMatchStateStore.featureMatchSessions.set(90, {
				id: 90,
				sourceSnapshot: {
					player1: { playerId: null, data: BOB },
					player2: { playerId: null, data: ALICE },
				},
			});
			mockFeatureMatchStateStore.sessionIdBySlotId.set(11, 90);
		}
		const wrapper = await mountField({ type: 'featureMatchSlot', slotId: 11, side });

		expect(wrapper.find('[data-testid="empty-side-hint"]').exists()).toBe(hint);
	});
});
