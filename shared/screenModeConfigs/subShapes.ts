import { z } from 'zod';

/**
 * Sub-shapes more than one Screen Mode's config contract repeats, so a bound
 * written once holds for every mode that carries the field.
 */

/** One column of a table mode: which it is, and whether it shows. A list of them is ordered as displayed. */
export function columnConfigSchema<const Keys extends readonly [string, ...string[]]>(keys: Keys) {
	return z.object({
		key: z.enum(keys),
		visible: z.boolean(),
	}).strict();
}

/** The optional header above a mode's content. */
export const headerConfigShape = {
	showHeader: z.boolean(),
	headerText: z.string().max(200).optional(),
};

export const DEFAULT_HEADER_CONFIG = {
	showHeader: true,
	headerText: undefined,
} as const;

/**
 * A paginated mode's Page Rotation: `currentPage` is the manually selected page
 * (auto-page off); `rotationAnchor` is the rotation's epoch (auto-page on),
 * written only by operator surfaces and projected against server time by every
 * rendering. How many rows a page holds is the mode's own field.
 */
export const pageRotationShape = {
	autoPageEnabled: z.boolean(),
	autoPageIntervalMs: z.number().int().min(3000).max(60000),
	currentPage: z.number().int().min(1).optional(),
	rotationAnchor: z.number().int().nonnegative().optional(),
};

export const DEFAULT_PAGE_ROTATION = {
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
} as const;
