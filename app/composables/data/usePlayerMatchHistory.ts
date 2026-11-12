import type { MatchResponse } from '~~/shared/api';
import type { PlayerHistory, PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import type { Player } from '~/types';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';

/**
 * The Event Data a Player's match history is read from: the Player and their
 * opponents, their Matches, those Matches' Rounds and Phases, and the
 * opponents' Archetypes. Phases and Melee syncs are rare and not identified in
 * a history row, so any of them re-reads, except a sync of Round Standings,
 * which the history does not show.
 */
export function playerHistoryDependencies(playerId: () => number | null): ScreenModeDependencies<PlayerHistory> {
	const involvesPlayer = (match: MatchResponse) =>
		match.player1Id === playerId() || match.player2Id === playerId();
	const holdsMatch = (held: PlayerHistory, matchId: number) => held.rows.some(row => row.id === matchId);
	const holdsRound = (held: PlayerHistory, roundId: number) => held.rows.some(row => row.roundId === roundId);
	const holdsOpponent = (held: PlayerHistory, id: number) => held.rows.some(row => row.opponentId === id);
	// An opponent's deck name may come from their Archetype.
	const showsOpponentDeck = (_message: unknown, held: PlayerHistory) => held.rows.some(row => row.opponentDeckName != null);

	return {
		'player:updated': ({ player }, held) => player.id === playerId() || holdsOpponent(held, player.id),
		// Naming no Player, it may have re-projected any of them (ADR-0084).
		'player:deckProjectionsChanged': ({ playerIds }, held) =>
			playerIds === null || playerIds.some(id => id === playerId() || holdsOpponent(held, id)),
		'player:deleted': ({ playerId: id }, held) => id === playerId() || holdsOpponent(held, id),
		'match:created': ({ match }) => involvesPlayer(match),
		'match:updated': ({ match }, held) => involvesPlayer(match) || holdsMatch(held, match.id),
		'match:deleted': ({ matchId }, held) => holdsMatch(held, matchId),
		'round:updated': ({ round }, held) => holdsRound(held, round.id),
		'round:deleted': ({ roundId }, held) => holdsRound(held, roundId),
		'round:matchesRefreshed': true,
		'phase:updated': true,
		'phase:deleted': true,
		'archetype:updated': showsOpponentDeck,
		'archetype:deleted': showsOpponentDeck,
		'melee:dataReset': true,
		'melee:structureSynced': true,
		'melee:matchResultsSynced': true,
		'melee:pairingsSynced': true,
		'melee:playersSynced': true,
		'melee:decklistsSynced': true,
	};
}

/**
 * A Player's match history for the operator, kept current while it is read:
 * it re-reads on the Event Data a Player History Screen follows (ADR-0048).
 */
export function usePlayerMatchHistory(playerId: () => number | null) {
	const eventStore = useEventStore();
	const eventId = computed(() => eventStore.eventId ?? null);

	// An operator page is in its Event's room, and this read belongs to no Screen.
	const dependsOn = playerHistoryDependencies(playerId);
	const freshness = useScreenModeFreshness<PlayerHistory>({
		hearing: () => ({
			channel: eventId.value
				? eventRealtimeChannel(eventId.value)
				: null,
			dependsOn,
		}),
		source: () => eventId.value && playerId()
			? `${eventId.value}:${playerId()}`
			: null,
		read: async () => {
			const data = await $fetch<{ player: Player; history: PlayerMatchHistoryEntry[] }>(`/api/events/${eventId.value}/players/${playerId()}/match-history`);
			return { player: data.player, rows: data.history };
		},
		initialData: { player: null, rows: [] },
		errorMessage: 'Failed to load match history',
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
