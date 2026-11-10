import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { eventTalents } from '~~/server/db/schema';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';
import { graphicAssetReferenceSchema } from '~~/shared/modules/theme/background';
import { normalizeSocialProfileInput, SocialProfileInputError } from '~~/shared/socialProfiles';

const SOCIAL_PROFILE_COLUMN_OMIT = {
	twitchHandle: true,
	youtubeHandle: true,
	xHandle: true,
	instagramHandle: true,
	tiktokHandle: true,
	blueskyHandle: true,
} as const;

/** A photo is library content the write indexes, never a column a client sets directly. */
const PHOTO_COLUMN_OMIT = {
	photo: true,
	graphicAssetReferenceVersion: true,
} as const;

/** One exact image revision, or `null` for none (ADR-0067). */
const photoField = graphicAssetReferenceSchema.nullable().optional();

/** Free text such as "Host" or "Commentator"; blank stores none (#782). */
const roleField = z.string().max(100).nullable().optional().transform(role => role === undefined
	? undefined
	: role?.trim() || null);

function socialProfileField(network: Parameters<typeof normalizeSocialProfileInput>[0]) {
	return z.string().transform((value, context) => {
		try {
			return normalizeSocialProfileInput(network, value);
		}
		catch (error) {
			context.addIssue({
				code: 'custom',
				message: error instanceof SocialProfileInputError
					? error.message
					: 'Invalid Social Profile',
			});
			return z.NEVER;
		}
	}).optional();
}

export const socialProfilesInputSchema = z.object({
	twitch: socialProfileField('twitch'),
	youtube: socialProfileField('youtube'),
	x: socialProfileField('x'),
	instagram: socialProfileField('instagram'),
	tiktok: socialProfileField('tiktok'),
	bluesky: socialProfileField('bluesky'),
}).strict().transform(profiles => Object.fromEntries(
	Object.entries(profiles).filter((entry): entry is [string, string] => entry[1] !== undefined),
));

// CREATE
export const createTalentSchema = createInsertSchema(eventTalents)
	.omit({
		id: true,
		createdAt: true,
		updatedAt: true,
		eventId: true,
		...SOCIAL_PROFILE_COLUMN_OMIT,
		...PHOTO_COLUMN_OMIT,
	})
	.extend({
		name: z.string().min(1).max(200),
		role: roleField,
		socialProfiles: socialProfilesInputSchema.optional(),
		photo: photoField,
	})
	.strict();

// UPDATE
export const updateTalentSchema = createUpdateSchema(eventTalents)
	.omit({
		id: true,
		createdAt: true,
		updatedAt: true,
		eventId: true,
		...SOCIAL_PROFILE_COLUMN_OMIT,
		...PHOTO_COLUMN_OMIT,
	})
	.extend({
		name: z.string().min(1).max(200).optional(),
		role: roleField,
		socialProfiles: socialProfilesInputSchema.optional(),
		photo: photoField,
	})
	.strict();

// ROUTE PARAMS
export const talentParamsSchema = z.object({
	id: eventIdParamSchema,
	talentId: z.coerce.number().int().positive(),
});

/* TYPES */
export type CreateTalentInput = z.infer<typeof createTalentSchema>;
export type UpdateTalentInput = z.infer<typeof updateTalentSchema>;
export type TalentParams = z.infer<typeof talentParamsSchema>;
