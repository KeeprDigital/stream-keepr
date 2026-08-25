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

interface ParsedCardRow extends BroadcastDeckListCardResolutionRequest {
	lineNumber: number;
	sourceText: string;
	compartment: BroadcastDeckListCompartment;
	quantity: number;
}

const HEADINGS: Record<string, BroadcastDeckListCompartment> = {
	deck: 'mainboard',
	mainboard: 'mainboard',
	sideboard: 'sideboard',
	companion: 'companion',
};

const UNSUPPORTED_SECTIONS = new Set([
	'about',
	'artifacts',
	'commander',
	'creatures',
	'enchantments',
	'instants',
	'lands',
	'maybeboard',
	'name',
	'planeswalkers',
	'sorceries',
]);

function lineError(
	lineNumber: number,
	code: BroadcastDeckListImportLineErrorCode,
	message: string,
	sourceText: string,
): BroadcastDeckListImportLineError {
	return { lineNumber, code, message, sourceText };
}

function orderedErrors(errors: readonly BroadcastDeckListImportError[]): BroadcastDeckListImportError[] {
	const lineErrors = errors
		.filter((error): error is BroadcastDeckListImportLineError => 'lineNumber' in error)
		.toSorted((left, right) => left.lineNumber - right.lineNumber);
	const listErrors = errors.filter((error): error is BroadcastDeckListImportListError => !('lineNumber' in error));
	return [...lineErrors, ...listErrors];
}

function quantityToken(sourceText: string): string | null {
	const separatorIndex = sourceText.indexOf(' ');
	return separatorIndex < 0 ? null : sourceText.slice(0, separatorIndex);
}

