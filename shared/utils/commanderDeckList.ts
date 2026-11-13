import type { CommanderDeckListEntry } from '../types/featureMatchDeckList';
import type { Commander } from '../types/game';
import { orderedColourIdentity } from './commander';

/**
 * A Commander Seat's Feature Match Deck List holds every card pasted, and the
 * Seat names which of them are its Commanders (ADR-0087).
 */

/** The Commander one card of a Seat's list is: that printing, named by its front face. */
export function commanderOfDeckListEntry(entry: CommanderDeckListEntry): Commander {
	return {
		scryfallId: entry.scryfallId,
		name: entry.name.split(' // ')[0]!,
		colorIdentity: orderedColourIdentity(entry.colorIdentity),
		setCode: entry.setCode,
		collectorNumber: entry.collectorNumber ?? '',
	};
}

/** How many cards of a list are its Mainboard: every copy but one of each Commander it holds. */
export function commanderMainboardCount(
	entries: ReadonlyArray<Pick<CommanderDeckListEntry, 'scryfallId' | 'quantity'>>,
	commanders: ReadonlyArray<Pick<Commander, 'scryfallId'>>,
): number {
	const held = new Set(commanders.map(commander => commander.scryfallId));
	return entries.reduce((total, entry) => total + entry.quantity - (held.has(entry.scryfallId)
		? 1
		: 0), 0);
}
