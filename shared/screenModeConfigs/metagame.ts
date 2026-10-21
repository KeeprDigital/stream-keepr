import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	METAGAME_ARCHETYPE_COLUMN_KEY_VALUES,
	METAGAME_CARD_COLUMN_KEY_VALUES,
	METAGAME_CARD_SORT_BY_VALUES,
	METAGAME_SCOPE_VALUES,
	METAGAME_SORT_BY_VALUES,
	METAGAME_VIEW_MODE_VALUES,
} from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { columnConfigSchema, DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, pageRotationShape } from './subShapes';

/** The Metagame Screen Mode's config contract: its shape, type, and defaults. */
export const metagameModeConfigContract = defineScreenModeConfigContract({
	// View selection
	viewMode: z.enum(METAGAME_VIEW_MODE_VALUES),

	// Scoping
	scope: z.enum(METAGAME_SCOPE_VALUES),
	topN: z.number().int().min(1).max(500),
	minPoints: z.number().int().min(0).max(999),
	playerListId: z.number().int().positive().optional(),
	archetypeFilter: z.string().max(200).optional(),

	// Sorting
	sortBy: z.enum(METAGAME_SORT_BY_VALUES),
	cardSortBy: z.enum(METAGAME_CARD_SORT_BY_VALUES),

	// Column configuration (ordered arrays — order = display order)
	archetypeColumns: z.array(columnConfigSchema(METAGAME_ARCHETYPE_COLUMN_KEY_VALUES)).min(1).max(10),
	cardColumns: z.array(columnConfigSchema(METAGAME_CARD_COLUMN_KEY_VALUES)).min(1).max(12),

	// Display limits
	limit: z.number().int().min(1).max(500),
	archetypeLimit: z.number().int().min(1).max(500).nullable().optional(),
	maxTableWidth: z.number().int().min(1).nullable().optional(),

	// Pagination
	pageSize: z.number().int().min(1).max(100),
	...pageRotationShape,

	// Visibility toggles
	...headerConfigShape,

	// Animation
	animateEntries: z.boolean(),
}, {
	viewMode: 'archetype',
	scope: 'all',
	topN: 8,
	minPoints: 9,
	playerListId: undefined,
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
	maxTableWidth: undefined,
	pageSize: 10,
	...DEFAULT_PAGE_ROTATION,
	...DEFAULT_HEADER_CONFIG,
	animateEntries: true,
});

export type MetagameModeConfig = ScreenModeConfigOf<typeof metagameModeConfigContract>;
export type MetagameArchetypeColumnConfig = MetagameModeConfig['archetypeColumns'][number];
export type MetagameCardColumnConfig = MetagameModeConfig['cardColumns'][number];
