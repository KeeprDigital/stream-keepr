import type { Component } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, reactive } from 'vue';
import { nuxtUiStubs, UInputMenuStub } from '~~/test/nuxt/helpers/nuxtUiStubs';
import ArchetypeField from '~/components/Screen/ArchetypeField.vue';
import FeatureMatchSlotField from '~/components/Screen/FeatureMatchSlotField.vue';
import PhaseField from '~/components/Screen/PhaseField.vue';
import PlayerField from '~/components/Screen/PlayerField.vue';
import PlayerListField from '~/components/Screen/PlayerListField.vue';
import RoundField from '~/components/Screen/RoundField.vue';
import TalentField from '~/components/Screen/TalentField.vue';
import { useConsumedEventData } from '~/modules/event-data/resync';

// One Event Reference picker per kind (ADR-0038): each loads what it lists, re-reads it on
// Reconnect Resync, and emits the picked id, or the `null` that deletes the reference (ADR-0041).

const EVENT_DATA = {
	rounds: [
		{
			id: 31,
			phaseId: 3,
			name: 'Round 4',
			roundNumber: 4,
		},
	],
	phases: [
		{ id: 4, name: 'Top Cut', sortOrder: 2 },
		{ id: 3, name: 'Swiss', sortOrder: 1 },
	],
	players: [
		{
			id: 7,
			name: 'Nadia Rivers',
			nickname: null,
			externalSource: null,
			externalId: null,
		},
		{
			id: 8,
			name: '',
			nickname: 'zoro_main',
			externalSource: 'tcgplus',
			externalId: '0001234',
		},
	],
	lists: [
		{ id: 9, name: 'Feature Table', memberCount: 4 },
	],
	archetypes: [
		{ id: 21, name: 'Azorius Control' },
		{ id: 22, name: 'Mono Red' },
	],
	// One deck is assigned to Azorius Control; Mono Red is an Empty Archetype.
	decks: [
		{ id: 41, playerId: 7, archetypeId: 21 },
	],
	featureMatches: [
		{ id: 11, label: 'Match 1 — A vs B' },
		{ id: 12, label: 'Match 2' },
	],
};

const stores = vi.hoisted(() => {
	const store = <Items extends string, Load extends string>(items: Items, load: Load) => ({
		isLoaded: false,
		[items]: [] as Record<string, unknown>[],
		[load]: vi.fn(),
	}) as { isLoaded: boolean } & Record<Items, Record<string, any>[]> & Record<Load, ReturnType<typeof vi.fn>>;
	return {
		round: store('rounds', 'loadRoundsByEventId'),
		phase: store('phases', 'loadPhasesByEventId'),
		player: store('players', 'loadPlayersByEventId'),
		playerList: store('lists', 'loadByEventId'),
		archetype: store('archetypes', 'loadByEventId'),
		playerDeck: store('decks', 'loadByEventId'),
		featureMatch: store('featureMatches', 'loadFeatureMatchesByEventId'),
		event: {
			event: {
				talents: [
					{ id: 51, name: 'Caster One' },
					{ id: 52, name: 'Caster Two' },
				],
			},
		},
	};
});

// Reactive, as a Pinia store is, so a load shows in the options.
const held = {
	round: reactive(stores.round),
	phase: reactive(stores.phase),
	player: reactive(stores.player),
	playerList: reactive(stores.playerList),
	archetype: reactive(stores.archetype),
	playerDeck: reactive(stores.playerDeck),
	featureMatch: reactive(stores.featureMatch),
};
mockNuxtImport('useRoundStore', () => () => held.round);
mockNuxtImport('usePhaseStore', () => () => held.phase);
mockNuxtImport('usePlayerStore', () => () => held.player);
mockNuxtImport('usePlayerListStore', () => () => held.playerList);
mockNuxtImport('useArchetypeStore', () => () => held.archetype);
mockNuxtImport('usePlayerDeckStore', () => () => held.playerDeck);
mockNuxtImport('useFeatureMatchStore', () => () => held.featureMatch);
mockNuxtImport('useEventStore', () => () => stores.event);
mockNuxtImport('useFeatureMatchMenuItems', () => () => computed(() =>
	held.featureMatch.featureMatches.map(slot => ({ label: slot.label, value: slot.id }))));
