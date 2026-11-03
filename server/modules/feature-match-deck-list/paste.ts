import type {
	FeatureMatchDeckListEntry,
	FeatureMatchDeckListView,
	FeatureMatchDeckListWarning,
} from '~~/shared/types/featureMatchDeckList';
import { parseOpCardNumber } from '~~/shared/utils/card/op';

/**
 * The rules of a pasted Feature Match Deck List (ADR-0057): how its text reads,
 * and which deck rule breaches it warns of. A breach never refuses a save.
 */

/** A One Piece Mainboard holds this many cards, and a card number at most four copies. */
export const OP_MAINBOARD_SIZE = 50;
export const OP_MAX_COPIES = 4;

export interface PastedDeckListLine {
	number: string;
	quantity: number;
}

/**
 * `N[x] CARDNUMBER [name]`: a quantity, an optional `x`, a card number (a
 * Printing id reads as its card number), and anything after it ignored.
 */
const CARD_LINE = /^(\d+)\s*(?:x\s*)?([a-z]{1,4}\d{0,2}-\d{3})(?:_[a-z]\d+)?(?:\s.*)?$/i;

/**
 * The cards a paste names, in paste order, a number pasted twice added into
 * its first line. Every other line (blank, heading, unreadable) is ignored.
 */
export function parseFeatureMatchDeckListText(text: string): PastedDeckListLine[] {
	const byNumber = new Map<string, PastedDeckListLine>();
	for (const line of text.split(/\r?\n/)) {
		const match = CARD_LINE.exec(line.trim());
		if (!match)
			continue;
		const quantity = Number(match[1]);
		const number = parseOpCardNumber(match[2]!);
		if (!number || quantity < 1)
			continue;
		const held = byNumber.get(number);
		if (held)
			held.quantity += quantity;
		else
			byNumber.set(number, { number, quantity });
	}
	return [
		...byNumber.values(),
	];
}

function isLeader(entry: FeatureMatchDeckListEntry): boolean {
	return entry.card?.category === 'leader';
}

function cardsWord(count: number): string {
	return count === 1
		? 'card'
		: 'cards';
}

/** A Deck List's Leader, Mainboard count and warnings, read from its entries. */
export function featureMatchDeckListView(entries: FeatureMatchDeckListEntry[]): FeatureMatchDeckListView {
	const leaders = entries.filter(isLeader);
	const leader = leaders[0] ?? null;
	const mainboard = entries.filter(entry => !isLeader(entry));
	const mainboardCount = mainboard.reduce((sum, entry) => sum + entry.quantity, 0);

	const warnings: FeatureMatchDeckListWarning[] = [];
	if (mainboardCount !== OP_MAINBOARD_SIZE) {
		warnings.push({
			code: 'MAINBOARD_COUNT',
			message: `The Mainboard has ${mainboardCount} ${cardsWord(mainboardCount)}, not ${OP_MAINBOARD_SIZE}.`,
			count: mainboardCount,
		});
	}
	for (const entry of entries) {
		if (entry.quantity > OP_MAX_COPIES) {
			warnings.push({
				code: 'TOO_MANY_COPIES',
				message: `${entry.number} has ${entry.quantity} copies; a deck holds at most ${OP_MAX_COPIES}.`,
				number: entry.number,
				quantity: entry.quantity,
			});
		}
	}
	if (leaders.length === 0) {
		warnings.push({ code: 'NO_LEADER', message: 'No Leader: no pasted card is a Leader.' });
	}
	else if (leaders.length > 1) {
		const numbers = leaders.map(entry => entry.number);
		warnings.push({
			code: 'MULTIPLE_LEADERS',
			message: `${leaders.length} Leaders (${numbers.join(', ')}); ${leader!.number} is used.`,
			numbers,
		});
	}
	const leaderColors = leader?.card?.colors ?? [];
	if (leader) {
		const offColour = mainboard
			.filter(entry => entry.card && !entry.card.colors.some(color => leaderColors.includes(color)))
			.map(entry => entry.number);
		if (offColour.length > 0) {
			warnings.push({
				code: 'OFF_COLOUR',
				message: `Off the Leader's colours: ${offColour.join(', ')}.`,
				numbers: offColour,
			});
		}
	}
	const unknown = entries.filter(entry => !entry.card).map(entry => entry.number);
	if (unknown.length > 0) {
		warnings.push({
			code: 'UNKNOWN_CARD',
			message: `Card data has no card ${unknown.join(', ')}; kept as ${unknown.length === 1
				? 'a number'
				: 'numbers'} only.`,
			numbers: unknown,
		});
	}

	return {
		entries,
		leaderNumber: leader?.number ?? null,
		mainboardCount,
		warnings,
	};
}
