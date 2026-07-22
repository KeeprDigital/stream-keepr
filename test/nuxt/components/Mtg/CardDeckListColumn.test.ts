import type { DeckListCardWithData, MatchPlayerDeckData } from '~/types/card/deckList';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const selectPreviewCard = vi.fn();

mockNuxtImport('useCardStore', () => () => ({ selectPreviewCard }));
mockNuxtImport('usePlayerStore', () => () => ({ players: [] }));
mockNuxtImport('usePlayerDeckListModal', () => () => ({ openDeckLists: vi.fn() }));

const CardDeckListSectionStub = defineComponent({
	props: {
		title: { type: String, required: true },
		cards: { type: Array, required: true },
		filter: { type: String, required: true },
		defaultOpen: { type: Boolean, required: true },
	},
	template: '<section data-testid="deck-section" :data-title="title" :data-card-count="cards.length" :data-filter="filter" :data-default-open="String(defaultOpen)" />',
});

const UCollapsibleStub = defineComponent({
	props: {
		defaultOpen: { type: Boolean, default: false },
	},
	template: '<section data-testid="collapsible" :data-default-open="String(defaultOpen)"><slot :open="defaultOpen" /><div v-if="defaultOpen"><slot name="content" /></div></section>',
});

const UBadgeStub = defineComponent({
	template: '<span data-testid="badge"><slot /></span>',
});

const CardListStub = defineComponent({
	props: {
		cards: { type: Array, required: true },
		quantities: { type: Object, required: false },
		points: { type: Object, required: false },
	},
	template: '<div data-testid="card-list" />',
});

function createCard(name: string, compartment: 'mainboard' | 'sideboard', quantity = 1): DeckListCardWithData {
	return {
		name,
		quantity,
		compartment,
		cardType: 'Instant',
		scryfallId: null,
		mtgCard: null,
	};
}

function createPlayerData(): MatchPlayerDeckData {
	return {
		playerName: 'Alice',
		deckList: {
			deckId: 10,
			externalId: 'deck-10',
			formatExternalId: 'modern',
			phaseIds: [1],
			phaseName: 'Swiss',
			name: 'Control',
			colors: 'U',
			isPrimary: true,
			cards: [],
		},
		deckCounters: [],
		deckTokens: [],
		mainboard: [createCard('Consider', 'mainboard', 4)],
		sideboard: [createCard('Negate', 'sideboard', 2)],
		tokens: [{
			id: 'treasure',
			scryfallId: null,
			name: 'Treasure',
			typeLine: 'Token Artifact — Treasure',
			uri: null,
			mtgCard: null,
		}],
	};
}

async function mountColumn(playerData = createPlayerData(), filter = '') {
	const componentPath = '../../../../app/components/Mtg/CardDeckListColumn.vue';
	const { default: CardDeckListColumn } = await import(componentPath);

	return mount(CardDeckListColumn, {
		props: { playerData, filter },
		global: {
			stubs: {
				MtgCardDeckListSection: CardDeckListSectionStub,
				MtgHighlanderSummary: true,
				MtgManaColorDisplay: true,
				UBadge: true,
				UIcon: true,
			},
		},
	});
}

async function mountSection(filter = '') {
	const componentPath = '../../../../app/components/Mtg/CardDeckListSection.vue';
	const { default: CardDeckListSection } = await import(componentPath);
	const resolvedCard = createCard('Consider', 'mainboard', 2);
	resolvedCard.highlanderPoints = 1;
	resolvedCard.mtgCard = {
		id: 'consider',
		name: 'Consider',
	} as any;

	return mount(CardDeckListSection, {
		props: {
			title: 'Mainboard',
			cards: [resolvedCard, createCard('Opt', 'mainboard')],
			filter,
		},
		global: {
			stubs: {
				UCollapsible: UCollapsibleStub,
				UBadge: UBadgeStub,
				UIcon: true,
				MtgCardList: CardListStub,
			},
		},
	});
}

describe('mtgCardDeckListColumn', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders mainboard, sideboard, and tokens together in one flow', async () => {
		const wrapper = await mountColumn();
		const sections = wrapper.findAll('[data-testid="deck-section"]');

		expect(sections.map(section => section.attributes('data-title'))).toEqual([
			'Mainboard',
			'Sideboard',
			'Tokens',
		]);
		expect(sections.map(section => section.attributes('data-card-count'))).toEqual(['1', '1', '1']);
		expect(sections.map(section => section.attributes('data-default-open'))).toEqual(['true', 'true', 'false']);
	});

	it('omits empty optional sections but always shows the mainboard', async () => {
		const playerData = createPlayerData();
		playerData.sideboard = [];
		playerData.tokens = [];
		const wrapper = await mountColumn(playerData);

		expect(wrapper.findAll('[data-testid="deck-section"]')).toHaveLength(1);
		expect(wrapper.get('[data-testid="deck-section"]').attributes('data-title')).toBe('Mainboard');
	});
});

describe('mtgCardDeckListSection', () => {
	it('starts expanded and shows the total number of cards', async () => {
		const wrapper = await mountSection();

		expect(wrapper.get('[data-testid="collapsible"]').attributes('data-default-open')).toBe('true');
		expect(wrapper.get('[data-testid="badge"]').text()).toBe('3');
		expect(wrapper.find('[data-testid="card-list"]').exists()).toBe(true);
		expect(wrapper.text()).toContain('Opt');
	});

	it('applies filtering within the section and reports zero matches', async () => {
		const wrapper = await mountSection('missing');

		expect(wrapper.get('[data-testid="badge"]').text()).toBe('0/3');
		expect(wrapper.text()).toContain('No cards match this filter.');
		expect(wrapper.find('[data-testid="card-list"]').exists()).toBe(false);
	});
});
