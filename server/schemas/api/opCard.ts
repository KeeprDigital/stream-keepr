import { z } from 'zod';
import { OP_CARD_CATEGORIES, OP_CARD_COLORS } from '~~/shared/types/card/op';
import { parseOpCardNumber } from '~~/shared/utils/card/op';

const opCardNumberSchema = z.string().transform((value, context) => {
	const number = parseOpCardNumber(value);
	if (number === null) {
		context.addIssue({ code: 'custom', message: 'Not a card number' });
		return z.NEVER;
	}
	return number;
});

/** A One Piece card search: by name or text, or by card number, narrowed by colour and category. */
export const opCardSearchQuerySchema = z.object({
	q: z.string().trim().min(1).max(200).optional(),
	number: opCardNumberSchema.optional(),
	color: z.union([
		z.enum(OP_CARD_COLORS),
		z.array(z.enum(OP_CARD_COLORS)).max(OP_CARD_COLORS.length),
	])
		.transform(value => Array.isArray(value)
			? value
			: [value])
		.optional(),
	category: z.enum(OP_CARD_CATEGORIES).optional(),
	limit: z.coerce.number().int().min(1).max(250).default(60),
	offset: z.coerce.number().int().min(0).default(0),
});

export const opCardParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	number: opCardNumberSchema,
});

export type OpCardSearchQuery = z.infer<typeof opCardSearchQuerySchema>;
