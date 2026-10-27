import type { PlayerHistory, PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import type { Player } from '~/types';
import { playerHistoryDependencies } from '~/composables/screen/usePlayerHistoryModeData';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';

/**
 * A Player's match history for the operator, kept current while it is read:
 * it re-reads on the Event Data a Player History Screen follows (ADR-0048).
 */
export function usePlayerMatchHistory(playerId: () => number | null) {
	const eventStore = useEventStore();
	const eventId = computed(() => eventStore.eventId ?? null);

	const freshness = useScreenModeFreshness<PlayerHistory>({
		eventId,
		source: () => eventId.value && playerId()
			? `${eventId.value}:${playerId()}`
			: null,
		read: async () => {
			const data = await $fetch<{ player: Player; history: PlayerMatchHistoryEntry[] }>(`/api/events/${eventId.value}/players/${playerId()}/match-history`);
			return { player: data.player, rows: data.history };
		},
		initialData: { player: null, rows: [] },
		errorMessage: 'Failed to load match history',
		dependsOn: playerHistoryDependencies(playerId),
	});

	// A read holds the last Player's answer until the next one's arrives; it is not this Player's history.
	const answersPlayer = computed(() => freshness.data.value.player?.id === playerId());

	return {
		player: computed(() => answersPlayer.value
			? freshness.data.value.player
			: null),
		history: computed(() => answersPlayer.value
			? freshness.data.value.rows
			: []),
		loading: computed(() => !!eventId.value && !!playerId() && !answersPlayer.value && !freshness.error.value),
		error: freshness.error,
	};
}
