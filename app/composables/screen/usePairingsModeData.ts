import type { ScreenOutputPairingsResponse, ScreenOutputRoundMatch } from '~~/shared/types/screenOutputReads';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { usePaginatedScreenMode } from '~/modules/screen-mode/pagination';

type HeldPairings = ScreenOutputPairingsResponse | null;

/**
 * The Event Data a Round's pairings are read from: the Round, its Matches, and
 * the Players they seat. Melee's wholesale syncs of structure and Players
 * re-read; a Round sync re-reads only for this Round.
 */
function pairingsDependencies(roundId: () => number | undefined): ScreenModeDependencies<HeldPairings> {
	const isRound = (id: number) => id === roundId();
	const holdsMatch = (held: HeldPairings, matchId: number) => held?.matches.some(row => row.matchId === matchId) ?? false;
	const holdsPlayer = (held: HeldPairings, playerId: number) =>
		held?.matches.some(row => row.player1?.id === playerId || row.player2?.id === playerId) ?? false;

	return {
		'player:updated': ({ player }, held) => holdsPlayer(held, player.id),
		'player:deleted': ({ playerId }, held) => holdsPlayer(held, playerId),
		'match:created': ({ match }) => isRound(match.roundId),
		'match:updated': ({ match }, held) => isRound(match.roundId) || holdsMatch(held, match.id),
		'match:deleted': ({ matchId }, held) => holdsMatch(held, matchId),
		'round:updated': ({ round }) => isRound(round.id),
		'round:deleted': ({ roundId: id }) => isRound(id),
		'round:matchesRefreshed': ({ roundId: id }) => isRound(id),
		'melee:roundSynced': ({ roundId: id }) => isRound(id),
		'melee:dataReset': true,
		'melee:structureSynced': true,
		'melee:playersSynced': true,
	};
}

export function usePairingsModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('pairings');
	const outputReads = useScreenOutputReads();

	const freshness = useScreenModeFreshness<HeldPairings>({
		eventId,
		source: () => outputReads.scopeKey.value && config.value.roundId
			? `${outputReads.scopeKey.value}:${config.value.roundId}`
			: null,
		read: () => outputReads.pairings(),
		initialData: null,
		errorMessage: 'Failed to load pairings',
		dependsOn: pairingsDependencies(() => config.value.roundId),
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const round = computed(() => freshness.data.value?.round ?? null);
	const rows = computed(() => freshness.data.value?.matches ?? []);

	const headerText = computed(() => config.value.headerText || (round.value ? `${round.value.name} Pairings` : 'Pairings'));
	const isEmpty = computed(() => !loading.value && (!config.value.roundId || rows.value.length === 0));

	const { pageData, rowCount } = usePaginatedScreenMode({ mode: 'pairings', config, rows });

	function formatResult(row: ScreenOutputRoundMatch) {
		if (row.isBye)
			return 'BYE';
		if (!row.hasResult)
			return 'Pending';
		if (row.player1GameWins != null && row.player2GameWins != null)
			return `${row.player1GameWins}-${row.player2GameWins}${row.gameDraws ? `-${row.gameDraws}` : ''}`;
		return row.resultString || 'Result';
	}

	/** Which side won the Match: the seated Player of a bye, or the one with more game wins; `null` for a draw or a pending Match. */
	function winner(row: ScreenOutputRoundMatch): 1 | 2 | null {
		if (row.isBye)
			return row.player1 || !row.player2 ? 1 : 2;
		if (!row.hasResult || row.player1GameWins == null || row.player2GameWins == null || row.player1GameWins === row.player2GameWins)
			return null;
		return row.player1GameWins > row.player2GameWins ? 1 : 2;
	}

	return { config, loading, error, isEmpty, headerText, round, pageData, rowCount, formatResult, winner };
}
