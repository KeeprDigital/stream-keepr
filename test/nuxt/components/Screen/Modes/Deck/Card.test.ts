import type { DeckListCardWithData } from '~/types/card/deckList';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Card from '~/components/Screen/Modes/Deck/Card.vue';

function createCard(overrides: Partial<DeckListCardWithData> = {}): DeckListCardWithData {
	return {
		name: 'Mana Drain',
		quantity: 1,
		compartment: 'mainboard',
		cardType: 'Instant',
		scryfallId: null,
		highlanderPoints: 1,
		mtgCard: null,
		...overrides,
	};
}

async function mountComponent(props: Record<string, unknown> = {}) {
	return mount(Card, {
		props: {
			card: createCard(),
			board: 'mainboard',
			showQuantity: false,
			showHighlanderPoints: true,
			quantityPositionClass: '-top-1 -right-1',
			quantityBadgeStyle: { color: 'white', backgroundColor: 'purple' },
			highlanderPointsPositionClass: '-bottom-1 -left-1',
			highlanderPointsBadgeStyle: { color: 'red', backgroundColor: 'blue' },
			sizing: 'fixed',
			...props,
		},
		global: {
			stubs: {
				NuxtImg: true,
			},
		},
	});
}

describe('screenDeckCard', () => {
	it('shows the card\'s Highlander points in the configured colours', async () => {
		const wrapper = await mountComponent();
		const badge = wrapper.get('[data-testid="highlander-card-badge"]');

		expect(badge.text()).toBe('1');
		expect(badge.attributes('style')).toContain('color: red;');
		expect(badge.attributes('style')).toContain('background-color: blue;');
	});

	// Fixed takes its board's card-width Mode Token; fill takes its column; fit fits its grid cell, badges and all.
	it.each([
		{
			board: 'mainboard',
			sizing: 'fixed',
			width: 'var(--theme-deck-mainboard-card-width)',
			fitted: false,
		},
		{
			board: 'sideboard',
			sizing: 'fixed',
			width: 'var(--theme-deck-sideboard-card-width)',
			fitted: false,
		},
		{
			board: 'sideboard',
			sizing: 'fill',
			width: '100%',
			fitted: false,
		},
		{
			board: 'mainboard',
			sizing: 'fit',
			width: '',
			fitted: true,
		},
	])('sizes a $sizing $board card', async ({ board, sizing, width, fitted }) => {
		const wrapper = await mountComponent({ board, sizing });

		expect((wrapper.get('.card-item').element as HTMLElement).style.width).toBe(width);
		expect(wrapper.find('[data-card-fit] .card-item [data-testid="highlander-card-badge"]').exists()).toBe(fitted);
	});

	it('hides the Highlander point badge when disabled', async () => {
		const wrapper = await mountComponent({ showHighlanderPoints: false });

		expect(wrapper.find('[data-testid="highlander-card-badge"]').exists()).toBe(false);
	});

	it('renders card images eagerly for preloaded deck swaps', async () => {
		const wrapper = await mountComponent({
			card: createCard({
				mtgCard: {
					imageData: {
						front: {
							small: 'https://img.test/mana-drain-small.jpg',
							normal: 'https://img.test/mana-drain.jpg',
							large: 'https://img.test/mana-drain-large.jpg',
							png: 'https://img.test/mana-drain.png',
							art_crop: 'https://img.test/mana-drain-art.jpg',
							border_crop: 'https://img.test/mana-drain-border.jpg',
						},
						back: null,
					},
				} as DeckListCardWithData['mtgCard'],
			}),
		});

		expect(wrapper.get('nuxt-img-stub').attributes('loading')).toBe('eager');
	});

	it('keeps a named placeholder visible when card art is unavailable', async () => {
		const wrapper = await mountComponent({
			card: createCard({ name: 'Rest in Peace', mtgCard: null }),
		});

		expect(wrapper.find('nuxt-img-stub').exists()).toBe(false);
		expect(wrapper.text()).toContain('Rest in Peace');
	});
});
