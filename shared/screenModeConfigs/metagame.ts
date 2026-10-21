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

const metagameArchetypeColumnConfigSchema = z.object({
	key: z.enum(METAGAME_ARCHETYPE_COLUMN_KEY_VALUES),
	visible: z.boolean(),
}).strict();

const metagameCardColumnConfigSchema = z.object({
	key: z.enum(METAGAME_CARD_COLUMN_KEY_VALUES),
	visible: z.boolean(),
}).strict();

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
	archetypeColumns: z.array(metagameArchetypeColumnConfigSchema).min(1).max(10),
	cardColumns: z.array(metagameCardColumnConfigSchema).min(1).max(12),

	// Display limits
	limit: z.number().int().min(1).max(500),
	archetypeLimit: z.number().int().min(1).max(500).nullable().optional(),
	maxTableWidth: z.number().int().min(1).nullable().optional(),

	// Pagination
	pageSize: z.number().int().min(1).max(100),
	autoPageEnabled: z.boolean(),
	autoPageIntervalMs: z.number().int().min(3000).max(60000),
	currentPage: z.number().int().min(1).optional(),
	rotationAnchor: z.number().int().nonnegative().optional(),

	// Visibility toggles
	showHeader: z.boolean(),
	headerText: z.string().max(200).optional(),

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
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	showHeader: true,
	headerText: undefined,
	animateEntries: true,
});

export type MetagameModeConfig = ScreenModeConfigOf<typeof metagameModeConfigContract>;
export type MetagameArchetypeColumnConfig = MetagameModeConfig['archetypeColumns'][number];
export type MetagameCardColumnConfig = MetagameModeConfig['cardColumns'][number];
