import type { ArchetypeDetailResponse } from '~~/shared/types/metagame';
import type { ScreenOutputArchetypePilot, ScreenOutputArchetypeSpotlightResponse } from '~~/shared/types/screenOutputReads';
import type { CardTypeBucket } from '~~/shared/utils/metagame';
import { createCardTypeBucketFilter } from './cards';

export interface ArchetypeSpotlightOptions {
	/** How many of the most-included cards to show. */
	cardLimit: number;
	/** Card-type buckets left out of the top cards before the limit applies. */
	excludedCardTypes: readonly CardTypeBucket[];
}

function byPosition(a: ScreenOutputArchetypePilot, b: ScreenOutputArchetypePilot): number {
	if (a.position !== b.position) {
		if (a.position == null)
			return 1;
		if (b.position == null)
			return -1;
		return a.position - b.position;
	}
	return a.name.localeCompare(b.name);
}

/**
 * The Archetype spotlight a Screen shows (#761), projected from the archetype
 * detail read the app's archetype page makes for the same scope and conversion
 * target, so its meta share, Conversion Rate and inclusion rates are that
 * page's numbers rather than a second computation of them.
 */
export function projectArchetypeSpotlight(
	detail: ArchetypeDetailResponse,
	options: ArchetypeSpotlightOptions,
): ScreenOutputArchetypeSpotlightResponse {
	const includesCardType = createCardTypeBucketFilter(options.excludedCardTypes);

	return {
		archetype: { id: detail.id, name: detail.name, colors: detail.colors },
		playerCount: detail.playerCount,
		metaShare: detail.metaShare,
		convertedCount: detail.convertedCount,
		conversionRate: detail.conversionRate,
		pilots: detail.players
			.map(({ id, name, position, points, wins, losses, draws }) => ({ id, name, position, points, wins, losses, draws }))
			.sort(byPosition),
		topCards: detail.cardBreakdown
			.filter(entry => includesCardType(entry.cardType))
			.slice(0, options.cardLimit),
	};
}
