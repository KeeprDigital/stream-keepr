import type { DeckListCardWithData } from '~/types/card/deckList';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

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
	const componentPath = '../../../../../../app/components/Screen/Modes/Deck/Card.vue';
	const { default: Card } = await import(componentPath);

	return mount(Card, {
		props: {
			card: createCard(),
			sizeClass: 'w-36',
			showQuantity: false,
			showHighlanderPoints: true,
			quantityPositionClass: '-top-1 -right-1',
			quantitySizeClass: 'w-7 h-7 text-base',
			quantityBadgeStyle: { color: 'white', backgroundColor: 'purple' },
			highlanderPointsPositionClass: '-bottom-1 -left-1',
			highlanderPointsSizeClass: 'min-w-8 px-3 py-1.5 text-base',
			highlanderPointsBadgeStyle: { color: 'red', backgroundColor: 'blue' },
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
	it('renders a configurable Highlander point badge', async () => {
		const wrapper = await mountComponent();
		const badge = wrapper.get('[data-testid="highlander-card-badge"]');

		expect(badge.text()).toBe('1');
		expect(badge.classes()).toContain('-bottom-1');
		expect(badge.classes()).toContain('-left-1');
		expect(badge.classes()).toContain('min-w-8');
		expect(badge.classes()).toContain('text-base');
		expect(badge.attributes('style')).toContain('color: red;');
		expect(badge.attributes('style')).toContain('background-color: blue;');
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
