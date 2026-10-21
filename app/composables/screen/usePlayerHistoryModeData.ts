import type { MatchResponse } from '~~/shared/api';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import type { Player } from '~/types';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { usePaginatedScreenMode } from '~/modules/screen-mode/pagination';

export interface PlayerMatchHistoryEntry {
	id: number;
	roundId: number;
	roundName: string;
	roundNumber: number;
	phaseName: string;
	tableNumber: number | null;
	opponentId: number | null;
	opponentName: string;
	opponentDeckName: string | null;
	opponentDeckColors: string | null;
	outcome: 'win' | 'loss' | 'draw' | 'bye' | 'pending';
	playerGameWins: number | null;
	opponentGameWins: number | null;
	gameDraws: number | null;
	hasResult: boolean;
	resultString: string | null;
}

interface PlayerHistory {
	player: Player | null;
	rows: PlayerMatchHistoryEntry[];
}

/**
 * The Event Data a Player's match history is read from: the Player and their
 * opponents, their Matches, those Matches' Rounds and Phases, and the
 * opponents' Archetypes. Phases and Melee syncs are rare and not identified in
 * a history row, so any of them re-reads.
 */
function playerHistoryDependencies(playerId: () => number | null): ScreenModeDependencies<PlayerHistory> {
	const involvesPlayer = (match: MatchResponse) =>
		match.player1Id === playerId() || match.player2Id === playerId();
	const holdsMatch = (held: PlayerHistory, matchId: number) => held.rows.some(row => row.id === matchId);
	const holdsRound = (held: PlayerHistory, roundId: number) => held.rows.some(row => row.roundId === roundId);
	const holdsOpponent = (held: PlayerHistory, id: number) => held.rows.some(row => row.opponentId === id);
	// An opponent's deck name may come from their Archetype.
	const showsOpponentDeck = (_message: unknown, held: PlayerHistory) => held.rows.some(row => row.opponentDeckName != null);

	return {
		'player:updated': ({ player }, held) => player.id === playerId() || holdsOpponent(held, player.id),
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
		'melee:roundSynced': true,
		'melee:playersSynced': true,
		'melee:decklistsSynced': true,
	};
}

export function usePlayerHistoryModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('player-history');
	const outputReads = useScreenOutputReads();

	const freshness = useScreenModeFreshness<PlayerHistory>({
		eventId,
		source: () => outputReads.scopeKey.value && config.value.playerId
			? `${outputReads.scopeKey.value}:${config.value.playerId}`
			: null,
		read: async () => {
			const data = await outputReads.playerHistory();
			return { player: data.player, rows: data.history };
		},
		initialData: { player: null, rows: [] },
		errorMessage: 'Failed to load player match history',
		dependsOn: playerHistoryDependencies(() => config.value.playerId),
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const player = computed(() => freshness.data.value.player);
	const rows = computed(() => freshness.data.value.rows);

	const headerText = computed(() => config.value.headerText || (player.value ? `${player.value.name} Match History` : 'Player Match History'));
	const isEmpty = computed(() => !loading.value && (!config.value.playerId || rows.value.length === 0));
	const emptyMessage = computed(() => !config.value.playerId ? 'Select a player to show match history.' : 'No matches found for this player.');

	const { pageData } = usePaginatedScreenMode({ mode: 'player-history', config, rows });

	function formatOutcome(row: PlayerMatchHistoryEntry) {
		if (row.outcome === 'bye')
			return 'BYE';
		if (!row.hasResult)
			return 'Pending';
		if (row.playerGameWins != null && row.opponentGameWins != null)
			return `${row.outcome.toUpperCase()} ${row.playerGameWins}-${row.opponentGameWins}${row.gameDraws ? `-${row.gameDraws}` : ''}`;
		return row.resultString ?? 'Result';
	}

	return { config, loading, error, isEmpty, emptyMessage, headerText, pageData, player, formatOutcome };
}
