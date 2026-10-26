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
import { editorField, screenModeConfigFields } from './fields';

const quantityPositionSchema = z.enum(QUANTITY_POSITION_VALUES);
const quantitySizeSchema = z.enum(QUANTITY_SIZE_VALUES);

/**
 * One board's complete layout block. The Mainboard and Sideboard each carry
 * their own (#478): which view renders the board, and the knobs each view
 * reads — grid reads columns/gap/sizing, list reads listColumns, stack reads
 * cardSize and stackOverlap. Visibility is the `board` selection's concern, so a
 * block carries no show/hide of its own.
 */
const deckBoardLayoutShape = {
	view: editorField(z.enum(DECK_BOARD_VIEW_VALUES).optional(), { label: 'View' }),
	// The editor's ranges are the product ranges (#498): columns was 1–20, card
	// gap and stack overlap had no maximum. A stored value outside one reads clamped.
	columns: editorField(z.number().int().min(1).max(12).optional(), { label: 'Grid Columns' }),
	listColumns: editorField(z.number().int().min(1).max(4).optional(), { label: 'List Columns' }),
	cardSize: editorField(z.enum(DECK_CARD_SIZE_VALUES).optional(), { label: 'Card Size' }),
	dynamicCardSize: editorField(z.boolean().optional(), { label: 'Dynamic Card Size' }),
	cardGap: editorField(z.number().min(0).max(48).optional(), { label: 'Card Gap' }),
	/** Percentage of each stacked card left visible under the next one. */
	stackOverlap: editorField(z.number().min(5).max(50).optional(), { label: 'Stack Visible %', step: 1 }),
};

const deckBoardLayoutConfigSchema = z.object(deckBoardLayoutShape).strict();

/** The editor fields of a board's layout block, which the Mainboard and Sideboard share. */
export const DECK_BOARD_LAYOUT_FIELDS = screenModeConfigFields(deckBoardLayoutShape);

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

/** Which boards render, and where the sideboard sits, until an operator changes them. */
const DEFAULT_BOARD: BoardSelection = 'full';
const DEFAULT_SIDEBOARD_PLACEMENT: SideboardPlacement = 'beside';

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
	board: editorField(z.enum(BOARD_SELECTION_VALUES).optional(), { label: 'Boards' }),
	/** Where the sideboard sits relative to the mainboard. Read only at `board: 'full'`. */
	sideboardPlacement: editorField(z.enum(SIDEBOARD_PLACEMENT_VALUES).optional(), { label: 'Sideboard Placement' }),
	mainboard: deckBoardLayoutConfigSchema.optional(),
	sideboard: deckBoardLayoutConfigSchema.optional(),
	showQuantities: editorField(z.boolean().optional(), { label: 'Show Quantities' }),
	showDeckName: editorField(z.boolean().optional(), { label: 'Show Deck Name' }),
	showDeckColors: editorField(z.boolean().optional(), { label: 'Show Deck Colors' }),
	showDeckStats: editorField(z.boolean().optional(), { label: 'Show Deck Stats' }),
	showDeckMetaPill: editorField(z.boolean().optional(), { label: 'Show Deck Meta Pill' }),
	deckMetaPillSize: editorField(quantitySizeSchema.optional(), { label: 'Pill Size' }),
	deckMetaPillTextColor: editorField(z.string().max(50).optional(), { label: 'Text Color', control: 'color' }),
	deckMetaPillBgColor: editorField(z.string().max(200).optional(), { label: 'Background', control: 'color' }),
	deckMetaPillAccentColor: editorField(z.string().max(50).optional(), { label: 'Accent Color', control: 'color' }),
	deckMetaPillBorderColor: editorField(z.string().max(50).optional(), { label: 'Border Color', control: 'color' }),
	showHighlanderTotal: editorField(z.boolean().optional(), { label: 'Show Total Points' }),
	showHighlanderPointedCards: editorField(z.boolean().optional(), { label: 'Show Pointed Cards' }),
	highlanderPointedCardsSize: editorField(quantitySizeSchema.optional(), { label: 'Chip Size' }),
	highlanderPointedCardsTextColor: editorField(z.string().max(50).optional(), { label: 'Text Color', control: 'color' }),
	highlanderPointedCardsBgColor: editorField(z.string().max(200).optional(), { label: 'Background Color', control: 'color' }),
	highlanderPointedCardsAccentColor: editorField(z.string().max(50).optional(), { label: 'Accent Color', control: 'color' }),
	highlanderPointedCardsBorderColor: editorField(z.string().max(50).optional(), { label: 'Border Color', control: 'color' }),
	showHighlanderPoints: editorField(z.boolean().optional(), { label: 'Show Point Badges' }),
	highlanderPointsPosition: editorField(quantityPositionSchema.optional(), { label: 'Badge Position' }),
	highlanderPointsSize: editorField(quantitySizeSchema.optional(), { label: 'Badge Size' }),
	highlanderPointsTextColor: editorField(z.string().max(50).optional(), { label: 'Text Color', control: 'color' }),
	highlanderPointsBgColor: editorField(z.string().max(50).optional(), { label: 'Background Color', control: 'color' }),

	// Quantity badge customization
	quantityPosition: editorField(quantityPositionSchema.optional(), { label: 'Badge Position' }),
	quantitySize: editorField(quantitySizeSchema.optional(), { label: 'Badge Size' }),
	quantityTextColor: editorField(z.string().max(50).optional(), { label: 'Text Color', control: 'color' }),
	quantityBgColor: editorField(z.string().max(50).optional(), { label: 'Background Color', control: 'color' }),
}, {
	deckSource: { type: 'player', playerId: null },
	board: DEFAULT_BOARD,
	sideboardPlacement: DEFAULT_SIDEBOARD_PLACEMENT,
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
		board: config.board ?? DEFAULT_BOARD,
		sideboardPlacement: config.sideboardPlacement ?? DEFAULT_SIDEBOARD_PLACEMENT,
		mainboard: {
			...DEFAULT_DECK_BOARD_LAYOUT,
			...config.mainboard,
		},
		sideboard: {
			...DEFAULT_SIDEBOARD_LAYOUT,
			...config.sideboard,
		},
	};
}
