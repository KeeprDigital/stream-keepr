import type { ParsedCardLine, SourceLine } from './cardLine';
import {
	addToBoard,
	cardRowLimitErrors,
	headingKey,
	lineError,
	MAX_ENTRY_QUANTITY,
	orderedErrors,
	parseCardLine,
	quantityToken,
	resolveCardLines,
	sourceLines,
	UNREAD_SECTIONS,
} from './cardLine';

/**
 * The Magic deck text parser. It serves two owners with one set of line rules
 * (`cardLine.ts`): a Broadcast Deck List, read here, and a Commander Seat's
 * Feature Match Deck List (`commander.ts`, ADR-0087).
 */

export type BroadcastDeckListCompartment = 'mainboard' | 'sideboard' | 'companion';

export interface BroadcastDeckListCardResolutionRequest {
	name: string;
	setCode: string | null;
	collectorNumber: string | null;
}

export interface ResolvedBroadcastDeckListCard {
	canonicalName: string;
	scryfallId: string;
	oracleId: string | null;
	setCode: string;
	collectorNumber: string | null;
	cardType: string | null;
	colors: string | null;
	manaCost: string | null;
	manaValue: number | null;
	deckCounterTypes: string[];
}

export type BroadcastDeckListCardResolution
	= | { status: 'resolved'; card: ResolvedBroadcastDeckListCard }
		| { status: 'unresolved' };

export interface BroadcastDeckListCardResolver {
	resolve: (
		requests: readonly BroadcastDeckListCardResolutionRequest[],
	) => Promise<readonly BroadcastDeckListCardResolution[]>;
}

export interface BroadcastDeckListCanonicalEntry extends ResolvedBroadcastDeckListCard {
	quantity: number;
	sortOrder: number;
}

export interface BroadcastDeckListCanonicalDocument {
	sourceText: string;
	mainboard: BroadcastDeckListCanonicalEntry[];
	sideboard: BroadcastDeckListCanonicalEntry[];
	companion: BroadcastDeckListCanonicalEntry | null;
}

export const BROADCAST_DECK_LIST_LINE_ERROR_CODES = [
	'INVALID_CARD_LINE',
	'INVALID_QUANTITY',
	'UNSUPPORTED_SECTION',
	'UNSUPPORTED_SYNTAX',
	'INVALID_PRINTING_HINT',
	'UNRESOLVED_CARD',
	'INVALID_COMPANION_QUANTITY',
	'MULTIPLE_COMPANIONS',
] as const;

export const BROADCAST_DECK_LIST_LIST_ERROR_CODES = [
	'SOURCE_TOO_LARGE',
	'TOO_MANY_LINES',
	'TOO_MANY_CARD_ROWS',
	'MERGED_QUANTITY_EXCEEDED',
	'TOTAL_QUANTITY_EXCEEDED',
	'EMPTY_DECK_LIST',
] as const;

export type BroadcastDeckListImportLineErrorCode = typeof BROADCAST_DECK_LIST_LINE_ERROR_CODES[number];
export type BroadcastDeckListImportListErrorCode = typeof BROADCAST_DECK_LIST_LIST_ERROR_CODES[number];

export interface BroadcastDeckListImportLineError {
	lineNumber: number;
	code: BroadcastDeckListImportLineErrorCode;
	message: string;
	sourceText: string;
}

export interface BroadcastDeckListImportListError {
	code: BroadcastDeckListImportListErrorCode;
	message: string;
}

export type BroadcastDeckListImportError
	= | BroadcastDeckListImportLineError
		| BroadcastDeckListImportListError;

export type BroadcastDeckListImportResult
	= | { ok: true; document: BroadcastDeckListCanonicalDocument }
		| { ok: false; errors: BroadcastDeckListImportError[] };

interface ParsedCardRow extends ParsedCardLine {
	compartment: BroadcastDeckListCompartment;
}

const HEADINGS = new Map<string, BroadcastDeckListCompartment>([
	['deck', 'mainboard'],
	['mainboard', 'mainboard'],
	['sideboard', 'sideboard'],
	['companion', 'companion'],
]);

/** What a Commander Seat's paste reads and a Broadcast Deck List refuses (ADR-0087). */
const COMMANDER_PASTE_SECTIONS: ReadonlySet<string> = new Set(['about', 'commander', 'name']);

