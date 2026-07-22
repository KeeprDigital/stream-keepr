import type { DbArchetype, DbPlayerDeck } from '~~/server/db/schema';
import type { PlayerDeckSummaryResponse } from '~~/shared/types/metagame';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';
import { isReviewedPlayerDeck } from '~~/shared/utils/playerDeck';

export type PlayerDeckArchetype = Pick<DbArchetype, 'id' | 'name' | 'colors'>;

export function hasReviewedPlayerDeckDetails(
	deck: Pick<DbPlayerDeck, 'archetypeId' | 'reviewedAt'>,
	archetype?: Pick<DbArchetype, 'id'> | null,
): boolean {
	return isReviewedPlayerDeck(deck)
		&& archetype?.id === deck.archetypeId;
}

/**
 * Resolve the only deck details that app-facing read models should display.
 * Melee fields stay persisted as source data, while a completed review owns the
 * display name and colour identity everywhere else.
 */
export function resolvePlayerDeckDetails(
	deck: Pick<DbPlayerDeck, 'name' | 'colors' | 'archetypeId' | 'reviewedAt'>,
	archetype?: PlayerDeckArchetype | null,
) {
	const hasReviewedDetails = hasReviewedPlayerDeckDetails(deck, archetype);

	return {
		name: hasReviewedDetails && archetype ? archetype.name : deck.name,
		colors: hasReviewedDetails && archetype ? archetype.colors ?? '' : deck.colors,
		submittedName: deck.name,
		submittedColors: deck.colors,
	};
}

export function mapPlayerDeckSummary(
	deck: DbPlayerDeck,
	archetype?: PlayerDeckArchetype | null,
): PlayerDeckSummaryResponse {
	return mapTimestamps({
		...deck,
		...resolvePlayerDeckDetails(deck, archetype),
	});
}
