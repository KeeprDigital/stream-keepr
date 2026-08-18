import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { eventTalents } from '~~/server/db/schema';
import { normalizeSocialProfileInput, SocialProfileInputError } from '~~/shared/socialProfiles';

const SOCIAL_PROFILE_COLUMN_OMIT = {
	twitchHandle: true,
	youtubeHandle: true,
	xHandle: true,
	instagramHandle: true,
	tiktokHandle: true,
	blueskyHandle: true,
} as const;

function socialProfileField(network: Parameters<typeof normalizeSocialProfileInput>[0]) {
	return z.string().transform((value, context) => {
		try {
			return normalizeSocialProfileInput(network, value);
		}
		catch (error) {
			context.addIssue({
				code: 'custom',
				message: error instanceof SocialProfileInputError ? error.message : 'Invalid Social Profile',
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
	})
	.extend({
		name: z.string().min(1).max(200),
		socialProfiles: socialProfilesInputSchema.optional(),
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
	})
	.extend({
		name: z.string().min(1).max(200).optional(),
		socialProfiles: socialProfilesInputSchema.optional(),
	})
	.strict();

// ROUTE PARAMS
export const talentParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	talentId: z.coerce.number().int().positive(),
});

/* TYPES */
export type CreateTalentInput = z.infer<typeof createTalentSchema>;
export type UpdateTalentInput = z.infer<typeof updateTalentSchema>;
export type TalentParams = z.infer<typeof talentParamsSchema>;
