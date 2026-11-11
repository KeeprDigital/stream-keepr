import type { GapTerms } from './cardGrid';
import { CARD_ASPECT, GAP_AS_WIDE_AS_ITS_CARD, gapAt, gapTerms, layoutScore, widestAcross, widestDown } from './cardGrid';

/** A Deck board's Auto gap, as a share of the solved card width: 8 px beside a 144 px card. */
export const DECK_AUTO_GAP_RATIO = 8 / 144;

/** The least of a stacked card that still shows, as a share of its height: its name bar. */
export const MIN_STACK_REVEAL_SHARE = 0.09;

export interface DeckLayoutGridBoard {
	view: 'grid';
	count: number;
	/** A set gap in px, or null for Auto: `DECK_AUTO_GAP_RATIO` of the solved card width. */
	gap: number | null;
	/** A set column count, or null for Auto: the count that uses the space best. */
	columns: number | null;
	/** The widest a card may be, or Auto (absent or null): as wide as fits. Every board shares the least. */
	maxCardWidth?: number | null;
	/** Height its label takes above it; 0 for none. */
	labelHeight: number;
}

export interface DeckLayoutStackBoard {
	view: 'stack';
	count: number;
	/** The most of each card but the last that shows. */
	reveal: number;
	/** The widest a card may be, or Auto (absent or null). Every board shares the least. */
	maxCardWidth?: number | null;
	labelHeight: number;
}

export interface DeckLayoutInput {
	/** The space the boards share, in Event Canvas px. */
	width: number;
	height: number;
	/** The space between the two boards. */
	boardGap: number;
	placement: 'beside' | 'below';
	mainboard: DeckLayoutGridBoard | null;
	sideboard: DeckLayoutGridBoard | DeckLayoutStackBoard | null;
}

export interface SolvedGridBoard {
	view: 'grid';
	columns: number;
	rows: number;
	/** The gap between its cards, in px. */
	gap: number;
	/** The board's size with its label. */
	width: number;
	height: number;
}

export interface SolvedStackBoard {
	view: 'stack';
	reveal: number;
	width: number;
	height: number;
}

export interface DeckLayout {
	/** One card width for every board. */
	cardWidth: number;
	mainboard: SolvedGridBoard | null;
	sideboard: SolvedGridBoard | SolvedStackBoard | null;
}

type Board = DeckLayoutGridBoard | DeckLayoutStackBoard;

function columnChoices(board: Board | null): (number | null)[] {
	if (!board || board.view === 'stack')
		return [null];
	if (board.columns !== null) {
		return [
			Math.max(1, Math.floor(board.columns)),
		];
	}
	return Array.from({
		length: Math.max(1, board.count),
	}, (_, index) => index + 1);
}

function rowsOf(board: DeckLayoutGridBoard, columns: number): number {
	return Math.max(1, Math.ceil(board.count / columns));
}

/** The widest card a stack fits down `height`, its reveal shrinking to its name bar first. */
function stackWidthBound(board: DeckLayoutStackBoard, height: number): number {
	const room = height - board.labelHeight;
	if (board.count <= 1)
		return room * CARD_ASPECT;
	const atShare = (room / (1 + (board.count - 1) * MIN_STACK_REVEAL_SHARE)) * CARD_ASPECT;
	// While the name bar is less than the reveal set, the set reveal binds instead.
	return MIN_STACK_REVEAL_SHARE * (atShare / CARD_ASPECT) <= board.reveal
		? atShare
		: (room - (board.count - 1) * board.reveal) * CARD_ASPECT;
}

/** Each board's gap, as the terms its cards are sized by. */
interface BoardGaps {
	mainboard: GapTerms;
	sideboard: GapTerms;
}

const NO_GAP: GapTerms = { fixed: 0, ratio: 0 };

function boardGap(board: Board | null): GapTerms {
	return board?.view === 'grid'
		? gapTerms(board.gap, DECK_AUTO_GAP_RATIO)
		: NO_GAP;
}

