import type { DbArchetype, DbPlayerDeck } from '~~/server/db/schema';
import type { PlayerSlotData } from '~~/shared/api';
import { hasReviewedPlayerDeckDetails, resolvePlayerDeckDetails } from '~~/server/mappers/playerDeck';

type MatchDeckArchetype = Pick<DbArchetype, 'id' | 'name' | 'colors'>;

export interface MatchDeckSelection {
	/** Stable local identity carried by an existing match snapshot. */
	deckId?: number | null;
	/** Stable upstream identities supplied on the Melee match competitor. */
	externalIds?: readonly string[];
	/** Ordered format fallbacks, from the most specific upstream source to the least specific. */
	formatExternalIds?: readonly (string | null | undefined)[];
	/** Backwards-compatible single format fallback. */
	formatExternalId?: string | null;
}

export type MatchDeckSelectionStrategy = 'deck-id' | 'external-id' | 'format' | 'primary' | 'none';

export interface MatchDeckResolution {
	deck: DbPlayerDeck | null;
	strategy: MatchDeckSelectionStrategy;
	ambiguous: boolean;
}

function compareDecks(a: DbPlayerDeck, b: DbPlayerDeck) {
	return a.sortOrder - b.sortOrder || a.id - b.id;
}

function chooseDeterministically(
	decks: DbPlayerDeck[],
): { deck: DbPlayerDeck | null; ambiguous: boolean } {
	const sorted = decks.slice().sort(compareDecks);
	return { deck: sorted[0] ?? null, ambiguous: sorted.length > 1 };
}

function orderedFormats(selection: MatchDeckSelection): string[] {
	const formats: string[] = [];
	for (const value of [...(selection.formatExternalIds ?? []), selection.formatExternalId]) {
		if (value && !formats.includes(value))
			formats.push(value);
	}
	return formats;
}

/**
 * Resolve the deck attached to one match side using stable identities first.
 * No arbitrary deck fallback is allowed after primary selection fails.
 */
export function selectMatchDeck(
	decks: DbPlayerDeck[],
	selection: MatchDeckSelection,
): MatchDeckResolution {
	const formats = orderedFormats(selection);

	if (selection.deckId != null) {
		const deck = decks.find(deck => deck.id === selection.deckId) ?? null;
		if (deck)
			return { deck, strategy: 'deck-id', ambiguous: false };
	}

	const externalIds = new Set(selection.externalIds ?? []);
	if (externalIds.size > 0) {
		const exactDecks = decks.filter(deck => deck.externalSource === 'melee' && externalIds.has(deck.externalId));
		if (exactDecks.length > 0) {
			for (const formatExternalId of formats) {
				const matchingFormat = exactDecks.filter(deck => deck.formatExternalId === formatExternalId);
				if (matchingFormat.length > 0) {
					const selected = chooseDeterministically(matchingFormat);
					return { ...selected, strategy: 'external-id' };
				}
			}

			const selected = chooseDeterministically(exactDecks);
			return { ...selected, strategy: 'external-id' };
		}
	}

	for (const formatExternalId of formats) {
		const formatDecks = decks.filter(deck => deck.formatExternalId === formatExternalId);
		if (formatDecks.length > 0) {
			const selected = chooseDeterministically(formatDecks);
			return { ...selected, strategy: 'format' };
		}
	}

	const primary = decks.find(deck => deck.isPrimary) ?? null;
	return primary
		? { deck: primary, strategy: 'primary', ambiguous: false }
		: { deck: null, strategy: 'none', ambiguous: false };
}

function looksLikeMtgData(gameData: PlayerSlotData['gameData']): boolean {
	if (!gameData)
		return false;
	return gameData.type === 'mtg'
		|| (!('type' in gameData) && ('deckName' in gameData || 'deckColors' in gameData));
}

/** Apply one resolved submitted deck to an embedded player snapshot. */
export function applyMatchDeckSnapshot(
	base: PlayerSlotData,
	deck: DbPlayerDeck | null,
	archetype?: MatchDeckArchetype | null,
	options: { expectsMtgDeck?: boolean } = {},
): PlayerSlotData {
	if (deck) {
		const details = resolvePlayerDeckDetails(deck, archetype);
		return {
			...base,
			deckId: deck.id,
			archetypeId: hasReviewedPlayerDeckDetails(deck, archetype) ? deck.archetypeId : null,
			gameData: {
				...(base.gameData?.type === 'mtg' ? base.gameData : {}),
				type: 'mtg',
				deckName: details.name,
				deckColors: details.colors,
			},
		};
	}

	if (options.expectsMtgDeck || looksLikeMtgData(base.gameData)) {
		return {
			...base,
			deckId: null,
			archetypeId: null,
			gameData: { type: 'mtg', deckName: null, deckColors: null },
		};
	}

	return { ...base, deckId: null };
}
