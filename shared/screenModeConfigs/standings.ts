import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	REVEAL_ORDER_VALUES,
	STANDINGS_COLUMN_KEY_VALUES,
	STANDINGS_VIEW_MODE_VALUES,
} from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { columnConfigSchema, DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, pageRotationPageSize, pageRotationShape } from './subShapes';

/** What the Top N count read as while a Screen stored none. */
const FORMER_TOP_N_COUNT_DEFAULT = 8;

/**
 * A fragment written while Standings held a Top N count and a slice pair, as
 * the one position range (#1080): the slice pair is the range under its former
 * name, and the Top N view is the range 1 to N. A count sent alone, as the Top N
 * view's editor sent it, is that range too. A count stored beside another view
 * showed nothing and is left to be dropped.
 */
function upgradeToPositionRange(fragment: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const { viewMode, topNCount, sliceStart, sliceEnd } = fragment;
	const namesSlice = 'sliceStart' in fragment || 'sliceEnd' in fragment;
	const namesRange = 'rangeStart' in fragment || 'rangeEnd' in fragment;
	const countAlone = !('viewMode' in fragment) && typeof topNCount === 'number' && !namesSlice && !namesRange;
	if (viewMode !== 'topN' && viewMode !== 'slice' && !namesSlice && !countAlone)
		return fragment;

	const { topNCount: _count, sliceStart: _start, sliceEnd: _end, ...upgraded }: Record<string, unknown> = fragment;
	if ('sliceStart' in fragment && !('rangeStart' in fragment))
		upgraded.rangeStart = sliceStart;
	if ('sliceEnd' in fragment && !('rangeEnd' in fragment))
		upgraded.rangeEnd = sliceEnd;
	if (viewMode === 'topN' || countAlone) {
		upgraded.rangeStart = 1;
		upgraded.rangeEnd = typeof topNCount === 'number'
			? topNCount
			: FORMER_TOP_N_COUNT_DEFAULT;
	}
	if (viewMode === 'topN' || viewMode === 'slice')
		upgraded.viewMode = 'range';
	return upgraded;
}

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

	// Range mode: the positions shown, both ends included
	rangeStart: editorField(z.number().int().min(1).max(9999), { label: 'First position' }),
	rangeEnd: editorField(z.number().int().min(1).max(9999), { label: 'Last position' }),

	// Watchlist mode
	playerListId: z.number().int().positive().optional(),

	// Reveal mode
	revealCount: editorField(z.number().int().min(1).max(64), { label: 'Players to reveal' }),
	revealOrder: editorField(z.enum(REVEAL_ORDER_VALUES), { label: 'Reveal order' }),
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
	rangeStart: 1,
	rangeEnd: 16,
	playerListId: undefined,
	revealCount: 8,
	revealOrder: 'bottomUp',
	revealedCount: 0,
	rowsPerPage: 8,
	...DEFAULT_PAGE_ROTATION,
}, {
	// The table's width and its rows' motion are the mode's Mode Tokens (#851).
	// Reveal's trigger and interval were never read (#1064): the operator's `revealedCount` advances it.
	// The Top N count and the slice pair became the one position range (#1080).
	formerFields: [
		'maxTableWidth',
		'animateEntries',
		'revealTrigger',
		'revealIntervalMs',
		'topNCount',
		'sliceStart',
		'sliceEnd',
	],
	upgradeFormerFields: upgradeToPositionRange,
});

export type StandingsModeConfig = ScreenModeConfigOf<typeof standingsModeConfigContract>;
export type StandingsColumnConfig = StandingsModeConfig['columns'][number];
