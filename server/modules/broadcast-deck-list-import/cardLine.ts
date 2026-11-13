import type {
	BroadcastDeckListCanonicalEntry,
	BroadcastDeckListCardResolutionRequest,
	BroadcastDeckListCardResolver,
	BroadcastDeckListImportLineError,
	BroadcastDeckListImportLineErrorCode,
	BroadcastDeckListImportListError,
	ResolvedBroadcastDeckListCard,
} from './index';

/**
 * The line rules of Magic deck text, one set for both owners of a paste: a
 * Broadcast Deck List and a Commander Seat (ADR-0087). Each owner reads its
 * own headings and sections around them.
 */

export interface SourceLine {
	lineNumber: number;
	sourceText: string;
}

export interface ParsedCardLine extends BroadcastDeckListCardResolutionRequest, SourceLine {
	quantity: number;
}

/** A printing's finish as Moxfield marks it, foil or etched: dropped, since a line names the printing without it. */
const FINISH_MARKER = /\s+\*[ef]\*$/i;

/** The most copies one entry may hold, pasted on one line or added from several. */
export const MAX_ENTRY_QUANTITY = 999;
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_PHYSICAL_LINES = 500;
const MAX_CARD_ROWS = 250;
const MAX_TOTAL_QUANTITY = 2_000;

/** Headings of sections neither owner of a paste reads. */
export const UNREAD_SECTIONS: ReadonlySet<string> = new Set([
	'artifacts',
	'creatures',
	'enchantments',
	'instants',
	'lands',
	'maybeboard',
	'planeswalkers',
	'sorceries',
]);

/** A line's text as a heading is matched: lower case, without the colon some exports end one with. */
export function headingKey(sourceText: string): string {
	return sourceText.toLowerCase().replace(/:$/, '');
}

/** Errors in the order an operator reads them: by line, then those of the list as a whole. */
export function orderedErrors<TError extends { code: string }>(errors: readonly TError[]): TError[] {
	const lineNumber = (error: TError) => (error as { lineNumber?: number }).lineNumber;
	return [
		...errors
			.filter(error => lineNumber(error) !== undefined)
			.toSorted((left, right) => lineNumber(left)! - lineNumber(right)!),
		...errors.filter(error => lineNumber(error) === undefined),
	];
}

export function lineError<TCode extends string = BroadcastDeckListImportLineErrorCode>(
	line: SourceLine,
	code: TCode,
	message: string,
): SourceLine & { code: TCode; message: string } {
	return {
		lineNumber: line.lineNumber,
		code,
		message,
		sourceText: line.sourceText,
	};
}

/** A pasted source as its physical lines, each trimmed and blank ones kept, or the limit it breaks. */
export function sourceLines(source: string): SourceLine[] | BroadcastDeckListImportListError {
	if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES)
		return { code: 'SOURCE_TOO_LARGE', message: 'Source text must not exceed 64 KiB' };
	const physicalLines = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
	if (physicalLines.length > MAX_PHYSICAL_LINES)
		return { code: 'TOO_MANY_LINES', message: 'Source text must not exceed 500 physical lines' };
	return physicalLines.map((sourceText, index) => ({
		lineNumber: index + 1,
		sourceText: sourceText.trim(),
	}));
}

/** The limits a paste's card rows break together, which stop it before any card is resolved. */
export function cardRowLimitErrors(rows: readonly ParsedCardLine[]): BroadcastDeckListImportListError[] {
	const errors: BroadcastDeckListImportListError[] = [];
	if (rows.length > MAX_CARD_ROWS)
		errors.push({ code: 'TOO_MANY_CARD_ROWS', message: 'A deck list must not exceed 250 parsed card rows' });
	if (rows.reduce((total, row) => total + row.quantity, 0) > MAX_TOTAL_QUANTITY)
		errors.push({ code: 'TOTAL_QUANTITY_EXCEEDED', message: 'Total card quantity must not exceed 2,000' });
	return errors;
}

export function quantityToken(sourceText: string): string | null {
	const separatorIndex = sourceText.indexOf(' ');
	return separatorIndex < 0
		? null
		: sourceText.slice(0, separatorIndex);
}

/**
 * One card line: a quantity, a name, and the printing it names, by a set
 * alone or a set and collector number. `singleCopy` is a Companion's rule.
 */
