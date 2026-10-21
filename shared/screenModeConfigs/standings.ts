import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	REVEAL_ORDER_VALUES,
	REVEAL_TRIGGER_VALUES,
	STANDINGS_COLUMN_KEY_VALUES,
	STANDINGS_VIEW_MODE_VALUES,
} from '../types/enums';
import { defineScreenModeConfigContract } from './contract';

const standingsColumnConfigSchema = z.object({
	key: z.enum(STANDINGS_COLUMN_KEY_VALUES),
	visible: z.boolean(),
}).strict();

/** The Standings Screen Mode's config contract: its shape, type, and defaults. */
export const standingsModeConfigContract = defineScreenModeConfigContract({
	// View mode
	viewMode: z.enum(STANDINGS_VIEW_MODE_VALUES),

	// Column configuration (ordered array — order = display order)
	columns: z.array(standingsColumnConfigSchema).min(1).max(10),
	showArchetypeColors: z.boolean(),
	maxTableWidth: z.number().int().positive().optional(),
	roundId: z.number().int().positive().optional(),

	// Header
	showHeader: z.boolean(),
	headerText: z.string().max(200).optional(),

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

	// Pagination — currentPage is the manually selected page (auto-page off);
	// rotationAnchor is the Page Rotation's epoch (auto-page on), written only
	// by operator surfaces and projected against server time by every rendering.
	rowsPerPage: z.number().int().min(1).max(100),
	autoPageEnabled: z.boolean(),
	autoPageIntervalMs: z.number().int().min(3000).max(60000),
	currentPage: z.number().int().min(1).optional(),
	rotationAnchor: z.number().int().nonnegative().optional(),

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
	showHeader: true,
	headerText: undefined,
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
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	animateEntries: true,
});

export type StandingsModeConfig = ScreenModeConfigOf<typeof standingsModeConfigContract>;
export type StandingsColumnConfig = StandingsModeConfig['columns'][number];
