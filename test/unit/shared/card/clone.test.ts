import type { MtgCard } from '~~/shared/types/card/mtg';
import { describe, expect, it } from 'vitest';
import { cloneMtgCard } from '~~/shared/utils/card/clone';

const card: MtgCard = {
	id: 'abc-123',
	name: 'Lightning Bolt',
	set: 'M21',
	layout: 'normal',
	imageData: {
		front: { small: 'https://example.com/small.jpg', normal: 'https://example.com/normal.jpg' } as any,
		back: null,
	},
	orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
	displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
	meldData: { name: 'Meld result' } as any,
};

describe('cloneMtgCard', () => {
	it('copies every nested part, so editing the clone leaves the original alone', () => {
		const clone = cloneMtgCard(card);
		clone.imageData.front!.small = 'changed';
		clone.displayData.flipped = true;
		clone.orientationData.flipable = true;
		(clone.meldData as any).name = 'changed';

		expect(clone).not.toBe(card);
		expect(card.imageData.front!.small).toBe('https://example.com/small.jpg');
		expect(card.displayData.flipped).toBe(false);
		expect(card.orientationData.flipable).toBe(false);
		expect((card.meldData as any).name).toBe('Meld result');
	});

	it('leaves absent optional parts absent', () => {
		const clone = cloneMtgCard({ ...card, meldData: undefined });

		expect(clone.meldData).toBeUndefined();
		expect(clone.timeoutData).toBeUndefined();
		expect(clone.imageData.back).toBeNull();
	});
});
