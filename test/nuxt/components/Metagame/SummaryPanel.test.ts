import type { MetagameSummaryResponse } from '~~/shared/types/metagame';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, reactive } from 'vue';

const mockEventStore = reactive({
	event: { game: 'mtg' as const },
	eventId: 1,
});

const mockMetagameStore = reactive({
	scope: 'all' as 'all' | 'topN' | 'playerList',
	topN: 8,
	playerListId: undefined as number | undefined,
});

const mockPlayerListStore = reactive({
	lists: [{ id: 7, name: 'Feature Table', memberCount: 4 }],
});

mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);
mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);

const UCardStub = defineComponent({
	template: '<div><slot name="header" /><slot /></div>',
});

const UBadgeStub = defineComponent({
	props: { color: { type: String, required: false }, variant: { type: String, required: false } },
	template: '<span><slot /></span>',
});

const StatStripStub = defineComponent({
	props: { stats: { type: Array, required: true } },
	template: '<div><div v-for="stat in stats" :key="stat.label">{{ stat.label }}:{{ stat.value }}</div></div>',
});

function makeSummary(): MetagameSummaryResponse {
	return {
		totalPlayers: 20,
		classifiedPlayers: 18,
		totalDecks: 16,
		totalArchetypes: 7,
		scopedArchetypeCount: 5,
		scope: 'all' as const,
		facts: [
			{ kind: 'simple', key: 'mostPlayedArchetype', title: 'Most PLayed Archetype', value: 'Azorius Control', detail: '12 players · 24% of field' },
			{ kind: 'cardSplit', key: 'mostPlayedCards', title: 'Most Played Cards', mainboard: { label: 'Mainboard', value: 'Lightning Bolt', detail: '30 copies across 10 decks · 62.5% of decks' }, sideboard: { label: 'Sideboard', value: 'Negate', detail: '8 copies across 6 decks · 37.5% of decks' } },
			{ kind: 'cardSplit', key: 'highestAvgCopiesCards', title: 'Highest Avg Copies (5+ decks)', mainboard: { label: 'Mainboard', value: 'Sunfall', detail: '3.2 avg copies across 5 decks · 31.3% of decks' }, sideboard: { label: 'Sideboard', value: 'Disdainful Stroke', detail: '2.1 avg copies across 5 decks · 31.3% of decks' } },
		],
		topArchetypes: [],
		topCards: [],
	};
}

async function mountComponent() {
	const { default: SummaryPanel } = await import('~/components/Metagame/SummaryPanel.vue');

	return mount(SummaryPanel, {
		props: {
			summary: makeSummary(),
			loading: false,
		},
		global: {
			stubs: {
				UCard: UCardStub,
				UBadge: UBadgeStub,
				UILoadingSpinner: true,
				MetagameStatStrip: StatStripStub,
			},
		},
	});
}

describe('metagameSummaryPanel', () => {
	beforeEach(() => {
		mockEventStore.event = { game: 'mtg' };
		mockMetagameStore.scope = 'all';
		mockMetagameStore.topN = 8;
		mockMetagameStore.playerListId = undefined;
		mockPlayerListStore.lists = [{ id: 7, name: 'Feature Table', memberCount: 4 }];
	});

	it('renders scope and stats for MTG without factual callouts', async () => {
		mockMetagameStore.scope = 'topN';
		mockMetagameStore.topN = 16;

		const wrapper = await mountComponent();

		expect(wrapper.text()).toContain('Metagame Overview');
		expect(wrapper.text()).toContain('Top 16');
		expect(wrapper.text()).toContain('Players:20');
		expect(wrapper.text()).toContain('Classified:18 / 20');
		expect(wrapper.text()).toContain('Decklists:16 / 20');
		expect(wrapper.text()).toContain('Archetypes:5');
	});

	it('uses the player list name in the scope label', async () => {
		mockMetagameStore.scope = 'playerList';
		mockMetagameStore.playerListId = 7;

		const wrapper = await mountComponent();

		expect(wrapper.text()).toContain('Player List: Feature Table');
	});
});
