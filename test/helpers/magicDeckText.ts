import type {
	BroadcastDeckListCardResolutionRequest,
	BroadcastDeckListCardResolver,
	ResolvedBroadcastDeckListCard,
} from '~~/server/modules/broadcast-deck-list-import';
import type { CommanderDeckListEntry } from '~~/shared/types/featureMatchDeckList';
import type { Commander } from '~~/shared/types/game';
import type { FakeScryfallCard } from './scryfallFake';
import { vi } from 'vitest';
import { orderedColourIdentity } from '~~/shared/utils/commander';

/** Magic deck text, and a card resolver port answering it, for the parser's two owners. */

/** Moxfield's own copy (#1178): the Commander first, each card with its printing, then the Sideboard. */
export const MOXFIELD_COPY = [
	'1 Ashling, the Limitless (ECC) 1',
	'1 Animar, Soul of Elements (2X2) 171',
	'1 Eirdu, Carrier of Dawn / Isilu, Carrier of Twilight (ECL) 13',
	'1 Garruk\'s Uprising (PLST) M21-186',
	'1 Graveshifter (ECL) 104 *F*',
	'1 Hedge Maze (PMKM) 262p',
	'3 Forest (KLD) 264',
	'',
	'SIDEBOARD:',
	'1 Arbor Elf (WWK) 95',
].join('\n');

/** Moxfield's copy for Arena (#1178): headed sections and no printings. */
export const ARENA_COPY = [
	'About',
	'Name (Ashling, the Limitless) Evoke the Horde',
	'',
	'Commander',
	'1 Ashling, the Limitless',
	'',
	'Deck',
	'1 Ashnod\'s Altar',
	'',
	'Sideboard',
	'1 Endurance',
].join('\n');

/** Moxfield's copy for MTGO and as plain text (#1178): the Commander last, after the Sideboard. */
export const MTGO_COPY = [
	'1 Animar, Soul of Elements',
	'3 Forest',
	'',
	'SIDEBOARD:',
	'1 Arbor Elf',
	'',
	'1 Ashling, the Limitless',
].join('\n');

/** The printings the three copies name, as Scryfall holds them; a name alone answers the first of that name. */
export const MOXFIELD_CARDS = {
	ashling: {
		id: '0a5b1c2d-3e4f-4a6b-8c7d-9e0f1a2b3c01',
		name: 'Ashling, the Limitless',
		set: 'ecc',
		collector_number: '1',
		type_line: 'Legendary Creature — Elemental Sorcerer',
		color_identity: ['B', 'G', 'R', 'U', 'W'],
	},
	animar: {
		id: '0a5b1c2d-3e4f-4a6b-8c7d-9e0f1a2b3c02',
		name: 'Animar, Soul of Elements',
		set: '2x2',
		collector_number: '171',
		type_line: 'Legendary Creature — Elemental',
		color_identity: ['G', 'R', 'U'],
	},
	eirdu: {
		id: '0a5b1c2d-3e4f-4a6b-8c7d-9e0f1a2b3c03',
		name: 'Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight',
		set: 'ecl',
		collector_number: '13',
		type_line: 'Legendary Creature — Elemental God // Legendary Creature — Elemental God',
		color_identity: ['B', 'W'],
	},
	garruksUprising: {
		id: '0a5b1c2d-3e4f-4a6b-8c7d-9e0f1a2b3c04',
		name: 'Garruk\'s Uprising',
		set: 'plst',
		collector_number: 'M21-186',
		type_line: 'Enchantment',
		color_identity: ['G'],
	},
	graveshifter: {
		id: '0a5b1c2d-3e4f-4a6b-8c7d-9e0f1a2b3c05',
		name: 'Graveshifter',
		set: 'ecl',
		collector_number: '104',
		type_line: 'Creature — Shapeshifter',
		color_identity: ['B'],
	},
	hedgeMaze: {
		id: '0a5b1c2d-3e4f-4a6b-8c7d-9e0f1a2b3c06',
		name: 'Hedge Maze',
		set: 'pmkm',
		collector_number: '262p',
		type_line: 'Land — Forest Island',
		color_identity: ['G', 'U'],
	},
	forest: {
		id: '0a5b1c2d-3e4f-4a6b-8c7d-9e0f1a2b3c07',
		name: 'Forest',
		set: 'kld',
		collector_number: '264',
		type_line: 'Basic Land — Forest',
		color_identity: ['G'],
	},
	ashnodsAltar: {
		id: '0a5b1c2d-3e4f-4a6b-8c7d-9e0f1a2b3c08',
		name: 'Ashnod\'s Altar',
		set: 'ema',
		collector_number: '218',
		type_line: 'Artifact',
	},
} satisfies Record<string, FakeScryfallCard>;

/** Ashling and Animar as a Seat holds them once confirmed from the list: each the list's printing. */
export const ASHLING: Commander = {
	scryfallId: MOXFIELD_CARDS.ashling.id,
	name: 'Ashling, the Limitless',
	colorIdentity: 'WUBRG',
	setCode: 'ecc',
	collectorNumber: '1',
};
export const ANIMAR: Commander = {
	scryfallId: MOXFIELD_CARDS.animar.id,
	name: 'Animar, Soul of Elements',
	colorIdentity: 'URG',
	setCode: '2x2',
	collectorNumber: '171',
};

/** A card of a Commander Seat's saved Deck List, as its read answers it. */
export function deckListEntryOf(card: FakeScryfallCard, quantity = 1): CommanderDeckListEntry {
	return {
		quantity,
		scryfallId: card.id,
		name: card.name,
		setCode: card.set,
		collectorNumber: card.collector_number ?? '1',
		cardType: card.type_line ?? null,
		colorIdentity: orderedColourIdentity(card.color_identity ?? []),
		manaCost: null,
		manaValue: null,
	};
}

/** The id a resolved request's printing answers by: its name, set and collector number. */
export function printingId(name: string, setCode: string | null = null, collectorNumber: string | null = null): string {
	return `${name}-${setCode ?? 'default'}-${collectorNumber ?? 'default'}`;
}

export function resolvedCard(
	request: BroadcastDeckListCardResolutionRequest,
	overrides: Partial<ResolvedBroadcastDeckListCard> = {},
): ResolvedBroadcastDeckListCard {
	return {
		canonicalName: request.name,
		scryfallId: printingId(request.name, request.setCode, request.collectorNumber),
		oracleId: `${request.name}-oracle`,
		setCode: request.setCode ?? 'dft',
		collectorNumber: request.collectorNumber ?? '1',
		cardType: 'Instant',
		colors: 'R',
		manaCost: '{R}',
		manaValue: 1,
		deckCounterTypes: [],
		...overrides,
	};
}

/** A resolver that knows every card asked of it but those named in `unknown`. */
export function resolvingAllCards(unknown: readonly string[] = []): BroadcastDeckListCardResolver {
	return {
		resolve: vi.fn(async (requests: readonly BroadcastDeckListCardResolutionRequest[]) => requests.map(request =>
			unknown.includes(request.name)
				? { status: 'unresolved' as const }
				: {
						status: 'resolved' as const,
						card: resolvedCard(request),
					})),
	};
}
