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
import { NINE_POINT_VALUES } from '../utils/ninePoints';
import { defineScreenModeConfigContract } from './contract';
import { editorField, screenModeConfigFields } from './fields';

const quantityPositionSchema = z.enum(QUANTITY_POSITION_VALUES);

/**
 * One board's complete layout block. The Mainboard and Sideboard each carry
 * their own (#478): which view renders the board, and the knobs each view
 * reads — grid reads its columns and how its cards are sized, list reads
 * listColumns. Only the sideboard stacks, as the strip beside the mainboard
 * (ADR-0053), so each board names its own views, and only it says how much of
 * a stacked card shows. Visibility is the `board` selection's concern, so a
 * block carries no show/hide of its own. Its card width and gap are config,
 * read only by its board (ADR-0053).
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
		/** Fit: every card fits its board's space. Fixed: cards take `cardWidth`. */
		cardSizing: editorField(z.enum(CARD_SIZING_VALUES).optional(), { label: 'Card Sizing' }),
		/** A Fixed or stacked card's width in Event Canvas px. */
		cardWidth: editorField(z.number().int().min(48).max(480).optional(), { label: 'Card Width' }),
		cardGap: editorField(z.number().int().min(0).max(48).optional(), { label: 'Card Gap' }),
		/** Where the board's cards sit in its space when they leave some over. */
		alignment: editorField(z.enum(NINE_POINT_VALUES).optional(), { label: 'Alignment' }),
	};
}

const mainboardLayoutShape = deckBoardLayoutShape(MAINBOARD_VIEW_VALUES);
const sideboardLayoutShape = {
	...deckBoardLayoutShape(SIDEBOARD_VIEW_VALUES),
	/** How much of each stacked card but the last shows, in px. */
	stackReveal: editorField(z.number().int().min(4).max(240).optional(), { label: 'Stack Reveal' }),
};

/**
 * A layout block's former fields: its size preset and stack share, which
 * `cardWidth` and `stackReveal` replaced, and `dynamicCardSize`, which
 * `cardSizing` replaced (ADR-0053).
 */
const FORMER_BOARD_LAYOUT_FIELDS = ['cardSize', 'stackOverlap', 'dynamicCardSize'] as const;

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
	cardWidth: 144,
	cardGap: 8,
	alignment: 'center',
};

const DEFAULT_SIDEBOARD_LAYOUT: ResolvedSideboardLayout = {
	...DEFAULT_DECK_BOARD_LAYOUT,
	view: 'stack',
	// About the former 15% of a medium card's height.
	stackReveal: 30,
};

/** Which boards render, and where the sideboard sits, until an operator changes them. */
const DEFAULT_BOARD: BoardSelection = 'full';
const DEFAULT_SIDEBOARD_PLACEMENT: SideboardPlacement = 'beside';

/** Each badge's, pill's and chip's text size in px until an operator sets it; each sizes itself around its own. */
export const DEFAULT_DECK_TEXT_SIZES = {
	quantityBadgeSize: 16,
	pointsBadgeSize: 14,
	metaPillSize: 16,
	pointedCardSize: 14,
} as const;

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
	/**
	 * Which boards render (#477). "Both hidden" is impossible by construction.
	 * Its editor is each board's own show toggle, so it carries no editor meta.
	 */
	board: z.enum(BOARD_SELECTION_VALUES).optional(),
	/** Where the sideboard sits relative to the mainboard. Read only at `board: 'full'`. */
	sideboardPlacement: editorField(z.enum(SIDEBOARD_PLACEMENT_VALUES).optional(), { label: 'Sideboard Placement' }),
	mainboard: mainboardLayoutConfigSchema.optional(),
	sideboard: sideboardLayoutConfigSchema.optional(),
	showQuantities: editorField(z.boolean().optional(), { label: 'Show Quantities' }),
	/** The header's first line: the Player's name, or a Broadcast Deck List's own name. */
	showPlayerName: editorField(z.boolean().optional(), { label: 'Show Player Name' }),
	/** The header's second line: the deck's name, or a Broadcast Deck List's archetype. */
	showDeckName: editorField(z.boolean().optional(), { label: 'Show Deck Name' }),
	showDeckColors: editorField(z.boolean().optional(), { label: 'Show Deck Colors' }),
	/** The companion as its own card image, beside the boards. */
	showCompanion: editorField(z.boolean().optional(), { label: 'Show Companion' }),
	showDeckStats: editorField(z.boolean().optional(), { label: 'Show Deck Stats' }),
	showDeckMetaPill: editorField(z.boolean().optional(), { label: 'Show Deck Meta Pill' }),
	showHighlanderTotal: editorField(z.boolean().optional(), { label: 'Show Total Points' }),
	showHighlanderPointedCards: editorField(z.boolean().optional(), { label: 'Show Pointed Cards' }),
	showHighlanderPoints: editorField(z.boolean().optional(), { label: 'Show Point Badges' }),
	highlanderPointsPosition: editorField(quantityPositionSchema.optional(), { label: 'Badge Position' }),

	// Quantity badge placement
	quantityPosition: editorField(quantityPositionSchema.optional(), { label: 'Badge Position' }),

	// Text sizes in px; each badge, pill and chip sizes itself around its own (ADR-0053).
	quantityBadgeSize: editorField(z.number().int().min(8).max(48).optional(), { label: 'Badge Text Size' }),
	pointsBadgeSize: editorField(z.number().int().min(8).max(48).optional(), { label: 'Badge Text Size' }),
	metaPillSize: editorField(z.number().int().min(8).max(48).optional(), { label: 'Details Text Size' }),
	pointedCardSize: editorField(z.number().int().min(8).max(48).optional(), { label: 'Pointed Card Text Size' }),
}, {
	deckSource: { type: 'player', playerId: null },
	board: DEFAULT_BOARD,
	sideboardPlacement: DEFAULT_SIDEBOARD_PLACEMENT,
	mainboard: { ...DEFAULT_DECK_BOARD_LAYOUT },
	sideboard: { ...DEFAULT_SIDEBOARD_LAYOUT },
	showQuantities: true,
	showPlayerName: true,
	showDeckName: true,
	showDeckColors: true,
	showCompanion: true,
	showDeckStats: false,
	showDeckMetaPill: true,
	showHighlanderTotal: true,
	showHighlanderPointedCards: true,
	showHighlanderPoints: true,
	highlanderPointsPosition: DEFAULT_HIGHLANDER_POINTS_POSITION,
	quantityPosition: DEFAULT_QUANTITY_POSITION,
	...DEFAULT_DECK_TEXT_SIZES,
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
		// Their size presets, which the px text sizes replaced (ADR-0053).
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