/** The least max card size any board sets, the stacked strip's with them. */
function maxCardWidthOf(input: DeckLayoutInput): number {
	return Math.min(...[input.mainboard, input.sideboard].map(board => board?.maxCardWidth ?? Infinity));
}

/** The widest card at which every board, laid out with these columns and gaps, fits the space. */
function widestCard(input: DeckLayoutInput, mainColumns: number | null, sideColumns: number | null, gaps: BoardGaps): number {
	const boards: { board: Board; columns: number | null; gap: GapTerms }[] = [];
	if (input.mainboard)
		boards.push({ board: input.mainboard, columns: mainColumns, gap: gaps.mainboard });
	if (input.sideboard)
		boards.push({ board: input.sideboard, columns: sideColumns, gap: gaps.sideboard });
	const between = boards.length > 1
		? input.boardGap
		: 0;
	const bounds: number[] = [
		maxCardWidthOf(input),
	];

	if (input.placement === 'beside' || boards.length === 1) {
		// Across: every board's columns side by side; a stack is one card wide.
		let spans = 0;
		let fixedGaps = between;
		let gapRatios = 0;
		for (const { board, columns, gap } of boards) {
			const span = board.view === 'grid'
				? columns!
				: 1;
			spans += span;
			fixedGaps += (span - 1) * gap.fixed;
			gapRatios += (span - 1) * gap.ratio;
		}
		bounds.push((input.width - fixedGaps) / (spans + gapRatios));
		// Down: each board alone.
		for (const { board, columns, gap } of boards) {
			if (board.view === 'stack') {
				bounds.push(stackWidthBound(board, input.height));
				continue;
			}
			bounds.push(widestDown(input.height - board.labelHeight, rowsOf(board, columns!), gap, 0));
		}
	}
	else {
		// Across: each board alone. Down: the boards one under the other.
		let rowsTotal = 0;
		let fixedHeight = between;
		let gapRatios = 0;
		for (const { board, columns, gap } of boards) {
			if (board.view === 'stack')
				return 0;
			bounds.push(widestAcross(input.width, columns!, gap));
			const rows = rowsOf(board, columns!);
			rowsTotal += rows;
			fixedHeight += board.labelHeight + (rows - 1) * gap.fixed;
			gapRatios += (rows - 1) * gap.ratio;
		}
		bounds.push((input.height - fixedHeight) / (rowsTotal / CARD_ASPECT + gapRatios));
	}
	return Math.max(0, Math.min(...bounds));
}

/**
 * The widest card that fits, and the gaps it fits with: a board's set gap
 * gives way to its card's width once it would be wider than the card.
 */
function sized(input: DeckLayoutInput, mainColumns: number | null, sideColumns: number | null): { cardWidth: number; gaps: BoardGaps } {
	const gaps: BoardGaps = {
		mainboard: boardGap(input.mainboard),
		sideboard: boardGap(input.sideboard),
	};
	let cardWidth = widestCard(input, mainColumns, sideColumns, gaps);
	for (const key of ['mainboard', 'sideboard'] as const) {
		if (cardWidth < gaps[key].fixed) {
			gaps[key] = GAP_AS_WIDE_AS_ITS_CARD;
			cardWidth = widestCard(input, mainColumns, sideColumns, gaps);
		}
	}
	return { cardWidth, gaps };
}

/** Cards over the places their grids' rows hold; a stack has no empty places. */
function slotFillOf(input: DeckLayoutInput, layout: DeckLayout): number {
	let cards = 0;
	let places = 0;
	if (input.mainboard && layout.mainboard) {
		cards += input.mainboard.count;
		places += layout.mainboard.columns * layout.mainboard.rows;
	}
	if (input.sideboard?.view === 'grid' && layout.sideboard?.view === 'grid') {
		cards += input.sideboard.count;
		places += layout.sideboard.columns * layout.sideboard.rows;
	}
	return places > 0
		? cards / places
		: 1;
}

