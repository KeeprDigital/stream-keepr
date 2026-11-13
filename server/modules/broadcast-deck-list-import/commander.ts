import type { ParsedCardLine, SourceLine } from './cardLine';
import type {
	BroadcastDeckListCanonicalEntry,
	BroadcastDeckListCardResolver,
	BroadcastDeckListImportError,
} from './index';
import { MAX_SEAT_COMMANDERS } from '~~/shared/utils/commander';
import {
	addToBoard,
	cardRowLimitErrors,
	headingKey,
	lineError,
	MAX_ENTRY_QUANTITY,
	orderedErrors,
	parseCardLine,
	resolveCardLines,
	sourceLines,
	UNREAD_SECTIONS,
} from './cardLine';

/**
 * A Commander Seat's pasted deck (ADR-0087), read from any of Moxfield's four
 * copies. Its own copy carries printings and marks the Commander only by
 * putting it first; the Arena copy heads it `Commander`; the MTGO and
 * plain-text copies put it last, after the Sideboard and a blank line. Which
 * cards are the Commanders is an offer the operator confirms, so each of
 * these is safe to be wrong about. The Sideboard is dropped and counted.
 */

export type CommanderDeckListImportError
	= | BroadcastDeckListImportError
		| (SourceLine & { code: 'NO_COMMANDER' | 'TOO_MANY_COMMANDERS'; message: string });

export interface CommanderDeckListDocument {
	/** The pasted text, its blank lines kept: they say where the Sideboard ends. */
	sourceText: string;
	/** Every card kept, the Commanders among them, each the printing its line named. */
	entries: BroadcastDeckListCanonicalEntry[];
	/** The printings offered as the Commanders, one or two, by Scryfall id. */
	offeredCommanders: string[];
	/** How many cards the dropped Sideboard held. */
	sideboardDropped: number;
}

export type CommanderDeckListImportResult
	= | { ok: true; document: CommanderDeckListDocument }
		| { ok: false; errors: CommanderDeckListImportError[] };

/** Where a card line sits: `trailing` is after the Sideboard and a blank line. */
type Section = 'deck' | 'commander' | 'sideboard' | 'trailing';

const HEADINGS = new Map<string, Section>([
	['commander', 'commander'],
	['deck', 'deck'],
	['mainboard', 'deck'],
	['sideboard', 'sideboard'],
]);

interface KeptRow extends ParsedCardLine {
	section: Exclude<Section, 'sideboard'>;
}

export async function importCommanderDeckList(
	source: string,
	resolver: BroadcastDeckListCardResolver,
): Promise<CommanderDeckListImportResult> {
	const lines = sourceLines(source);
	if (!Array.isArray(lines)) {
		return {
			ok: false,
			errors: [lines],
		};
	}

	let section: Section = 'deck';
	let commanderHeading: SourceLine | null = null;
	/** Card lines read since the Sideboard heading: a blank line ends the Sideboard only after one. */
	let sideboardLines = 0;
	const kept: KeptRow[] = [];
	const dropped: ParsedCardLine[] = [];
	const errors: CommanderDeckListImportError[] = [];

	for (const line of lines) {
		const { sourceText } = line;
		if (sourceText.length === 0) {
			if (section === 'sideboard' && sideboardLines > 0)
				section = 'trailing';
			continue;
		}
		// The Arena copy opens with `About` and the deck's `Name`.
		if (/^(?:about|name)(?:\s|$)/i.test(sourceText))
			continue;
		const heading = headingKey(sourceText);
		const headed = HEADINGS.get(heading);
		if (headed) {
			section = headed;
			sideboardLines = 0;
			if (headed === 'commander')
				commanderHeading ??= line;
			continue;
		}
		if (UNREAD_SECTIONS.has(heading) || heading === 'companion') {
			errors.push(lineError(line, 'UNSUPPORTED_SECTION', 'This section is not supported'));
			continue;
		}
		if (/^(?:#|\/\/|;)/.test(sourceText)) {
			errors.push(lineError(line, 'UNSUPPORTED_SYNTAX', 'Comments are not supported'));
			continue;
		}

		const parsed = parseCardLine(line);
		if ('code' in parsed) {
			errors.push(parsed);
		}
		else if (section === 'sideboard') {
			sideboardLines++;
			dropped.push(parsed);
		}
		else {
			kept.push({ ...parsed, section });
		}
	}

	const headedCommanders = kept.filter(row => row.section === 'commander');
	const trailing = kept.filter(row => row.section === 'trailing');
	const offered = commanderHeading
		? headedCommanders
		: trailing.length > 0
			? trailing
			: kept.slice(0, 1);
	if (commanderHeading && headedCommanders.length === 0)
		errors.push(lineError(commanderHeading, 'NO_COMMANDER', 'A Commander heading needs a card under it'));
	const extra = offered[MAX_SEAT_COMMANDERS];
	if (extra)
		errors.push(lineError(extra, 'TOO_MANY_COMMANDERS', 'A deck has one or two Commanders'));

	const limitErrors = cardRowLimitErrors([
		...kept,
		...dropped,
	]);
	errors.push(...limitErrors);
	if (errors.length === 0 && kept.length === 0)
		errors.push({ code: 'EMPTY_DECK_LIST', message: 'At least one card outside the Sideboard is required' });
	if (limitErrors.length > 0 || kept.length === 0) {
		return {
			ok: false,
			errors: orderedErrors(errors),
		};
	}

	const resolved = await resolveCardLines(kept, resolver);
	const entries: BroadcastDeckListCanonicalEntry[] = [];
	const offeredCommanders = new Set<string>();
	const exceeded = new Set<string>();
	for (const [index, row] of kept.entries()) {
		const card = resolved[index]!;
		if ('code' in card) {
			errors.push(card);
			continue;
		}
		const entry = addToBoard(entries, card, row.quantity);
		if (entry.quantity > MAX_ENTRY_QUANTITY && !exceeded.has(card.scryfallId)) {
			exceeded.add(card.scryfallId);
			errors.push({
				code: 'MERGED_QUANTITY_EXCEEDED',
				message: `${card.canonicalName} exceeds the merged quantity limit of 999`,
			});
		}
		if (offered.includes(row))
			offeredCommanders.add(card.scryfallId);
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
			sourceText: lines.map(line => line.sourceText).join('\n').replace(/^\n+|\n+$/g, ''),
			entries,
			offeredCommanders: [...offeredCommanders],
			sideboardDropped: dropped.reduce((total, row) => total + row.quantity, 0),
		},
	};
}
