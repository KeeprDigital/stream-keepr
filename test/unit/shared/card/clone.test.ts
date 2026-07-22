import type { MtgCard } from '~~/shared/types/card/mtg';
import { describe, expect, it } from 'vitest';
import { cloneMtgCard } from '~~/shared/utils/card/clone';

const baseCard: MtgCard = {
	id: 'abc-123',
	name: 'Lightning Bolt',
	set: 'M21',
	layout: 'normal',
	imageData: {
		front: { small: 'https://example.com/small.jpg', normal: 'https://example.com/normal.jpg' } as any,
		back: null,
	},
	orientationData: {
		flipable: false,
		turnable: false,
		rotateable: false,
		counterRotateable: false,
	},
	displayData: {
		flipped: false,
		rotated: false,
		counterRotated: false,
		turnedOver: false,
	},
};

describe('cloneMtgCard', () => {
	it('preserves undefined meldData', () => {
		const clone = cloneMtgCard(baseCard);
		expect(clone.meldData).toBeUndefined();
	});
});
