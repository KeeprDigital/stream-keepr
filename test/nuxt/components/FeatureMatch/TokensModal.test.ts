import type { Player } from '~/types';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

const mockFetchDeck = vi.fn();

mockNuxtImport('useEventStore', () => () => ({ eventId: 99 }));
mockNuxtImport('usePlayerDeckCache', () => () => ({ fetchDeck: mockFetchDeck }));

const UModalStub = defineComponent({
	props: {
		open: { type: Boolean, required: true },
		title: { type: String, required: false },
	},
	template: `
		<div :data-open="open">
			<h2>{{ title }}</h2>
			<slot name="body" />
			<slot name="footer" />
		</div>
	`,
});

const UBadgeStub = defineComponent({
	template: '<span><slot /></span>',
});

const UButtonStub = defineComponent({
	emits: ['click'],
	template: '<button @click="$emit(\'click\')"><slot /></button>',
});

function makePlayer(overrides?: Partial<Player>): Player {
	return {
		id: 1,
		eventId: 99,
		name: 'Alex',
		pronouns: null,
		externalId: null,
		externalSource: null,
		wins: null,
		losses: null,
		draws: null,
		position: null,
		points: null,
		archetypeId: null,
		lgs: null,
		gameData: { type: 'mtg', deckName: 'Maps', deckColors: 'W' },
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	};
}

function makeDeck(cardName: string, tokenName = 'Map') {
	return {
		id: 1,
		cards: [
			{
				cardId: 10,
				name: cardName,
				scryfallId: 'source-card',
				cardType: 'Enchantment',
				colors: 'W',
				cmc: 2,
				manaCost: '{1}{W}',
				deckCounterTypes: [],
				deckTokens: [
					{ id: tokenName.toLowerCase(), scryfallId: tokenName.toLowerCase(), name: tokenName, typeLine: 'Token Artifact - Map', uri: null },
				],
				quantity: 4,
				compartment: 'mainboard',
				sortOrder: 0,
			},
		],
	};
}

async function mountComponent() {
	const { default: TokensModal } = await import('~/components/FeatureMatch/TokensModal.vue');

	const wrapper = mount(TokensModal, {
		props: {
			open: true,
			matchTitle: 'Match 1',
			playerOne: makePlayer(),
			playerTwo: makePlayer({ id: 2, name: 'Blair' }),
		},
		global: {
			stubs: {
				UModal: UModalStub,
				UBadge: UBadgeStub,
				UButton: UButtonStub,
				UILoadingSpinner: true,
				UIEmptyState: true,
				MetagameCardThumbnail: true,
			},
		},
	});

	await flushPromises();
	return wrapper;
}

describe('featureMatchTokensModal', () => {
	beforeEach(() => {
		mockFetchDeck.mockReset();
		mockFetchDeck
			.mockResolvedValueOnce(makeDeck('Surveyor Saga'))
			.mockResolvedValueOnce(makeDeck('Route Planner', 'map'));
	});

	it('loads player decks and shows unique required tokens with players and sources', async () => {
		const wrapper = await mountComponent();

		expect(mockFetchDeck).toHaveBeenCalledWith(1, 99, expect.any(Date));
		expect(mockFetchDeck).toHaveBeenCalledWith(2, 99, expect.any(Date));
		expect(wrapper.text()).toContain('Match 1 Tokens');
		expect(wrapper.text()).toContain('Map');
		expect(wrapper.text()).toContain('Alex');
		expect(wrapper.text()).toContain('Blair');
		expect(wrapper.text()).toContain('Route Planner');
		expect(wrapper.text()).toContain('Surveyor Saga');
	});

	it('emits close through the footer action', async () => {
		const wrapper = await mountComponent();

		await wrapper.get('button').trigger('click');

		expect(wrapper.emitted('update:open')).toEqual([[false]]);
	});

	it('keeps loaded token content while closing', async () => {
		const wrapper = await mountComponent();

		await wrapper.setProps({ open: false });

		expect(wrapper.text()).toContain('Map');
		expect(wrapper.text()).not.toContain('No required tokens');
	});
});
