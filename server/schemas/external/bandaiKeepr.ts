import { z } from 'zod';
import { OP_CARD_CATEGORIES, OP_PRINTING_KINDS } from '~~/shared/types/card/op';

/**
 * What stream-keepr reads of bandai-keepr's answers. Fields it does not use
 * pass unchecked, so bandai-keepr can add to a Card without breaking this side.
 */
const cardFields = {
	number: z.string().min(1),
	sourcePrintingId: z.string().min(1),
	name: z.string().min(1),
	category: z.enum(OP_CARD_CATEGORIES),
	colors: z.array(z.string()),
	cost: z.number().nullable(),
	life: z.number().nullable(),
	power: z.number().nullable(),
	counter: z.number().nullable(),
	types: z.array(z.string()),
	effect: z.string().nullable(),
	trigger: z.string().nullable(),
};

export const bandaiKeeprCardSchema = z.object(cardFields);

export const bandaiKeeprCardPageSchema = z.object({
	items: z.array(bandaiKeeprCardSchema),
	total: z.number().int().nonnegative(),
});

export const bandaiKeeprCardDetailSchema = z.object({
	...cardFields,
	printings: z.array(z.object({
		id: z.string().min(1),
		setId: z.string().min(1),
		kind: z.enum(OP_PRINTING_KINDS),
		rarity: z.string(),
	})),
});

export type BandaiKeeprCard = z.infer<typeof bandaiKeeprCardSchema>;
export type BandaiKeeprCardDetail = z.infer<typeof bandaiKeeprCardDetailSchema>;
