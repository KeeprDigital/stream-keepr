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
import { editorField } from './fields';
import { columnConfigSchema, DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, pageRotationPageSize, pageRotationShape } from './subShapes';

/** The Metagame Screen Mode's config contract: its shape, type, and defaults. */
export const metagameModeConfigContract = defineScreenModeConfigContract({
	// View selection
	viewMode: editorField(z.enum(METAGAME_VIEW_MODE_VALUES), { label: 'Display' }),

	// Scoping
	scope: editorField(z.enum(METAGAME_SCOPE_VALUES), { label: 'Player scope' }),
	topN: editorField(z.number().int().min(1).max(500), { label: 'Top N' }),
	minPoints: editorField(z.number().int().min(0).max(999), { label: 'Minimum points' }),
	playerListId: z.number().int().positive().optional(),
	archetypeFilter: editorField(z.string().max(200).optional(), { label: 'Archetype filter' }),

	// Sorting
	sortBy: editorField(z.enum(METAGAME_SORT_BY_VALUES), { label: 'Sort archetypes by' }),
	cardSortBy: editorField(z.enum(METAGAME_CARD_SORT_BY_VALUES), { label: 'Sort cards by' }),

	// Column configuration (ordered arrays — order = display order)
	archetypeColumns: z.array(columnConfigSchema(METAGAME_ARCHETYPE_COLUMN_KEY_VALUES)).min(1).max(10),
	cardColumns: z.array(columnConfigSchema(METAGAME_CARD_COLUMN_KEY_VALUES)).min(1).max(12),

	// Display limits
	limit: editorField(z.number().int().min(1).max(500), { label: 'Card limit' }),
	archetypeLimit: editorField(z.number().int().min(1).max(500).nullable().optional(), { label: 'Top archetypes' }),
	maxTableWidth: editorField(z.number().int().min(1).nullable().optional(), { label: 'Max table width' }),

	// Pagination
	pageSize: pageRotationPageSize,
	...pageRotationShape,

	// Visibility toggles
	...headerConfigShape,

	// Animation
	animateEntries: editorField(z.boolean(), { label: 'Animate entries' }),
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
