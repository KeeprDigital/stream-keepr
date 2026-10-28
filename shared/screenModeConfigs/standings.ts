import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	REVEAL_ORDER_VALUES,
	REVEAL_TRIGGER_VALUES,
	STANDINGS_COLUMN_KEY_VALUES,
	STANDINGS_VIEW_MODE_VALUES,
} from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { columnConfigSchema, DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, pageRotationPageSize, pageRotationShape } from './subShapes';

/** The Standings Screen Mode's config contract: its shape, type, and defaults. */
export const standingsModeConfigContract = defineScreenModeConfigContract({
	// View mode
	viewMode: editorField(z.enum(STANDINGS_VIEW_MODE_VALUES), { label: 'Mode' }),

	// Column configuration (ordered array — order = display order)
	columns: z.array(columnConfigSchema(STANDINGS_COLUMN_KEY_VALUES)).min(1).max(10),
	showArchetypeColors: editorField(z.boolean(), { label: 'Show Archetype Colors' }),
	roundId: z.number().int().positive().optional(),

	// Header
	...headerConfigShape,

	// Top N mode
	topNCount: editorField(z.number().int().min(1).max(500), { label: 'Number of players' }),

	// Slice mode
	sliceStart: editorField(z.number().int().min(1).max(9999), { label: 'Start position' }),
	sliceEnd: editorField(z.number().int().min(1).max(9999), { label: 'End position' }),

	// Watchlist mode
	playerListId: z.number().int().positive().optional(),

	// Reveal mode
	revealCount: editorField(z.number().int().min(1).max(64), { label: 'Players to reveal' }),
	revealOrder: editorField(z.enum(REVEAL_ORDER_VALUES), { label: 'Reveal order' }),
	revealTrigger: z.enum(REVEAL_TRIGGER_VALUES),
	revealIntervalMs: z.number().int().min(1000).max(30000),
	revealedCount: z.number().int().nonnegative().max(64),

	// Pagination
	rowsPerPage: pageRotationPageSize,
	...pageRotationShape,
}, {
	viewMode: 'all',
	columns: [
		{ key: 'position', visible: true },
		{ key: 'name', visible: true },
		{ key: 'record', visible: true },
		{ key: 'points', visible: true },
		{ key: 'deck', visible: false },
		{ key: 'positionChange', visible: false },
	],
	showArchetypeColors: false,
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
}, {
	// The table's width and its rows' motion are the mode's Mode Tokens (#851).
	formerFields: ['maxTableWidth', 'animateEntries'],
});

export type StandingsModeConfig = ScreenModeConfigOf<typeof standingsModeConfigContract>;
export type StandingsColumnConfig = StandingsModeConfig['columns'][number];
