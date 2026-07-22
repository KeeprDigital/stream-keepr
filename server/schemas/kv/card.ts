import type { ScryfallCardFields, ScryfallImageUris } from '@scryfall/api-types';
import { z } from 'zod';

const MAX_CARD_PAYLOAD_BYTES = 128 * 1024;

function jsonByteLength(value: unknown): number {
	return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export const cardTimeoutDataSchema = z.object({
	timeoutDuration: z.number().int().nonnegative().max(24 * 60 * 60 * 1000),
	timeoutStartTimestamp: z.number().int().positive(),
}).strict();

const cardImageUrlSchema = z.string().url().max(2_000).refine((value) => {
	const parsed = new URL(value);
	return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
}, 'Card image URL must use HTTPS without embedded credentials');

const imageUrisSchema = z
	.record(z.string().min(1).max(50), cardImageUrlSchema)
	.refine(value => Object.keys(value).length <= 20, 'Too many image URI variants');

export const cardInputSchema = z.object({
	id: z.string().min(1).max(100),
	name: z.string().min(1).max(200),
	set: z.string().min(1).max(20),
	layout: z.string().min(1).max(50) as z.ZodType<ScryfallCardFields.Core.All['layout']>,
	imageData: z.object({
		front: imageUrisSchema.nullable() as z.ZodType<ScryfallImageUris | null>,
		back: imageUrisSchema.nullable() as z.ZodType<ScryfallImageUris | null>,
	}).strict(),
	orientationData: z.object({
		flipable: z.boolean(),
		turnable: z.boolean(),
		rotateable: z.boolean(),
		counterRotateable: z.boolean(),
	}).strict(),
	displayData: z.object({
		flipped: z.boolean(),
		rotated: z.boolean(),
		counterRotated: z.boolean(),
		turnedOver: z.boolean(),
	}).strict(),
	meldData: z.object({
		meldPartOne: z.string().max(100).nullable(),
		meldPartTwo: z.string().max(100).nullable(),
		meldResult: z.string().max(100).nullable(),
	}).strict().optional(),
	timeoutData: cardTimeoutDataSchema.optional(),
}).strict().refine(
	value => jsonByteLength(value) <= MAX_CARD_PAYLOAD_BYTES,
	`Card payload must not exceed ${MAX_CARD_PAYLOAD_BYTES} bytes`,
);

export const storedCardSchema = cardInputSchema.extend({
	savedAt: z.number(),
});

export type CardInput = z.infer<typeof cardInputSchema>;
export type StoredCardData = z.infer<typeof storedCardSchema>;
export type CardTimeoutData = z.infer<typeof cardTimeoutDataSchema>;
