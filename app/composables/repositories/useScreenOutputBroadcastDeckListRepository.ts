import type { BroadcastDeckListResponse } from '~~/shared/types/broadcastDeckList';
import { screenOutputCapabilityHeaders } from '~~/shared/utils/screenOutput';

/** Read the Broadcast Deck List selected by one Screen, never the Event library. */
export function useScreenOutputBroadcastDeckListRepository() {
	async function getSelected(
		eventId: number,
		screenId: number,
		assetCapability?: string | null,
	): Promise<BroadcastDeckListResponse> {
		return await $fetch<BroadcastDeckListResponse>(
			`/api/screen-output/events/${eventId}/screens/${screenId}/broadcast-deck-list`,
			{ headers: screenOutputCapabilityHeaders(assetCapability) },
		);
	}

	return { getSelected };
}
