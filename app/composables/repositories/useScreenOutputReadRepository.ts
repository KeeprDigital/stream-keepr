import type { BroadcastGraphicsLiveSessionResponse } from '~~/shared/types/broadcastGraphicsLiveSession';
import type { ScreenCardState } from '~~/shared/types/card/mtg';
import type { CardBreakdownResponse } from '~~/shared/types/metagame';
import type {
	ScreenOutputFeatureMatchResponse,
	ScreenOutputMetagameResponse,
	ScreenOutputPlayerDecksResponse,
	ScreenOutputStandingsResponse,
	ScreenOutputTopCutResponse,
} from '~~/shared/types/screenOutputReads';
import type { ScreenOutputEvent } from '~~/shared/utils/screenOutputEvent';
import type { PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import type { Player } from '~/types';
import { screenOutputCapabilityHeaders } from '~~/shared/utils/screenOutput';

/** The Screen a rendering reads as, and the credential it reads with. */
export interface ScreenOutputReadScope {
	eventId: number;
	screenId: number;
	/** The Screen Output Asset Capability; absent on an operator embed, which its Session admits. */
	assetCapability?: string | null;
}

/**
 * The Screen Output read family (#604, ADR-0022): everything a rendering of a
 * Screen reads, addressed through that Screen.
 *
 * Every rendering of a Screen — Screen Output, Program monitor, editor preview —
 * reads here rather than through the operator's Event Data paths, whatever
 * credential it holds. The server admits the capability or a Session alike, so
 * no caller ever chooses a path by credential.
 */
export function useScreenOutputReadRepository() {
	async function read<T>(scope: ScreenOutputReadScope, resource: string, query?: Record<string, unknown>): Promise<T> {
		return await $fetch<T>(`/api/screen-output/events/${scope.eventId}/screens/${scope.screenId}/${resource}`, {
			headers: screenOutputCapabilityHeaders(scope.assetCapability),
			...(query ? { query } : {}),
		}) as T;
	}

	return {
		event: (scope: ScreenOutputReadScope) => read<ScreenOutputEvent>(scope, 'event'),
		card: (scope: ScreenOutputReadScope) => read<ScreenCardState>(scope, 'card'),
		liveSession: (scope: ScreenOutputReadScope) =>
			read<BroadcastGraphicsLiveSessionResponse>(scope, 'broadcast-graphics/live-session'),
		playerHistory: (scope: ScreenOutputReadScope) =>
			read<{ player: Player; history: PlayerMatchHistoryEntry[] }>(scope, 'player-history'),
		standings: (scope: ScreenOutputReadScope) => read<ScreenOutputStandingsResponse>(scope, 'standings'),
		metagame: (scope: ScreenOutputReadScope) => read<ScreenOutputMetagameResponse>(scope, 'metagame'),
		topCards: (scope: ScreenOutputReadScope) => read<CardBreakdownResponse>(scope, 'top-cards'),
		topCut: (scope: ScreenOutputReadScope) => read<ScreenOutputTopCutResponse>(scope, 'top-cut'),
		featureMatchSlot: (scope: ScreenOutputReadScope, slotId: number) =>
			read<ScreenOutputFeatureMatchResponse>(scope, `feature-match-slots/${slotId}`),
		playerDecks: (scope: ScreenOutputReadScope, playerId: number, selection: { deckId?: number } = {}) =>
			read<ScreenOutputPlayerDecksResponse>(
				scope,
				`players/${playerId}/decks`,
				selection.deckId != null ? { deckId: selection.deckId } : undefined,
			),
	};
}
