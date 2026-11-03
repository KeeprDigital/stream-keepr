import type { OpCardSummary } from '~~/shared/types/card/op';
import type { OpLeader } from '~~/shared/types/game';
import { vi } from 'vitest';

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

/** A Card as bandai-keepr's `GET /cards/:number` answers it, with its standard Printing. */
export function bandaiKeeprCard(overrides: {
	number: string;
	name: string;
	category: string;
	colors: string[];
	cost?: number | null;
	power?: number | null;
	counter?: number | null;
}) {
	return {
		sourcePrintingId: overrides.number,
		cost: null,
		life: null,
		power: null,
		counter: null,
		types: [],
		effect: null,
		trigger: null,
		...overrides,
		printings: [
			{
				id: overrides.number,
				setId: 'OP-01',
				kind: 'standard',
				rarity: 'C',
			},
		],
	};
}

/**
 * Fakes bandai-keepr at `fetch`: it knows `cards` by number and answers 404
 * for any other. `lookups()` lists the numbers asked for since `reset()`.
 */
export function stubBandaiKeepr(cards: ReturnType<typeof bandaiKeeprCard>[]) {
	const byNumber = new Map(cards.map(card => [card.number, card]));
	let asked: string[] = [];
	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(new Request(input, init).url);
		const number = /^\/cards\/([^/]+)$/.exec(url.pathname)?.[1];
		if (!number)
			return Response.json({ error: `unrouted ${url.pathname}` }, { status: 500 });
		const decoded = decodeURIComponent(number);
		asked.push(decoded);
		const card = byNumber.get(decoded);
		return card
			? Response.json(card)
			: Response.json({ error: 'Card not found' }, { status: 404 });
	});
	return {
		lookups: () => [...asked],
		reset: () => {
			asked = [];
		},
	};
}
