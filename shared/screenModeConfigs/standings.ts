import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	REVEAL_ORDER_VALUES,
	STANDINGS_COLUMN_KEY_VALUES,
	STANDINGS_VIEW_MODE_VALUES,
} from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField, withEditorMeta } from './fields';
import { columnConfigSchema, DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, isColumnVisible, pageRotationPageSize, pageRotationShape, tableMaxWidthField } from './subShapes';

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
	viewMode: editorField(z.enum(STANDINGS_VIEW_MODE_VALUES), {
		label: 'View',
		card: 'source',
		description: 'Which Players the standings show.',
		options: {
			all: 'All',
			range: 'Position range',
			watchlist: 'Watchlist',
			reveal: 'Reveal',
		},
	}),

	// Column configuration (ordered array — order = display order)
	columns: editorField(z.array(columnConfigSchema(STANDINGS_COLUMN_KEY_VALUES)).min(1).max(10), {
		label: 'Columns',
		card: 'content',
		group: 'table',
		slot: 'columns',
		description: 'Drag to reorder, toggle to show or hide.',
		options: {
			position: '#',
			name: 'Name',
			record: 'Record (W-L-D)',
			points: 'Points',
			deck: 'Deck',
			positionChange: 'Position change',
		},
	}),
	showArchetypeColors: editorField(z.boolean(), {
		label: 'Show archetype colours',
		card: 'content',
		group: 'table',
		description: 'Show mana colours after the archetype name in the deck column.',
		showWhen: ({ config }) => isColumnVisible(config.columns ?? [], 'deck'),
	}),
	roundId: editorField(z.number().int().positive().optional(), {
		label: 'Round',
		card: 'source',
		reference: 'round',
		placeholder: 'Current standings',
		description: 'Show the current standings, or a completed Round\'s.',
	}),

	// The widest the table runs, centred, in Event Canvas pixels. Absent is Auto: it fills its Screen.
	maxWidth: tableMaxWidthField('table'),

	// Header
	...headerConfigShape({
		shows: 'Show the standings header above the table.',
		auto: 'Empty shows a title for the view.',
	}),

	// Range mode: the positions shown, both ends included
	rangeStart: editorField(z.number().int().min(1).max(9999), {
		label: 'First position',
		card: 'source',
		description: '1 shows from the top.',
		showWhen: ({ config }) => config.viewMode === 'range',
	}),
	rangeEnd: editorField(z.number().int().min(1).max(9999), {
		label: 'Last position',
		card: 'source',
		showWhen: ({ config }) => config.viewMode === 'range',
	}),

	// Watchlist mode
	playerListId: editorField(z.number().int().positive().optional(), {
		label: 'Player List',
		card: 'source',
		reference: 'playerList',
		description: 'Show the standings of this list\'s Players.',
		showWhen: ({ config }) => config.viewMode === 'watchlist',
	}),

	// Reveal mode
	revealCount: editorField(z.number().int().min(1).max(64), {
		label: 'Players to reveal',
		card: 'content',
		group: 'reveal',
	}),
	revealOrder: editorField(z.enum(REVEAL_ORDER_VALUES), {
		label: 'Reveal order',
		card: 'content',
		group: 'reveal',
		options: { bottomUp: 'Bottom up', topDown: 'Top down' },
	}),
	/** How many Players the reveal has shown: live state the Live card's reveal controls advance and reset. */
	revealedCount: editorField(z.number().int().nonnegative().max(64), {
		label: 'Revealed',
		card: 'live',
		slot: 'reveal',
		showWhen: ({ config }) => config.viewMode === 'reveal',
	}),

	// Pagination
	rowsPerPage: withEditorMeta(pageRotationPageSize, { description: 'Players on each page.' }),
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
	maxWidth: undefined,
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
	// The rows' motion is the mode's Mode Token (#851). The width the table once held
	// as `maxTableWidth` is not read back: its `maxWidth` starts at Auto (#1081).
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
	groups: {
		// Its controls, and the reveal motion in its Look, apply to the reveal view alone (ADR-0072).
		reveal: {
			title: 'Reveal',
			card: 'content',
			showWhen: ({ config }) => config.viewMode === 'reveal',
		},
		table: { title: 'Table', card: 'content' },
	},
});

export type StandingsModeConfig = ScreenModeConfigOf<typeof standingsModeConfigContract>;
export type StandingsColumnConfig = StandingsModeConfig['columns'][number];