export function parseCardLine(line: SourceLine, singleCopy = false): ParsedCardLine | BroadcastDeckListImportLineError {
	const { sourceText } = line;
	const token = quantityToken(sourceText);
	const quantityMatch = token === null
		? null
		: /^(\d+)x?$/i.exec(token);
	if (!quantityMatch) {
		return /^[+-]?\d/.test(sourceText)
			? lineError(line, 'INVALID_QUANTITY', 'Quantity must be a whole number from 1 through 999')
			: lineError(line, 'INVALID_CARD_LINE', 'Expected a quantity followed by a card name');
	}
	const cardText = sourceText.slice(token!.length).trim().replace(FINISH_MARKER, '');
	const quantity = Number(quantityMatch[1]);
	if (singleCopy && quantity !== 1)
		return lineError(line, 'INVALID_COMPANION_QUANTITY', 'Companion quantity must be exactly one');
	if (quantity < 1 || quantity > MAX_ENTRY_QUANTITY || /^x\s+/i.test(cardText))
		return lineError(line, 'INVALID_QUANTITY', 'Quantity must be a whole number from 1 through 999');
	if (
		/\s+(?:\*[a-z]+(?::[^*]+)?\*|#.+|\[[^\]]+\]|\^\S.*|foil)$/i.test(cardText)
		|| /\([a-z\d]{1,20}\)\s+\S+\s+\S+$/i.test(cardText)
		|| /\([a-z\d]+:[^)]+\)$/i.test(cardText)
		|| cardText.includes('`')
	) {
		return lineError(line, 'UNSUPPORTED_SYNTAX', 'Card decorations and inline categories are not supported');
	}
	const cardTokens = cardText.split(/\s+/);
	const lastToken = cardTokens.at(-1) ?? '';
	const penultimateToken = cardTokens.at(-2) ?? '';
	const setOnlyMatch = /^\(([a-z\d]{1,20})\)$/i.exec(lastToken);
	const setAndCollectorMatch = /^\(([a-z\d]{1,20})\)$/i.exec(penultimateToken);
	const printingTokenCount = setOnlyMatch
		? 1
		: setAndCollectorMatch ? 2 : 0;
	const setCode = setOnlyMatch?.[1] ?? setAndCollectorMatch?.[1] ?? null;
	const collectorNumber = setAndCollectorMatch ? lastToken : null;
	const name = printingTokenCount === 0
		? cardText
		: cardTokens.slice(0, -printingTokenCount).join(' ');

	return {
		lineNumber: line.lineNumber,
		sourceText,
		quantity,
		name,
		setCode: setCode?.toLowerCase() ?? null,
		collectorNumber,
	};
}

/** Each row's card, or the error naming its line: a printing its line named that cannot be found, or a card nothing resolves. */
export async function resolveCardLines(
	rows: readonly ParsedCardLine[],
	resolver: BroadcastDeckListCardResolver,
): Promise<Array<ResolvedBroadcastDeckListCard | BroadcastDeckListImportLineError>> {
	const resolutions = await resolver.resolve(rows.map(row => ({
		name: row.name,
		setCode: row.setCode,
		collectorNumber: row.collectorNumber,
	})));
	return rows.map((row, index) => {
		const resolution = resolutions[index];
		if (resolution?.status === 'resolved')
			return resolution.card;
		return row.setCode !== null
			? lineError(row, 'INVALID_PRINTING_HINT', `Could not resolve the requested printing of ${row.name}`)
			: lineError(row, 'UNRESOLVED_CARD', `Could not resolve ${row.name}`);
	});
}

/**
 * Adds a row's card to a board, in the place its printing first took: a
 * printing the board holds already takes the row's quantity. Answers the
 * entry, whose quantity may now be over the limit.
 */
export function addToBoard(
	board: BroadcastDeckListCanonicalEntry[],
	card: ResolvedBroadcastDeckListCard,
	quantity: number,
): BroadcastDeckListCanonicalEntry {
	const held = board.find(entry => entry.scryfallId === card.scryfallId);
	if (held) {
		held.quantity += quantity;
		return held;
	}
	const entry = { ...card, quantity, sortOrder: board.length };
	board.push(entry);
	return entry;
}
