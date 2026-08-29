import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import Card from '../../../../../../app/components/Screen/Modes/TopCards/Card.vue';

const entry = {
	id: 1,
	name: 'Lightning Bolt',
	cardType: 'Instant',
	scryfallId: 'abcd1234-0000-0000-0000-000000000000',
	colors: 'R',
	cmc: 1,
	manaCost: '{R}',
	inclusionRate: 80,
	avgCopies: 3.6,
	totalCopies: 18,
	mainboardCount: 18,
	sideboardCount: 0,
	mainboardDeckCount: 4,
	sideboardDeckCount: 0,
	deckCount: 4,
};

const baseProps = {
	entry,
	rank: 3,
	sizeClass: 'w-40',
	dynamicSize: true,
	showName: true,
	showRank: true,
	rankBadgeClass: 'top-1 left-1 w-6 h-6 text-sm',
	rankBadgeStyle: { color: '#ffffff', backgroundColor: '#7c3aed' },
	statText: '80%' as string | null,
	statBadgeClass: 'bottom-1 right-1 text-sm px-2 py-1',
	statBadgeStyle: { color: '#111827', backgroundColor: '#ffffff' },
};

describe('screenTopCardsCard', () => {
	it('renders the Scryfall front-face image from the scryfall id', () => {
		const wrapper = mount(Card, { props: baseProps });

		const img = wrapper.get('img');
		expect(img.attributes('src')).toBe('https://cards.scryfall.io/normal/front/a/b/abcd1234-0000-0000-0000-000000000000.jpg');
		expect(img.attributes('alt')).toBe('Lightning Bolt');
	});

	it('falls back to the card name when there is no scryfall id', () => {
		const wrapper = mount(Card, {
			props: { ...baseProps, entry: { ...entry, scryfallId: null } },
		});

		expect(wrapper.find('img').exists()).toBe(false);
		expect(wrapper.text()).toContain('Lightning Bolt');
	});

	it('shows the rank and stat badges', () => {
		const wrapper = mount(Card, { props: baseProps });

		expect(wrapper.get('[data-testid="top-cards-rank-badge"]').text()).toBe('3');
		expect(wrapper.get('[data-testid="top-cards-stat-badge"]').text()).toBe('80%');
	});

	it('hides the rank badge, stat badge, and name when disabled', () => {
		const wrapper = mount(Card, {
			props: { ...baseProps, showRank: false, showName: false, statText: null },
		});

		expect(wrapper.find('[data-testid="top-cards-rank-badge"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="top-cards-stat-badge"]').exists()).toBe(false);
		expect(wrapper.find('[data-testid="top-cards-name"]').exists()).toBe(false);
	});

	it('shows the card name label when enabled', () => {
		const wrapper = mount(Card, { props: baseProps });

		expect(wrapper.get('[data-testid="top-cards-name"]').text()).toBe('Lightning Bolt');
	});
});
