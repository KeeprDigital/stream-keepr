import type {
	BroadcastDeckListCardResolutionRequest,
	BroadcastDeckListCardResolver,
	ResolvedBroadcastDeckListCard,
} from '~~/server/modules/broadcast-deck-list-import';
import { vi } from 'vitest';

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
				: { status: 'resolved' as const, card: resolvedCard(request) })),
	};
}