vi.mock('~/modules/event-data/resync', () => ({
	useConsumedEventData: vi.fn(),
}));

/** Each store answers its load for Event 1 with the Event's data, as the network would. */
function answerLoads() {
	const answer = (store: { isLoaded: boolean }, load: ReturnType<typeof vi.fn>, items: Record<string, unknown>) =>
		load.mockImplementation(async (eventId: number) => {
			if (eventId === 1)
				Object.assign(store, { isLoaded: true }, items);
		});
	answer(held.round, held.round.loadRoundsByEventId, { rounds: EVENT_DATA.rounds });
	answer(held.phase, held.phase.loadPhasesByEventId, { phases: EVENT_DATA.phases });
	answer(held.player, held.player.loadPlayersByEventId, { players: EVENT_DATA.players });
	answer(held.playerList, held.playerList.loadByEventId, { lists: EVENT_DATA.lists });
	answer(held.archetype, held.archetype.loadByEventId, { archetypes: EVENT_DATA.archetypes });
	answer(held.playerDeck, held.playerDeck.loadByEventId, { decks: EVENT_DATA.decks });
	answer(held.featureMatch, held.featureMatch.loadFeatureMatchesByEventId, { featureMatches: EVENT_DATA.featureMatches });
}

interface PickerKind {
	kind: string;
	picker: Component;
	nullLabel: string;
	offers: string[];
	pick: { label: string; id: number };
	rereads: string[];
	searchable: boolean;
}

const KINDS: PickerKind[] = [
	{
		kind: 'Round',
		picker: RoundField,
		nullLabel: 'Select a round…',
		offers: ['Swiss · Round 4'],
		pick: { label: 'Swiss · Round 4', id: 31 },
		rereads: ['phases', 'rounds'],
		searchable: false,
	},
	{
		kind: 'Phase',
		picker: PhaseField,
		nullLabel: 'Select a phase…',
		offers: ['Swiss', 'Top Cut'],
		pick: { label: 'Top Cut', id: 4 },
		rereads: ['phases'],
		searchable: false,
	},
	{
		kind: 'Player',
		picker: PlayerField,
		nullLabel: 'Select a player…',
		offers: ['Nadia Rivers', 'zoro_main'],
		pick: { label: 'zoro_main', id: 8 },
		rereads: ['players'],
		searchable: true,
	},
	{
		kind: 'Player List',
		picker: PlayerListField,
		nullLabel: 'Select a list…',
		offers: ['Feature Table (4)'],
		pick: { label: 'Feature Table (4)', id: 9 },
		rereads: ['playerLists'],
		searchable: false,
	},
	{
		kind: 'Archetype',
		picker: ArchetypeField,
		nullLabel: 'Select an archetype…',
		// It lists an Empty Archetype, marked: hidden, an operator could neither pick nor find it.
		offers: ['Azorius Control', 'Mono Red (empty)'],
		pick: { label: 'Mono Red (empty)', id: 22 },
		rereads: ['archetypes', 'playerDecks', 'players'],
		searchable: true,
	},
	{
		kind: 'Feature Match Slot',
		picker: FeatureMatchSlotField,
		nullLabel: 'Select a slot…',
		offers: ['Match 1 — A vs B', 'Match 2'],
		pick: { label: 'Match 2', id: 12 },
		rereads: ['featureMatchSlots'],
		searchable: false,
	},
	{
		kind: 'Talent',
		picker: TalentField,
		nullLabel: 'Select a Talent…',
		offers: ['Caster One', 'Caster Two'],
		pick: { label: 'Caster Two', id: 52 },
		rereads: ['event'],
		searchable: false,
	},
];

