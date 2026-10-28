import type { BoardSelection, QuantityPosition, SideboardPlacement } from '../types/enums';
import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import {
	BOARD_SELECTION_VALUES,
	CARD_SIZING_VALUES,
	MAINBOARD_VIEW_VALUES,
	QUANTITY_POSITION_VALUES,
	SIDEBOARD_PLACEMENT_VALUES,
	SIDEBOARD_VIEW_VALUES,
} from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField, screenModeConfigFields } from './fields';

const quantityPositionSchema = z.enum(QUANTITY_POSITION_VALUES);

/**
 * One board's complete layout block. The Mainboard and Sideboard each carry
 * their own (#478): which view renders the board, and the knobs each view
 * reads — grid reads its columns and how its cards are sized, list reads
 * listColumns. Only the sideboard stacks, as the strip beside the mainboard
 * (ADR-0053), so each board names its own views. Visibility is the `board`
 * selection's concern, so a block carries no show/hide of its own. How big
 * its cards are, its grid's gap and how much of a stacked card shows are its
 * board's Mode Tokens (#824, #844).
 */
function deckBoardLayoutShape<const Views extends readonly [string, ...string[]]>(views: Views) {
	return {
		view: editorField(z.enum(views).optional(), { label: 'View' }),
		// The editor's ranges are the product ranges (#498): columns was 1–20. A
		// stored value outside one reads clamped.
		columns: editorField(z.number().int().min(1).max(12).optional(), { label: 'Grid Columns' }),
		/** Columns chosen from the card count and the Event Canvas, in place of `columns`. */
		autoColumns: editorField(z.boolean().optional(), { label: 'Auto Columns' }),
		listColumns: editorField(z.number().int().min(1).max(4).optional(), { label: 'List Columns' }),
		/** Fit: every card fits its board's space. Fixed: cards take their board's `card-width` Mode Token. */
		cardSizing: editorField(z.enum(CARD_SIZING_VALUES).optional(), { label: 'Card Sizing' }),
	};
}

const mainboardLayoutShape = deckBoardLayoutShape(MAINBOARD_VIEW_VALUES);
const sideboardLayoutShape = deckBoardLayoutShape(SIDEBOARD_VIEW_VALUES);

/**
 * A layout block's former fields: its look fields, now the mode's Mode Tokens
 * (#824), and `dynamicCardSize`, which `cardSizing` replaced (ADR-0053).
 */
const FORMER_BOARD_LAYOUT_FIELDS = [
	'cardSize',
	'cardGap',
	'stackOverlap',
	'dynamicCardSize',
] as const;

const mainboardLayoutConfigSchema = z.object(mainboardLayoutShape).strict();
const sideboardLayoutConfigSchema = z.object(sideboardLayoutShape).strict();

/** The editor fields of each board's layout block. */
export const DECK_MAINBOARD_LAYOUT_FIELDS = screenModeConfigFields(mainboardLayoutShape);
export const DECK_SIDEBOARD_LAYOUT_FIELDS = screenModeConfigFields(sideboardLayoutShape);

export type ResolvedMainboardLayout = Required<z.output<typeof mainboardLayoutConfigSchema>>;
export type ResolvedSideboardLayout = Required<z.output<typeof sideboardLayoutConfigSchema>>;
/** Either board's resolved layout block, as a reader of both boards reads it. */
export type ResolvedDeckBoardLayout = ResolvedMainboardLayout | ResolvedSideboardLayout;

export const DEFAULT_DECK_BOARD_LAYOUT: ResolvedMainboardLayout = {
	view: 'grid',
	columns: 4,
	autoColumns: false,
	listColumns: 2,
	cardSizing: 'fixed',
};

const DEFAULT_SIDEBOARD_LAYOUT: ResolvedSideboardLayout = {
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
	mainboard: mainboardLayoutConfigSchema.optional(),
	sideboard: sideboardLayoutConfigSchema.optional(),
	showQuantities: editorField(z.boolean().optional(), { label: 'Show Quantities' }),
	showDeckName: editorField(z.boolean().optional(), { label: 'Show Deck Name' }),
	showDeckColors: editorField(z.boolean().optional(), { label: 'Show Deck Colors' }),
	showDeckStats: editorField(z.boolean().optional(), { label: 'Show Deck Stats' }),
	showDeckMetaPill: editorField(z.boolean().optional(), { label: 'Show Deck Meta Pill' }),
	showHighlanderTotal: editorField(z.boolean().optional(), { label: 'Show Total Points' }),
	showHighlanderPointedCards: editorField(z.boolean().optional(), { label: 'Show Pointed Cards' }),
	showHighlanderPoints: editorField(z.boolean().optional(), { label: 'Show Point Badges' }),
	highlanderPointsPosition: editorField(quantityPositionSchema.optional(), { label: 'Badge Position' }),

	// Quantity badge placement
	quantityPosition: editorField(quantityPositionSchema.optional(), { label: 'Badge Position' }),
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
	showHighlanderTotal: true,
	showHighlanderPointedCards: true,
	showHighlanderPoints: true,
	highlanderPointsPosition: DEFAULT_HIGHLANDER_POINTS_POSITION,
	quantityPosition: DEFAULT_QUANTITY_POSITION,
}, {
	formerFields: [
		// Their colours are the mode's Mode Tokens (#824).
		'deckMetaPillTextColor',
		'deckMetaPillBgColor',
		'deckMetaPillAccentColor',
		'deckMetaPillBorderColor',
		'highlanderPointedCardsTextColor',
		'highlanderPointedCardsBgColor',
		'highlanderPointedCardsAccentColor',
		'highlanderPointedCardsBorderColor',
		'highlanderPointsTextColor',
		'highlanderPointsBgColor',
		'quantityTextColor',
		'quantityBgColor',
		// Their sizes are the mode's Mode Tokens (#844).
		'deckMetaPillSize',
		'highlanderPointedCardsSize',
		'highlanderPointsSize',
		'quantitySize',
		...FORMER_BOARD_LAYOUT_FIELDS.flatMap(field => [`mainboard.${field}`, `sideboard.${field}`]),
	],
});

export type DeckModeConfig = ScreenModeConfigOf<typeof deckModeConfigContract>;
export type DeckSource = DeckModeConfig['deckSource'];

export interface ResolvedDeckBoards {
	board: BoardSelection;
	sideboardPlacement: SideboardPlacement;
	mainboard: ResolvedMainboardLayout;
	sideboard: ResolvedSideboardLayout;
}

/**
 * Completes a Deck configuration's board selection and board blocks from their
 * defaults. Stored blocks are partial fragments — a PATCH may have written a
 * lone `{ columns: 6 }` — so every rendering and settings surface resolves
 * through this rather than reading the fragments directly. A mainboard stack,
 * which only a client older than migration 0014 could still write, reads as
 * a grid (ADR-0053), so neither a rendering nor the next board write carries it.
 */
export function resolveDeckBoards(config: Partial<DeckModeConfig>): ResolvedDeckBoards {
	const mainboard = {
		...DEFAULT_DECK_BOARD_LAYOUT,
		...config.mainboard,
	};
	return {
		board: config.board ?? DEFAULT_BOARD,
		sideboardPlacement: config.sideboardPlacement ?? DEFAULT_SIDEBOARD_PLACEMENT,
		mainboard: {
			...mainboard,
			view: MAINBOARD_VIEW_VALUES.includes(mainboard.view)
				? mainboard.view
				: 'grid',
		},
		sideboard: {
			...DEFAULT_SIDEBOARD_LAYOUT,
			...config.sideboard,
		},
	};
}
