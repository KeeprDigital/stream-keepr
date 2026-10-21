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

/** A badge colour: any CSS colour, as the server's other colour fields take. */
const optionalCssColorSchema = z.string().min(1).max(500).optional();

/**
 * The Top Cards Screen Mode's config contract: a ranked grid of the most played
 * cards in the event's metagame, rendered as card images the way the Deck Screen
 * renders a deck. Scoping reuses the Metagame vocabulary; `excludedCardTypes` is
 * applied server-side before `limit`, so a filtered top N still fills N slots.
 */
export const topCardsModeConfigContract = defineScreenModeConfigContract({
	// Scoping (same vocabulary as the Metagame mode)
	scope: z.enum(METAGAME_SCOPE_VALUES),
	topN: z.number().int().min(1).max(500),
	playerListId: z.number().int().positive().optional(),
	archetypeFilter: z.string().max(200).optional(),

	// Data selection & filtering
	board: z.enum(BOARD_SELECTION_VALUES),
	sortBy: z.enum(METAGAME_CARD_SORT_BY_VALUES),
	limit: z.number().int().min(1).max(60),
	excludedCardTypes: z.array(z.enum(CARD_TYPE_BUCKET_ORDER)).max(CARD_TYPE_BUCKET_ORDER.length),

	// Grid layout
	columns: z.number().int().min(1).max(12),
	cardSize: z.enum(DECK_CARD_SIZE_VALUES),
	dynamicCardSize: z.boolean(),
	cardGap: z.number().int().min(0).max(100),

	// Header
	showHeader: z.boolean(),
	headerText: z.string().max(200).optional(),

	// Card labels & badges
	showCardNames: z.boolean(),
	showRankBadges: z.boolean(),
	rankBadgeTextColor: optionalCssColorSchema,
	rankBadgeBgColor: optionalCssColorSchema,
	/** Which metric the stat badge shows; 'none' hides the badge. */
	statBadge: z.enum(TOP_CARDS_STAT_VALUES),
	statBadgeSize: z.enum(QUANTITY_SIZE_VALUES).optional(),
	statBadgeTextColor: optionalCssColorSchema,
	statBadgeBgColor: optionalCssColorSchema,
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
	showHeader: true,
	headerText: undefined,
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