/** The share of the space's width and of its height the boards span together. */
function sharesOf(input: DeckLayoutInput, layout: DeckLayout): { widthShare: number; heightShare: number } {
	const boards = [layout.mainboard, layout.sideboard].filter(board => board !== null);
	const between = boards.length > 1
		? input.boardGap
		: 0;
	const beside = input.placement === 'beside' || boards.length === 1;
	const width = beside
		? boards.reduce((sum, board) => sum + board.width, 0) + between
		: Math.max(...boards.map(board => board.width));
	const height = beside
		? Math.max(...boards.map(board => board.height))
		: boards.reduce((sum, board) => sum + board.height, 0) + between;
	return { widthShare: width / input.width, heightShare: height / input.height };
}

function solvedGrid(board: DeckLayoutGridBoard, columns: number, cardWidth: number, terms: GapTerms): SolvedGridBoard {
	const rows = rowsOf(board, columns);
	const gap = gapAt(terms, cardWidth);
	return {
		view: 'grid',
		columns,
		rows,
		gap,
		width: columns * cardWidth + (columns - 1) * gap,
		height: board.labelHeight + rows * (cardWidth / CARD_ASPECT) + (rows - 1) * gap,
	};
}

function solvedStack(board: DeckLayoutStackBoard, cardWidth: number, height: number): SolvedStackBoard {
	const cardHeight = cardWidth / CARD_ASPECT;
	const fits = board.count > 1
		? (height - board.labelHeight - cardHeight) / (board.count - 1)
		: board.reveal;
	const reveal = Math.max(Math.min(MIN_STACK_REVEAL_SHARE * cardHeight, board.reveal), Math.min(board.reveal, fits));
	return {
		view: 'stack',
		reveal,
		width: cardWidth,
		height: board.labelHeight + cardHeight + Math.max(0, board.count - 1) * reveal,
	};
}

/**
 * One Deck List's boards laid out together at one card size, at the columns
 * that use the space best (`layoutScore`): each pair of column counts at the
 * largest card size at which both boards fit, scored on that size, the share
 * of the space the deck spans and how full its rows are. A set column count
 * is kept, Auto runs from 1 to the board's card count, and no card is wider
 * than a board's max card size. A board's set gap is kept while it is no wider
 * than the card; its Auto gap is `DECK_AUTO_GAP_RATIO` of the solved card
 * width. A stacked sideboard shows less of each card before its cards shrink.
 * A sideboard grid under the mainboard, choosing its own columns, wraps at
 * the mainboard's width, so the deck reads as one block.
 */
export function solveDeckLayout(input: DeckLayoutInput): DeckLayout | null {
	if ((!input.mainboard && !input.sideboard) || input.width <= 0 || input.height <= 0)
		return null;

	const sideboardWrapsUnderMainboard = input.placement === 'below'
		&& !!input.mainboard
		&& input.sideboard?.view === 'grid'
		&& input.sideboard.columns === null;

	const layouts: DeckLayout[] = [];
	for (const main of columnChoices(input.mainboard)) {
		const sides = sideboardWrapsUnderMainboard
			? [
					Math.min(main!, Math.max(1, input.sideboard!.count)),
				]
			: columnChoices(input.sideboard);
		for (const side of sides)
			layouts.push(laidOut(input, main, side));
	}
	const largestCardWidth = Math.max(...layouts.map(layout => layout.cardWidth));
	if (largestCardWidth <= 0)
		return null;

	let best = layouts[0]!;
	let bestScore = -Infinity;
	for (const layout of layouts) {
		const score = layoutScore({
			cardWidth: layout.cardWidth,
			largestCardWidth,
			...sharesOf(input, layout),
			slotFill: slotFillOf(input, layout),
		});
		if (score > bestScore) {
			best = layout;
			bestScore = score;
		}
	}
	return best;
}

function laidOut(input: DeckLayoutInput, main: number | null, side: number | null): DeckLayout {
	const { cardWidth, gaps } = sized(input, main, side);
	return {
		cardWidth,
		mainboard: input.mainboard
			? solvedGrid(input.mainboard, main!, cardWidth, gaps.mainboard)
			: null,
		sideboard: !input.sideboard
			? null
			: input.sideboard.view === 'stack'
				? solvedStack(input.sideboard, cardWidth, input.height)
				: solvedGrid(input.sideboard, side!, cardWidth, gaps.sideboard),
	};
}