function parseCardRow(
	line: SourceLine,
	compartment: BroadcastDeckListCompartment,
): ParsedCardRow | BroadcastDeckListImportLineError {
	const { sourceText } = line;
	const heading = headingKey(sourceText);
	if (UNREAD_SECTIONS.has(heading) || COMMANDER_PASTE_SECTIONS.has(heading))
		return lineError(line, 'UNSUPPORTED_SECTION', 'This section is not supported');
	if (/^(?:#|\/\/|;)/.test(sourceText) || /^(?:about|name)\s+/i.test(sourceText))
		return lineError(line, 'UNSUPPORTED_SYNTAX', 'Comments and deck metadata are not supported');

	const parsed = parseCardLine(line, compartment === 'companion');
	return 'code' in parsed
		? parsed
		: { ...parsed, compartment };
}

export async function importBroadcastDeckList(
	source: string,
	resolver: BroadcastDeckListCardResolver,
): Promise<BroadcastDeckListImportResult> {
	const physicalLines = sourceLines(source);
	if (!Array.isArray(physicalLines))
		return { ok: false, errors: [physicalLines] };
	const normalizedLines = physicalLines.filter(line => line.sourceText.length > 0);
	const sourceText = normalizedLines.map(line => line.sourceText).join('\n');
	let compartment: BroadcastDeckListCompartment = 'mainboard';
	let companionRows = 0;
	const rows: ParsedCardRow[] = [];
	const errors: BroadcastDeckListImportError[] = [];

	for (const line of normalizedLines) {
		const heading = HEADINGS.get(line.sourceText.toLowerCase());
		if (heading) {
			compartment = heading;
			continue;
		}
		if (compartment === 'companion' && /^\d+x?$/i.test(quantityToken(line.sourceText) ?? '')) {
			companionRows++;
			if (companionRows > 1) {
				errors.push(lineError(line, 'MULTIPLE_COMPANIONS', 'Only one Companion row is supported'));
				continue;
			}
		}

		const parsed = parseCardRow(line, compartment);
		if ('code' in parsed)
			errors.push(parsed);
		else
			rows.push(parsed);
	}
	const limitErrors = cardRowLimitErrors(rows);
	errors.push(...limitErrors);
	let blocksResolution = limitErrors.length > 0;
	if (errors.length === 0 && !rows.some(row => row.compartment !== 'companion')) {
		errors.push({ code: 'EMPTY_DECK_LIST', message: 'At least one Mainboard or Sideboard card is required' });
		blocksResolution = true;
	}

	if (blocksResolution || rows.length === 0) {
		return {
			ok: false,
			errors: orderedErrors(errors),
		};
	}

	const resolved = await resolveCardLines(rows, resolver);
	const mainboard: BroadcastDeckListCanonicalEntry[] = [];
	const sideboard: BroadcastDeckListCanonicalEntry[] = [];
	let companion: BroadcastDeckListCanonicalEntry | null = null;
	const exceededMergedEntries = new Set<string>();

	for (const [index, row] of rows.entries()) {
		const card = resolved[index]!;
		if ('code' in card) {
			errors.push(card);
			continue;
		}
		if (row.compartment === 'companion') {
			companion = { ...card, quantity: row.quantity, sortOrder: 0 };
			continue;
		}

		const entry = addToBoard(row.compartment === 'mainboard' ? mainboard : sideboard, card, row.quantity);
		const mergeKey = `${row.compartment}:${card.scryfallId}`;
		if (entry.quantity > MAX_ENTRY_QUANTITY && !exceededMergedEntries.has(mergeKey)) {
			exceededMergedEntries.add(mergeKey);
			errors.push({
				code: 'MERGED_QUANTITY_EXCEEDED',
				message: `${card.canonicalName} exceeds the merged quantity limit of 999 in ${row.compartment}`,
			});
		}
	}

	if (errors.length > 0) {
		return {
			ok: false,
			errors: orderedErrors(errors),
		};
	}

	return {
		ok: true,
		document: {
			sourceText,
			mainboard,
			sideboard,
			companion,
		},
	};
}

export { importCommanderDeckList } from './commander';
export type {
	CommanderDeckListDocument,
	CommanderDeckListImportError,
	CommanderDeckListImportResult,
} from './commander';
export {
	BroadcastDeckListCardProviderError,
	createBroadcastDeckListScryfallResolver,
} from './scryfallResolver';
export type {
	BroadcastDeckListNameOverride,
	BroadcastDeckListScryfallBoundary,
} from './scryfallResolver';
