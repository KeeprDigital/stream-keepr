import { z } from 'zod';
import { editorField } from './fields';

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

/** Whether a table mode's column list shows the column `key`. */
export function isColumnVisible<Key extends string>(
	columns: ReadonlyArray<{ key: Key; visible: boolean }>,
	key: Key,
): boolean {
	return columns.some(column => column.key === key && column.visible);
}

/**
 * A stored column list as its editor offers it, with every column its mode
 * offers: each of the mode's default columns it lacks is appended hidden, in the
 * defaults' order. A column added to a mode after a Screen stored its list is not
 * stored, so it renders as before, hidden; its editor offers it hidden too, and
 * the operator's first show, hide or reorder stores it. A complete list is
 * returned as it is.
 */
export function withEveryColumn<Column extends { key: string; visible: boolean }>(
	columns: readonly Column[],
	defaultColumns: readonly Column[],
): Column[] {
	const held = new Set(columns.map(column => column.key));
	const missing = defaultColumns.filter(column => !held.has(column.key));
	if (missing.length === 0)
		return columns as Column[];
	return [...columns, ...missing.map(column => ({ ...column, visible: false }))];
}

/** The optional header above a mode's content. */
export const headerConfigShape = {
	showHeader: editorField(z.boolean(), { label: 'Show header' }),
	headerText: editorField(z.string().max(200).optional(), { label: 'Custom header text' }),
};

export const DEFAULT_HEADER_CONFIG = {
	showHeader: true,
	headerText: undefined,
} as const;

/**
 * A paginated mode's Page Rotation: `currentPage` is the manually selected page
 * (auto-page off); `rotationAnchor` is the rotation's epoch (auto-page on),
 * written only by operator surfaces and projected against server time by every
 * rendering. How many rows a page holds is a field the mode names itself, which
 * its Screen Mode Definition declares (`pageRotation`), validated by
 * `pageRotationPageSize`.
 */
export const pageRotationShape = {
	autoPageEnabled: editorField(z.boolean(), { label: 'Auto-page' }),
	autoPageIntervalMs: editorField(z.number().int().min(3000).max(60000), { label: 'Interval (seconds)', displayScale: 1000 }),
	currentPage: z.number().int().min(1).optional(),
	rotationAnchor: z.number().int().nonnegative().optional(),
};

/** The Page Rotation fields as a paginated mode's config holds them. */
export type PageRotationConfig = z.input<z.ZodObject<typeof pageRotationShape>>;

export const DEFAULT_PAGE_ROTATION = {
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
} as const;

/** How many rows a page of a Page Rotation holds, under whichever name its mode gives the field. */
export const pageRotationPageSize = editorField(z.number().int().min(1).max(100), { label: 'Rows per page' });
