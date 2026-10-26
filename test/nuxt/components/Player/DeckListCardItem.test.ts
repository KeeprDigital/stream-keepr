import type { DeckListCard } from '~~/shared/types/deckList';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DeckListCardItem from '~/components/Player/DeckListCardItem.vue';

const card: DeckListCard = {
	name: 'Ocelot Pride',
	quantity: 4,
	compartment: 'mainboard',
	cardType: 'Creature',
	scryfallId: null,
};

function mountItem(props: Record<string, unknown> = {}) {
	return mount(DeckListCardItem, {
		props: {
			card,
			imageUrl: null,
			isActive: false,
			...props,
		},
		global: {
			stubs: {
				UBadge: true,
				CardHoverPreview: { template: '<div><slot /></div>' },
			},
		},
	});
}

describe('player deck list card item', () => {
	it('shows the quantity beside the card name by default', () => {
		expect(mountItem().text()).toBe('4Ocelot Pride');
	});

	it('hides the quantity when the caller opts out', () => {
		expect(mountItem({ showQuantity: false }).text()).toBe('Ocelot Pride');
	});
});
