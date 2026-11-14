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

/**
 * A list's Mainboard: every copy but one of each Commander it holds. A
 * Commander the list does not hold takes nothing from it.
 */
export function commanderMainboard<TEntry extends Pick<CommanderDeckListEntry, 'scryfallId' | 'quantity'>>(
	entries: readonly TEntry[],
	commanders: ReadonlyArray<Pick<Commander, 'scryfallId'>>,
): TEntry[] {
	const held = new Set(commanders.map(commander => commander.scryfallId));
	return entries.flatMap((entry) => {
		if (!held.has(entry.scryfallId))
			return [entry];
		return entry.quantity > 1
			? [
					{ ...entry, quantity: entry.quantity - 1 },
				]
			: [];
	});
}

/** How many cards a list's Mainboard holds. */
export function commanderMainboardCount(
	entries: ReadonlyArray<Pick<CommanderDeckListEntry, 'scryfallId' | 'quantity'>>,
	commanders: ReadonlyArray<Pick<Commander, 'scryfallId'>>,
): number {
	return commanderMainboard(entries, commanders).reduce((total, entry) => total + entry.quantity, 0);
}
