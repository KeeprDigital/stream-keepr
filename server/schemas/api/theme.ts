import { z } from 'zod';

const themeName = z.string().trim().min(1).max(100);

export const themeParamsSchema = z.object({
	themeId: z.string().min(1).max(100),
});

/** A token's name as a path segment: a vocabulary spelling, which a former token may still hold. */
export const themeTokenParamsSchema = themeParamsSchema.extend({
	token: z.string().regex(/^[a-z0-9][a-z0-9.-]*$/).max(100),
});

export const createThemeSchema = z.object({
	name: themeName,
}).strict();

export const renameThemeSchema = z.object({
	name: themeName,
}).strict();

/** The value is checked against the token's type by the library, which knows the vocabulary. */
export const setThemeTokenSchema = z.object({
	value: z.unknown().refine(value => value !== undefined, 'A value is required'),
}).strict();