function parseCardRow(
	lineNumber: number,
	sourceText: string,
	compartment: BroadcastDeckListCompartment,
): ParsedCardRow | BroadcastDeckListImportLineError {
	const lowerSource = sourceText.toLowerCase().replace(/:$/, '');
	if (UNSUPPORTED_SECTIONS.has(lowerSource)) {
		return lineError(lineNumber, 'UNSUPPORTED_SECTION', 'This section is not supported', sourceText);
	}
	if (/^(?:#|\/\/|;)/.test(sourceText) || /^(?:about|name)\s+/i.test(sourceText)) {
		return lineError(lineNumber, 'UNSUPPORTED_SYNTAX', 'Comments and deck metadata are not supported', sourceText);
	}

	const token = quantityToken(sourceText);
	const quantityMatch = token === null ? null : /^(\d+)x?$/i.exec(token);
	if (!quantityMatch) {
		return /^[+-]?\d/.test(sourceText)
			? lineError(lineNumber, 'INVALID_QUANTITY', 'Quantity must be a whole number from 1 through 999', sourceText)
			: lineError(lineNumber, 'INVALID_CARD_LINE', 'Expected a quantity followed by a card name', sourceText);
	}
	const cardText = sourceText.slice(token!.length).trim();
	const quantity = Number(quantityMatch[1]);
	if (compartment === 'companion' && quantity !== 1) {
		return lineError(lineNumber, 'INVALID_COMPANION_QUANTITY', 'Companion quantity must be exactly one', sourceText);
	}
	if (quantity < 1 || quantity > 999 || /^x\s+/i.test(cardText)) {
		return lineError(lineNumber, 'INVALID_QUANTITY', 'Quantity must be a whole number from 1 through 999', sourceText);
	}
	if (
		/\s+(?:\*[a-z]+(?::[^*]+)?\*|#.+|\[[^\]]+\]|\^\S.*|foil)$/i.test(cardText)
		|| /\([a-z\d]{1,20}\)\s+\S+\s+\S+$/i.test(cardText)
		|| /\([a-z\d]+:[^)]+\)$/i.test(cardText)
		|| cardText.includes('`')
	) {
		return lineError(lineNumber, 'UNSUPPORTED_SYNTAX', 'Card decorations and inline categories are not supported', sourceText);
	}
	const cardTokens = cardText.split(/\s+/);
	const lastToken = cardTokens.at(-1) ?? '';
	const penultimateToken = cardTokens.at(-2) ?? '';
	const setOnlyMatch = /^\(([a-z\d]{1,20})\)$/i.exec(lastToken);
	const setAndCollectorMatch = /^\(([a-z\d]{1,20})\)$/i.exec(penultimateToken);
	const printingTokenCount = setOnlyMatch ? 1 : setAndCollectorMatch ? 2 : 0;
	const setCode = setOnlyMatch?.[1] ?? setAndCollectorMatch?.[1] ?? null;
	const collectorNumber = setAndCollectorMatch ? lastToken : null;
	const name = printingTokenCount === 0
		? cardText
		: cardTokens.slice(0, -printingTokenCount).join(' ');

	return {
		lineNumber,
		sourceText,
		compartment,
		quantity,
		name,
		setCode: setCode?.toLowerCase() ?? null,
		collectorNumber,
	};
}

export async function importBroadcastDeckList(
	source: string,
	resolver: BroadcastDeckListCardResolver,
): Promise<BroadcastDeckListImportResult> {
	if (new TextEncoder().encode(source).byteLength > 64 * 1024) {
		return {
			ok: false,
			errors: [{ code: 'SOURCE_TOO_LARGE', message: 'Source text must not exceed 64 KiB' }],
		};
	}
	const physicalLines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
	if (physicalLines.length > 500) {
		return {
			ok: false,
			errors: [{ code: 'TOO_MANY_LINES', message: 'Source text must not exceed 500 physical lines' }],
		};
	}
	const normalizedLines = physicalLines
		.map((sourceText, index) => ({ lineNumber: index + 1, sourceText: sourceText.trim() }))
		.filter(line => line.sourceText.length > 0);
	const sourceText = normalizedLines.map(line => line.sourceText).join('\n');
	let compartment: BroadcastDeckListCompartment = 'mainboard';
	let companionRows = 0;
	const rows: ParsedCardRow[] = [];
	const errors: BroadcastDeckListImportError[] = [];

	for (const line of normalizedLines) {
		const heading = HEADINGS[line.sourceText.toLowerCase()];
		if (heading) {
			compartment = heading;
			continue;
		}
		if (compartment === 'companion' && /^\d+x?$/i.test(quantityToken(line.sourceText) ?? '')) {
			companionRows++;
			if (companionRows > 1) {
				errors.push(lineError(
					line.lineNumber,
					'MULTIPLE_COMPANIONS',
					'Only one Companion row is supported',
					line.sourceText,
				));
				continue;
			}
		}

		const parsed = parseCardRow(line.lineNumber, line.sourceText, compartment);
		if ('code' in parsed)
			errors.push(parsed);
		else
			rows.push(parsed);
	}
	let blocksResolution = false;
	if (rows.length > 250) {
		errors.push({ code: 'TOO_MANY_CARD_ROWS', message: 'A deck list must not exceed 250 parsed card rows' });
		blocksResolution = true;
	}
	if (rows.reduce((total, row) => total + row.quantity, 0) > 2_000) {
		errors.push({ code: 'TOTAL_QUANTITY_EXCEEDED', message: 'Total card quantity must not exceed 2,000' });
		blocksResolution = true;
	}
	if (errors.length === 0 && !rows.some(row => row.compartment !== 'companion')) {
		errors.push({ code: 'EMPTY_DECK_LIST', message: 'At least one Mainboard or Sideboard card is required' });
		blocksResolution = true;
	}

	if (blocksResolution || rows.length === 0)
		return { ok: false, errors: orderedErrors(errors) };

	const resolutions = await resolver.resolve(rows.map(row => ({
		name: row.name,
		setCode: row.setCode,
		collectorNumber: row.collectorNumber,
	})));
	const mainboard: BroadcastDeckListCanonicalEntry[] = [];
	const sideboard: BroadcastDeckListCanonicalEntry[] = [];
	let companion: BroadcastDeckListCanonicalEntry | null = null;
	const exceededMergedEntries = new Set<string>();

	for (const [index, row] of rows.entries()) {
		const resolution = resolutions[index];
		if (!resolution || resolution.status === 'unresolved') {
			const hasPrintingHint = row.setCode !== null;
			errors.push({
				lineNumber: row.lineNumber,
				code: hasPrintingHint ? 'INVALID_PRINTING_HINT' : 'UNRESOLVED_CARD',
				message: hasPrintingHint
					? `Could not resolve the requested printing of ${row.name}`
					: `Could not resolve ${row.name}`,
				sourceText: row.sourceText,
			});
			continue;
		}

		const target = row.compartment === 'mainboard' ? mainboard : sideboard;
		if (row.compartment !== 'companion') {
			const existing = target.find(entry => entry.scryfallId === resolution.card.scryfallId);
			if (existing) {
				existing.quantity += row.quantity;
				const mergeKey = `${row.compartment}:${resolution.card.scryfallId}`;
				if (existing.quantity > 999 && !exceededMergedEntries.has(mergeKey)) {
					exceededMergedEntries.add(mergeKey);
					errors.push({
						code: 'MERGED_QUANTITY_EXCEEDED',
						message: `${resolution.card.canonicalName} exceeds the merged quantity limit of 999 in ${row.compartment}`,
					});
				}
				continue;
			}
		}
		const entry = {
			...resolution.card,
			quantity: row.quantity,
			sortOrder: row.compartment === 'companion' ? 0 : target.length,
		};
		if (row.compartment === 'companion')
			companion = entry;
		else
			target.push(entry);
	}

	if (errors.length > 0)
		return { ok: false, errors: orderedErrors(errors) };

	return {
		ok: true,
		document: { sourceText, mainboard, sideboard, companion },
	};
}

export {
	BroadcastDeckListCardProviderError,
	createBroadcastDeckListScryfallResolver,
} from './scryfallResolver';
export type {
	BroadcastDeckListNameOverride,
	BroadcastDeckListScryfallBoundary,
} from './scryfallResolver';
