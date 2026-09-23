import { describe, expect, it } from 'vitest';
import { cardInputSchema } from '~~/server/schemas/kv/card';

function validCard() {
	return {
		id: 'card-1',
		name: 'Lightning Bolt',
		set: 'lea',
		layout: 'normal',
		imageData: { front: null, back: null },
		orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
		displayData: { flipped: false, rotated: false, counterRotated: false, turnedOver: false },
	};
}

describe('cardInputSchema persistence bounds', () => {
	it('accepts a normal card payload', () => {
		expect(cardInputSchema.safeParse(validCard()).success).toBe(true);
	});

	it('accepts a full Scryfall set name longer than a set code', () => {
		expect(cardInputSchema.safeParse({
			...validCard(),
			set: 'Secret Lair Drop Series',
		}).success).toBe(true);
	});

	it('rejects unbounded image URI maps', () => {
		const front = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [
			`variant-${index}`,
			`https://example.com/${index}.jpg`,
		]));
		expect(cardInputSchema.safeParse({
			...validCard(),
			imageData: { front, back: null },
		}).success).toBe(false);
	});

	it('rejects non-HTTPS or credential-bearing image URLs', () => {
		for (const url of [
			'javascript:alert(1)',
			'http://127.0.0.1/private.png',
			'https://user:secret@example.com/card.jpg',
		]) {
			expect(cardInputSchema.safeParse({
				...validCard(),
				imageData: { front: { normal: url }, back: null },
			}).success).toBe(false);
		}
	});

	it('rejects invalid or excessive timeout values', () => {
		expect(cardInputSchema.safeParse({
			...validCard(),
			timeoutData: { timeoutDuration: Number.MAX_SAFE_INTEGER, timeoutStartTimestamp: Date.now() },
		}).success).toBe(false);
	});
});
