import { CARD_ASPECT, layoutScore, MAX_CARD_GRID_COLUMNS } from './cardGrid';

/** The least of a stacked card that still shows, as a share of its height: its name bar. */
export const MIN_STACK_REVEAL_SHARE = 0.09;

export interface DeckLayoutGridBoard {
	view: 'grid';
	count: number;
	gap: number;
	/** A fixed column count, or null to choose one. */
	columns: number | null;
	/** Height its label takes above it; 0 for none. */
	labelHeight: number;
}

export interface DeckLayoutStackBoard {
	view: 'stack';
	count: number;
	/** The most of each card but the last that shows. */
	reveal: number;
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
	if (board.columns !== null)
		return [board.columns];
	return Array.from({
		length: Math.min(MAX_CARD_GRID_COLUMNS, Math.max(1, board.count)),
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

/** The widest card at which every board, laid out with these columns, fits the space. */
function widestCard(input: DeckLayoutInput, mainColumns: number | null, sideColumns: number | null): number {
	const boards: { board: Board; columns: number | null }[] = [];
	if (input.mainboard)
		boards.push({ board: input.mainboard, columns: mainColumns });
	if (input.sideboard)
		boards.push({ board: input.sideboard, columns: sideColumns });
	const between = boards.length > 1
		? input.boardGap
		: 0;
	const bounds: number[] = [];

	if (input.placement === 'beside' || boards.length === 1) {
		// Across: every board's columns side by side; a stack is one card wide.
		let spans = 0;
		let gaps = between;
		for (const { board, columns } of boards) {
			const span = board.view === 'grid'
				? columns!
				: 1;
			spans += span;
			gaps += board.view === 'grid'
				? (span - 1) * board.gap
				: 0;
		}
		bounds.push((input.width - gaps) / spans);
		// Down: each board alone.
		for (const { board, columns } of boards) {
			if (board.view === 'stack') {
				bounds.push(stackWidthBound(board, input.height));
				continue;
			}
			const rows = rowsOf(board, columns!);
			bounds.push(((input.height - board.labelHeight - (rows - 1) * board.gap) / rows) * CARD_ASPECT);
		}
	}
	else {
		// Across: each board alone. Down: the boards one under the other.
		let rowsTotal = 0;
		let fixedHeight = between;
		for (const { board, columns } of boards) {
			if (board.view === 'stack')
				return 0;
			bounds.push((input.width - (columns! - 1) * board.gap) / columns!);
			const rows = rowsOf(board, columns!);
			rowsTotal += rows;
			fixedHeight += board.labelHeight + (rows - 1) * board.gap;
		}
		bounds.push(((input.height - fixedHeight) / rowsTotal) * CARD_ASPECT);
	}
	return Math.max(0, Math.min(...bounds));
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

function solvedGrid(board: DeckLayoutGridBoard, columns: number, cardWidth: number): SolvedGridBoard {
	const rows = rowsOf(board, columns);
	return {
		view: 'grid',
		columns,
		rows,
		width: columns * cardWidth + (columns - 1) * board.gap,
		height: board.labelHeight + rows * (cardWidth / CARD_ASPECT) + (rows - 1) * board.gap,
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
 * of the space the deck spans and how full its rows are. A fixed count is
 * kept. A stacked sideboard shows less of each card before its cards shrink.
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
			layouts.push(laidOut(input, main, side, widestCard(input, main, side)));
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

function laidOut(input: DeckLayoutInput, main: number | null, side: number | null, cardWidth: number): DeckLayout {
	return {
		cardWidth,
		mainboard: input.mainboard
			? solvedGrid(input.mainboard, main!, cardWidth)
			: null,
		sideboard: !input.sideboard
			? null
			: input.sideboard.view === 'stack'
				? solvedStack(input.sideboard, cardWidth, input.height)
				: solvedGrid(input.sideboard, side!, cardWidth),
	};
}
