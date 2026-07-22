import { describe, expect, it } from 'vitest';
import {
	cardInputSchema,
	cardTimeoutDataSchema,
	storedCardSchema,
} from '~~/server/schemas/kv/card';

// ──────────────── Helpers ────────────────

const validImageData = {
	front: { small: 'https://example.com/small.jpg', normal: 'https://example.com/normal.jpg' },
	back: null,
};

const validOrientationData = {
	flipable: false,
	turnable: false,
	rotateable: false,
	counterRotateable: false,
};

const validDisplayData = {
	flipped: false,
	rotated: false,
	counterRotated: false,
	turnedOver: false,
};

const validCardInput = {
	id: 'card-abc-123',
	name: 'Lightning Bolt',
	set: 'M21',
	layout: 'normal',
	imageData: validImageData,
	orientationData: validOrientationData,
	displayData: validDisplayData,
};

// ──────────────── cardTimeoutDataSchema ────────────────

describe('cardTimeoutDataSchema', () => {
	it('accepts valid timeout data', () => {
		const result = cardTimeoutDataSchema.safeParse({
			timeoutDuration: 5000,
			timeoutStartTimestamp: 1700000000000,
		});
		expect(result.success).toBe(true);
	});
});

// ──────────────── cardInputSchema ────────────────

describe('cardInputSchema', () => {
	it('accepts valid complete card input', () => {
		const result = cardInputSchema.safeParse(validCardInput);
		expect(result.success).toBe(true);
	});

	it('accepts card with optional meldData', () => {
		const result = cardInputSchema.safeParse({
			...validCardInput,
			meldData: {
				meldPartOne: 'Part A',
				meldPartTwo: 'Part B',
				meldResult: 'Combined',
			},
		});
		expect(result.success).toBe(true);
	});

	it('accepts card with optional timeoutData', () => {
		const result = cardInputSchema.safeParse({
			...validCardInput,
			timeoutData: {
				timeoutDuration: 5000,
				timeoutStartTimestamp: 1700000000000,
			},
		});
		expect(result.success).toBe(true);
	});

	it('accepts card without meldData and timeoutData', () => {
		const result = cardInputSchema.safeParse(validCardInput);
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.meldData).toBeUndefined();
			expect(result.data.timeoutData).toBeUndefined();
		}
	});
});

// ──────────────── storedCardSchema ────────────────

describe('storedCardSchema', () => {
	it('accepts valid stored card with savedAt', () => {
		const result = storedCardSchema.safeParse({
			...validCardInput,
			savedAt: 1700000000000,
		});
		expect(result.success).toBe(true);
	});
});
