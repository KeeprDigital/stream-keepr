import type { BoardSelection, QuantityPosition, SideboardPlacement } from '../types/enums';
import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	BOARD_SELECTION_VALUES,
	DECK_BOARD_VIEW_VALUES,
	DECK_CARD_SIZE_VALUES,
	QUANTITY_POSITION_VALUES,
	QUANTITY_SIZE_VALUES,
	SIDEBOARD_PLACEMENT_VALUES,
} from '../types/enums';
import { defineScreenModeConfigContract } from './contract';

const quantityPositionSchema = z.enum(QUANTITY_POSITION_VALUES);
const quantitySizeSchema = z.enum(QUANTITY_SIZE_VALUES);

/**
 * One board's complete layout block. The Mainboard and Sideboard each carry
 * their own (#478): which view renders the board, and the knobs each view
 * reads — grid reads columns/gap/sizing, list reads listColumns, stack reads
 * cardSize and stackOverlap. Visibility is the `board` selection's concern, so a
 * block carries no show/hide of its own.
 */
const deckBoardLayoutConfigSchema = z.object({
	view: z.enum(DECK_BOARD_VIEW_VALUES).optional(),
	columns: z.number().int().min(1).max(20).optional(),
	listColumns: z.number().int().min(1).max(4).optional(),
	cardSize: z.enum(DECK_CARD_SIZE_VALUES).optional(),
	dynamicCardSize: z.boolean().optional(),
	cardGap: z.number().min(0).optional(),
	/** Percentage of each stacked card left visible under the next one. */
	stackOverlap: z.number().min(0).optional(),
}).strict();

export type DeckBoardLayoutConfig = z.output<typeof deckBoardLayoutConfigSchema>;
export type ResolvedDeckBoardLayout = Required<DeckBoardLayoutConfig>;

export const DEFAULT_DECK_BOARD_LAYOUT: ResolvedDeckBoardLayout = {
	view: 'grid',
	columns: 4,
	listColumns: 2,
	cardSize: 'medium',
	dynamicCardSize: false,
	cardGap: 8,
	stackOverlap: 15,
};

const DEFAULT_SIDEBOARD_LAYOUT: ResolvedDeckBoardLayout = {
	...DEFAULT_DECK_BOARD_LAYOUT,
	view: 'stack',
};

/** Where each badge sits on a Deck Screen card until an operator moves it. */
export const DEFAULT_QUANTITY_POSITION: QuantityPosition = 'top-right';
export const DEFAULT_HIGHLANDER_POINTS_POSITION: QuantityPosition = 'top-left';

