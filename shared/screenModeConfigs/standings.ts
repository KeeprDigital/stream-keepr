import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	REVEAL_ORDER_VALUES,
	REVEAL_TRIGGER_VALUES,
	STANDINGS_COLUMN_KEY_VALUES,
	STANDINGS_VIEW_MODE_VALUES,
} from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { columnConfigSchema, DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, pageRotationPageSize, pageRotationShape } from './subShapes';

/** The Standings Screen Mode's config contract: its shape, type, and defaults. */
export const standingsModeConfigContract = defineScreenModeConfigContract({
	// View mode
	viewMode: z.enum(STANDINGS_VIEW_MODE_VALUES),

	// Column configuration (ordered array — order = display order)
	columns: z.array(columnConfigSchema(STANDINGS_COLUMN_KEY_VALUES)).min(1).max(10),
	showArchetypeColors: z.boolean(),
	maxTableWidth: z.number().int().positive().optional(),
	roundId: z.number().int().positive().optional(),

	// Header
	...headerConfigShape,

	// Top N mode
	topNCount: z.number().int().min(1).max(500),

	// Slice mode
	sliceStart: z.number().int().min(1).max(9999),
	sliceEnd: z.number().int().min(1).max(9999),

	// Watchlist mode
	playerListId: z.number().int().positive().optional(),

	// Reveal mode
	revealCount: z.number().int().min(1).max(64),
	revealOrder: z.enum(REVEAL_ORDER_VALUES),
	revealTrigger: z.enum(REVEAL_TRIGGER_VALUES),
	revealIntervalMs: z.number().int().min(1000).max(30000),
	revealedCount: z.number().int().nonnegative().max(64),

	// Pagination
	rowsPerPage: pageRotationPageSize,
	...pageRotationShape,

	// Animation
	animateEntries: z.boolean(),
}, {
	viewMode: 'all',
	columns: [
		{ key: 'position', visible: true },
		{ key: 'name', visible: true },
		{ key: 'record', visible: true },
		{ key: 'points', visible: true },
		{ key: 'deck', visible: false },
	],
	showArchetypeColors: false,
	maxTableWidth: undefined,
	roundId: undefined,
	...DEFAULT_HEADER_CONFIG,
	topNCount: 8,
	sliceStart: 1,
	sliceEnd: 16,
	playerListId: undefined,
	revealCount: 8,
	revealOrder: 'bottomUp',
	revealTrigger: 'manual',
	revealIntervalMs: 5000,
	revealedCount: 0,
	rowsPerPage: 8,
	...DEFAULT_PAGE_ROTATION,
	animateEntries: true,
});

export type StandingsModeConfig = ScreenModeConfigOf<typeof standingsModeConfigContract>;
export type StandingsColumnConfig = StandingsModeConfig['columns'][number];
