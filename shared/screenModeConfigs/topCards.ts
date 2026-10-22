import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	BOARD_SELECTION_VALUES,
	DECK_CARD_SIZE_VALUES,
	METAGAME_CARD_SORT_BY_VALUES,
	METAGAME_SCOPE_VALUES,
	QUANTITY_SIZE_VALUES,
	TOP_CARDS_STAT_VALUES,
} from '../types/enums';
import { CARD_TYPE_BUCKET_ORDER } from '../utils/metagame';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { DEFAULT_HEADER_CONFIG, DEFAULT_PAGE_ROTATION, headerConfigShape, pageRotationPageSize, pageRotationShape } from './subShapes';

/** A badge colour: any CSS colour, as the server's other colour fields take. */
const optionalCssColorSchema = z.string().min(1).max(500).optional();

/** The most cards a Top Cards Screen ranks. */
const TOP_CARDS_MAX_LIMIT = 60;

/**
 * The Top Cards Screen Mode's config contract: a ranked grid of the most played
 * cards in the event's metagame, rendered as card images the way the Deck Screen
 * renders a deck. Scoping reuses the Metagame vocabulary; `excludedCardTypes` is
 * applied server-side before `limit`, so a filtered top N still fills N slots.
 *
 * Its Page Rotation pages the grid by whole grid rows: `rowsPerPage` rows of
 * `columns` cards each. The default holds the most cards a Screen can rank in
 * one column, so a Screen that never set it shows every card on one page.
 */
export const topCardsModeConfigContract = defineScreenModeConfigContract({
	// Scoping (same vocabulary as the Metagame mode)
	scope: editorField(z.enum(METAGAME_SCOPE_VALUES), { label: 'Player scope' }),
	topN: editorField(z.number().int().min(1).max(500), { label: 'Top N' }),
	playerListId: z.number().int().positive().optional(),
	archetypeFilter: editorField(z.string().max(200).optional(), { label: 'Archetype filter' }),

	// Data selection & filtering
	board: editorField(z.enum(BOARD_SELECTION_VALUES), { label: 'Board' }),
	sortBy: editorField(z.enum(METAGAME_CARD_SORT_BY_VALUES), { label: 'Rank by' }),
	limit: editorField(z.number().int().min(1).max(TOP_CARDS_MAX_LIMIT), { label: 'Card count' }),
	excludedCardTypes: z.array(z.enum(CARD_TYPE_BUCKET_ORDER)).max(CARD_TYPE_BUCKET_ORDER.length),

	// Grid layout
	columns: editorField(z.number().int().min(1).max(12), { label: 'Columns' }),
	cardSize: editorField(z.enum(DECK_CARD_SIZE_VALUES), { label: 'Card size' }),
	dynamicCardSize: editorField(z.boolean(), { label: 'Dynamic card size' }),
	cardGap: editorField(z.number().int().min(0).max(100), { label: 'Card gap' }),

	// Pagination: grid rows per page
	rowsPerPage: pageRotationPageSize,
	...pageRotationShape,

	// Header
	...headerConfigShape,

	// Card labels & badges
	showCardNames: editorField(z.boolean(), { label: 'Show card names' }),
	showRankBadges: editorField(z.boolean(), { label: 'Show rank badges' }),
	rankBadgeTextColor: editorField(optionalCssColorSchema, { label: 'Rank badge text color', control: 'color' }),
	rankBadgeBgColor: editorField(optionalCssColorSchema, { label: 'Rank badge background color', control: 'color' }),
	/** Which metric the stat badge shows; 'none' hides the badge. */
	statBadge: editorField(z.enum(TOP_CARDS_STAT_VALUES), { label: 'Stat badge' }),
	statBadgeSize: editorField(z.enum(QUANTITY_SIZE_VALUES).optional(), { label: 'Badge size' }),
	statBadgeTextColor: editorField(optionalCssColorSchema, { label: 'Stat badge text color', control: 'color' }),
	statBadgeBgColor: editorField(optionalCssColorSchema, { label: 'Stat badge background color', control: 'color' }),
}, {
	scope: 'all',
	topN: 8,
	playerListId: undefined,
	archetypeFilter: undefined,
	board: 'mainboard',
	sortBy: 'inclusionRate',
	limit: 10,
	// Nonbasic lands read as noise in a "most played" ranking; basics never
	// reach the breakdown at all.
	excludedCardTypes: ['Land'],
	columns: 5,
	cardSize: 'medium',
	dynamicCardSize: true,
	cardGap: 12,
	rowsPerPage: TOP_CARDS_MAX_LIMIT,
	...DEFAULT_PAGE_ROTATION,
	...DEFAULT_HEADER_CONFIG,
	showCardNames: true,
	showRankBadges: true,
	rankBadgeTextColor: '#ffffff',
	rankBadgeBgColor: '#7c3aed',
	statBadge: 'inclusionRate',
	statBadgeSize: 'medium',
	statBadgeTextColor: '#111827',
	statBadgeBgColor: '#ffffff',
});

export type TopCardsModeConfig = ScreenModeConfigOf<typeof topCardsModeConfigContract>;
