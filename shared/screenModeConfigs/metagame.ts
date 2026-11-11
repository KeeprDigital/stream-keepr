import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	METAGAME_ARCHETYPE_COLUMN_KEY_VALUES,
	METAGAME_CARD_COLUMN_KEY_VALUES,
	METAGAME_CARD_SORT_BY_VALUES,
	METAGAME_SORT_BY_VALUES,
	METAGAME_VIEW_MODE_VALUES,
} from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { columnConfigSchema, DEFAULT_HEADER_CONFIG, DEFAULT_METAGAME_SCOPE, DEFAULT_PAGE_ROTATION, headerConfigShape, metagameArchetypeFilterField, metagameScopeShape, pageRotationPageSize, pageRotationShape, tableMaxWidthField } from './subShapes';

/** The Metagame Screen Mode's config contract: its shape, type, and defaults. */
export const metagameModeConfigContract = defineScreenModeConfigContract({
	// View selection
	viewMode: editorField(z.enum(METAGAME_VIEW_MODE_VALUES), { label: 'Display' }),

	// Scoping
	...metagameScopeShape,
	archetypeFilter: metagameArchetypeFilterField,

	// Sorting
	sortBy: editorField(z.enum(METAGAME_SORT_BY_VALUES), { label: 'Sort archetypes by' }),
	cardSortBy: editorField(z.enum(METAGAME_CARD_SORT_BY_VALUES), { label: 'Sort cards by' }),

	// Column configuration (ordered arrays — order = display order)
	archetypeColumns: z.array(columnConfigSchema(METAGAME_ARCHETYPE_COLUMN_KEY_VALUES)).min(1).max(10),
	cardColumns: z.array(columnConfigSchema(METAGAME_CARD_COLUMN_KEY_VALUES)).min(1).max(12),

	// Display limits
	limit: editorField(z.number().int().min(1).max(500), { label: 'Card limit' }),
	archetypeLimit: editorField(z.number().int().min(1).max(500).nullable().optional(), { label: 'Top archetypes' }),

	// The widest the table or chart runs, centred, in Event Canvas pixels. Absent is Auto: it fills its Screen.
	maxWidth: tableMaxWidthField,

	// Pagination
	pageSize: pageRotationPageSize,
	...pageRotationShape,

	// Visibility toggles
	...headerConfigShape,
}, {
	viewMode: 'archetype',
	...DEFAULT_METAGAME_SCOPE,
	archetypeFilter: undefined,
	sortBy: 'metaShare',
	cardSortBy: 'inclusionRate',
	archetypeColumns: [
		{ key: 'archetype', visible: true },
		{ key: 'count', visible: true },
		{ key: 'metaShare', visible: true },
		{ key: 'winRate', visible: true },
		{ key: 'avgPlace', visible: false },
		{ key: 'colors', visible: false },
		{ key: 'conversionRate', visible: false },
	],
	cardColumns: [
		{ key: 'card', visible: true },
		{ key: 'manaCost', visible: true },
		{ key: 'type', visible: true },
		{ key: 'inclusionRate', visible: true },
		{ key: 'avgCopies', visible: true },
		{ key: 'totalCopies', visible: true },
		{ key: 'deckCount', visible: true },
		{ key: 'mainboardCount', visible: true },
		{ key: 'sideboardCount', visible: true },
	],
	limit: 50,
	archetypeLimit: null,
	maxWidth: undefined,
	pageSize: 10,
	...DEFAULT_PAGE_ROTATION,
	...DEFAULT_HEADER_CONFIG,
}, {
	// The rows' motion is the mode's Mode Token (#851). The width the table once held
	// as `maxTableWidth` is not read back: its `maxWidth` starts at Auto (#1081).
	// The Conversion Target is the Event's (ADR-0061).
	formerFields: [
		'maxTableWidth',
		'animateEntries',
		'conversionMetric',
		'conversionThreshold',
	],
});

export type MetagameModeConfig = ScreenModeConfigOf<typeof metagameModeConfigContract>;
export type MetagameArchetypeColumnConfig = MetagameModeConfig['archetypeColumns'][number];
export type MetagameCardColumnConfig = MetagameModeConfig['cardColumns'][number];
