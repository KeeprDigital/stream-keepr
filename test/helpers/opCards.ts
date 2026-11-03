import type { OpCardSummary } from '~~/shared/types/card/op';
import type { OpLeader } from '~~/shared/types/game';

/** One Piece card fixtures: a searched card as bandai-keepr's proxy answers it, and a Slot side's Leader snapshot. */

/** A Leader card as the Event's `op-cards` search answers it. */
export function opCardSummary(overrides: Partial<OpCardSummary> = {}): OpCardSummary {
	return {
		number: 'OP01-001',
		name: 'Roronoa Zoro',
		category: 'leader',
		colors: ['Red'],
		cost: null,
		life: 5,
		power: 5000,
		counter: null,
		types: ['Supernovas'],
		effect: null,
		trigger: null,
		printingId: 'OP01-001',
		imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
		...overrides,
	};
}

/** A Leader as a Feature Match Slot side holds it, imaged by its standard Printing. */
export function opLeader(number: string, name: string, colors: OpLeader['colors']): OpLeader {
	return {
		number,
		name,
		colors,
		imageUrl: `https://cards-img.keepr.digital/${number}.png`,
	};
}

export const ZORO = opLeader('OP01-001', 'Roronoa Zoro', ['Red']);
export const LUFFY = opLeader('OP01-003', 'Monkey.D.Luffy', ['Red', 'Green']);
export const NAMI = opLeader('OP01-016', 'Nami', ['Blue']);
export const LAW = opLeader('OP01-002', 'Trafalgar Law', ['Red', 'Green']);