/** The Deck Screen Mode's config contract: its shape, type, and defaults. */
export const deckModeConfigContract = defineScreenModeConfigContract({
	// The Deck Source (ADR-0032): no Player or one Player, or one Broadcast Deck List.
	deckSource: z.discriminatedUnion('type', [
		z.object({
			type: z.literal('player'),
			playerId: z.number().int().positive().nullable(),
		}).strict(),
		z.object({
			type: z.literal('broadcast'),
			broadcastDeckListId: z.number().int().positive(),
		}).strict(),
	]),
	/** Which boards render (#477). "Both hidden" is impossible by construction. */
	board: z.enum(BOARD_SELECTION_VALUES).optional(),
	/** Where the sideboard sits relative to the mainboard. Read only at `board: 'full'`. */
	sideboardPlacement: z.enum(SIDEBOARD_PLACEMENT_VALUES).optional(),
	mainboard: deckBoardLayoutConfigSchema.optional(),
	sideboard: deckBoardLayoutConfigSchema.optional(),
	showQuantities: z.boolean().optional(),
	showDeckName: z.boolean().optional(),
	showDeckColors: z.boolean().optional(),
	showDeckStats: z.boolean().optional(),
	showDeckMetaPill: z.boolean().optional(),
	deckMetaPillSize: quantitySizeSchema.optional(),
	deckMetaPillTextColor: z.string().max(50).optional(),
	deckMetaPillBgColor: z.string().max(200).optional(),
	deckMetaPillAccentColor: z.string().max(50).optional(),
	deckMetaPillBorderColor: z.string().max(50).optional(),
	showHighlanderTotal: z.boolean().optional(),
	showHighlanderPointedCards: z.boolean().optional(),
	highlanderPointedCardsSize: quantitySizeSchema.optional(),
	highlanderPointedCardsTextColor: z.string().max(50).optional(),
	highlanderPointedCardsBgColor: z.string().max(200).optional(),
	highlanderPointedCardsAccentColor: z.string().max(50).optional(),
	highlanderPointedCardsBorderColor: z.string().max(50).optional(),
	showHighlanderPoints: z.boolean().optional(),
	highlanderPointsPosition: quantityPositionSchema.optional(),
	highlanderPointsSize: quantitySizeSchema.optional(),
	highlanderPointsTextColor: z.string().max(50).optional(),
	highlanderPointsBgColor: z.string().max(50).optional(),

	// Quantity badge customization
	quantityPosition: quantityPositionSchema.optional(),
	quantitySize: quantitySizeSchema.optional(),
	quantityTextColor: z.string().max(50).optional(),
	quantityBgColor: z.string().max(50).optional(),
}, {
	deckSource: { type: 'player', playerId: null },
	board: 'full',
	sideboardPlacement: 'beside',
	mainboard: { ...DEFAULT_DECK_BOARD_LAYOUT },
	sideboard: { ...DEFAULT_SIDEBOARD_LAYOUT },
	showQuantities: true,
	showDeckName: true,
	showDeckColors: true,
	showDeckStats: false,
	showDeckMetaPill: true,
	deckMetaPillSize: 'medium',
	deckMetaPillTextColor: '#111827',
	deckMetaPillBgColor: '#ffffff',
	deckMetaPillAccentColor: '#7c3aed',
	showHighlanderTotal: true,
	showHighlanderPointedCards: true,
	highlanderPointedCardsSize: 'medium',
	highlanderPointedCardsTextColor: '#111827',
	highlanderPointedCardsBgColor: '#ffffff',
	highlanderPointedCardsAccentColor: '#7c3aed',
	highlanderPointedCardsBorderColor: undefined,
	showHighlanderPoints: true,
	highlanderPointsPosition: DEFAULT_HIGHLANDER_POINTS_POSITION,
	highlanderPointsSize: 'medium',
	highlanderPointsTextColor: '#ffffff',
	highlanderPointsBgColor: '#7c3aed',
	quantityPosition: DEFAULT_QUANTITY_POSITION,
	quantitySize: 'medium',
	quantityTextColor: '#ffffff',
	quantityBgColor: '#7c3aed',
});

export type DeckModeConfig = ScreenModeConfigOf<typeof deckModeConfigContract>;
export type DeckSource = DeckModeConfig['deckSource'];

export interface ResolvedDeckBoards {
	board: BoardSelection;
	sideboardPlacement: SideboardPlacement;
	mainboard: ResolvedDeckBoardLayout;
	sideboard: ResolvedDeckBoardLayout;
}

/**
 * Completes a Deck configuration's board selection and board blocks from their
 * defaults. Stored blocks are partial fragments — a PATCH may have written a
 * lone `{ columns: 6 }` — so every rendering and settings surface resolves
 * through this rather than reading the fragments directly.
 */
export function resolveDeckBoards(config: Partial<DeckModeConfig>): ResolvedDeckBoards {
	return {
		board: config.board ?? 'full',
		sideboardPlacement: config.sideboardPlacement ?? 'beside',
		mainboard: { ...DEFAULT_DECK_BOARD_LAYOUT, ...config.mainboard },
		sideboard: { ...DEFAULT_SIDEBOARD_LAYOUT, ...config.sideboard },
	};
}