export interface DeckGroupsInput {
	/** Each group's card count, in the order the groups sit under each other. */
	counts: readonly number[];
	/** The space the groups share, in Event Canvas px. */
	width: number;
	height: number;
	/** A set column count, or Auto (absent or null): the count that uses the space best. */
	columns?: number | null;
	/** The widest a card may be, or Auto (absent or null): as wide as fits. */
	maxCardWidth?: number | null;
	/** A set gap in px, or Auto (absent or null): `DECK_AUTO_GAP_RATIO` of the solved card width. */
	gap?: number | null;
	/** Height each group's heading takes above its cards. */
	labelHeight: number;
	/** The space between two groups. */
	groupGap: number;
}

export interface DeckGroups {
	/** The one column count every group shares, so their cards line up. */
	columns: number;
	/** Each group's rows, in the order of `counts`. */
	rows: number[];
	cardWidth: number;
	gap: number;
}

interface ScoredDeckGroups extends DeckGroups {
	widthShare: number;
	heightShare: number;
	slotFill: number;
}

function groupsAt(input: DeckGroupsInput, columns: number): ScoredDeckGroups {
	const rows = input.counts.map(count => Math.max(1, Math.ceil(count / columns)));
	const rowsTotal = rows.reduce((sum, groupRows) => sum + groupRows, 0);
	const gapsDown = rowsTotal - rows.length;
	const fixedHeight = rows.length * input.labelHeight + Math.max(0, rows.length - 1) * input.groupGap;
	const widest = (terms: GapTerms) => Math.max(0, Math.min(
		widestAcross(input.width, columns, terms),
		(input.height - fixedHeight - gapsDown * terms.fixed) / (rowsTotal / CARD_ASPECT + gapsDown * terms.ratio),
		input.maxCardWidth ?? Infinity,
	));
	let terms = gapTerms(input.gap, DECK_AUTO_GAP_RATIO);
	let cardWidth = widest(terms);
	if (cardWidth < terms.fixed) {
		terms = GAP_AS_WIDE_AS_ITS_CARD;
		cardWidth = widest(terms);
	}
	const gap = gapAt(terms, cardWidth);
	const cards = input.counts.reduce((sum, count) => sum + count, 0);
	return {
		columns,
		rows,
		cardWidth,
		gap,
		widthShare: (columns * cardWidth + (columns - 1) * gap) / input.width,
		heightShare: (fixedHeight + rowsTotal * (cardWidth / CARD_ASPECT) + gapsDown * gap) / input.height,
		slotFill: cards > 0
			? cards / (columns * rowsTotal)
			: 1,
	};
}

/**
 * A deck's groups, one under the other, laid out together at one card size
 * and one column count, so their cards line up: the largest card at which
 * every group's rows, headings and the gaps between them fit the space. A set
 * column count is kept; Auto takes the count, from 1 to the largest group's
 * card count, that uses the space best (`layoutScore`). The card is never
 * wider than a set max card size, and a gap is sized as a Deck board's is.
 */
export function solveDeckGroups(input: DeckGroupsInput): DeckGroups {
	const choices = typeof input.columns === 'number'
		? [
				Math.max(1, Math.floor(input.columns)),
			]
		: Array.from({
				length: Math.max(1, ...input.counts),
			}, (_, index) => index + 1);
	const layouts = choices.map(columns => groupsAt(input, columns));
	const largestCardWidth = Math.max(...layouts.map(layout => layout.cardWidth));
	let best = layouts[0]!;
	let bestScore = -Infinity;
	for (const layout of layouts) {
		const score = layoutScore({ ...layout, largestCardWidth });
		if (score > bestScore) {
			best = layout;
			bestScore = score;
		}
	}
	return {
		columns: best.columns,
		rows: best.rows,
		cardWidth: best.cardWidth,
		gap: best.gap,
	};
}