describe('event reference pickers', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		for (const store of Object.values(held))
			store.isLoaded = false;
		Object.assign(held.round, { rounds: [] });
		Object.assign(held.phase, { phases: [] });
		Object.assign(held.player, { players: [] });
		Object.assign(held.playerList, { lists: [] });
		Object.assign(held.archetype, { archetypes: [] });
		Object.assign(held.playerDeck, { decks: [] });
		Object.assign(held.featureMatch, { featureMatches: [] });
		answerLoads();
	});

	async function mountPicker(picker: Component, props: Record<string, unknown> = {}) {
		const wrapper = mount(picker, {
			props: { eventId: 1, ...props },
			global: {
				stubs: { ...nuxtUiStubs, UInputMenu: UInputMenuStub },
			},
		});
		await flushPromises();
		return wrapper;
	}

	type Picker = Awaited<ReturnType<typeof mountPicker>>;

	/** What the picker offers, its null option aside, whichever control it is. */
	const offered = (wrapper: Picker, nullLabel = '') => wrapper.findAll('option, [role="option"]')
		.map(option => option.text())
		.filter(text => text && text !== nullLabel);

	async function pick(wrapper: Picker, { searchable }: PickerKind, option: { label: string; id: number } | null) {
		if (!searchable)
			await wrapper.get('select').setValue(String(option?.id ?? null));
		else if (!option)
			await wrapper.get('[aria-label="Clear"]').trigger('click');
		else
			await wrapper.findAll('[role="option"]').find(candidate => candidate.text() === option.label)!.trigger('click');
	}

	it.each(KINDS)('the $kind picker loads what it lists and names its field after its kind', async (kind) => {
		const wrapper = await mountPicker(kind.picker);

		expect(offered(wrapper, kind.nullLabel)).toEqual(kind.offers);
		expect(wrapper.get('label span').text()).toBe(kind.kind);
		expect(wrapper.html()).toContain(kind.nullLabel);
		expect(vi.mocked(useConsumedEventData).mock.calls).toEqual([
			[kind.rereads],
		]);
	});

	it.each(KINDS)('the $kind picker emits the id picked, and null when cleared', async (kind) => {
		const picking = await mountPicker(kind.picker);
		await pick(picking, kind, kind.pick);
		const clearing = await mountPicker(kind.picker, { modelValue: kind.pick.id });
		await pick(clearing, kind, null);

		expect(picking.emitted('update:modelValue')).toEqual([
			[kind.pick.id],
		]);
		expect(clearing.emitted('update:modelValue')).toEqual([
			[null],
		]);
	});

	it.each([
		{
			by: 'name',
			search: 'nadia',
			found: ['Nadia Rivers'],
		},
		{
			by: 'Nickname',
			search: 'ZORO',
			found: ['zoro_main'],
		},
		{
			by: 'Bandai member number',
			search: '0001234',
			found: ['zoro_main'],
		},
	])('the Player picker finds a Player by $by', async ({ search, found }) => {
		const wrapper = await mountPicker(PlayerField);
		await wrapper.get('[role="combobox"]').setValue(search);

		expect(offered(wrapper)).toEqual(found);
	});

	it('a picker names none as its mode does, before what it lists', async () => {
		const wrapper = await mountPicker(RoundField, { nullLabel: 'Current standings' });

		expect(offered(wrapper)).toEqual(['Current standings', 'Swiss · Round 4']);
	});

	it.each([
		{ name: 'says where to make one once the Event is known to have none', lists: [], hint: true },
		{ name: 'says nothing of making one for an Event that has one', lists: EVENT_DATA.lists, hint: false },
	])('the Player List picker $name', async ({ lists, hint }) => {
		held.playerList.loadByEventId.mockImplementation(async () => {
			Object.assign(held.playerList, { isLoaded: true, lists });
		});
		const wrapper = await mountPicker(PlayerListField);

		expect(wrapper.text().includes('Create one on the Players page')).toBe(hint);
		expect(wrapper.find('select').exists()).toBe(!hint);
	});

	it('the Player picker offers only the Players its caller labels, under those labels', async () => {
		const wrapper = await mountPicker(PlayerField, {
			offer: (player: { id: number; name: string }) => player.id === 7
				? `${player.name} - Azorius Control`
				: null,
		});

		expect(offered(wrapper)).toEqual(['Nadia Rivers - Azorius Control']);
	});
});
