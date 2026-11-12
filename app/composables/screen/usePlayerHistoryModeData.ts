import type { MatchSide } from '~~/shared/utils/matchFromPlayerSide';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { Player } from '~/types';
import { formatGameScore } from '~~/shared/utils/matchFromPlayerSide';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';
import { usePaginatedScreenMode } from '~/modules/screen-mode/pagination';

/** One of a Player's Matches, its result read from that Player's side. */
export interface PlayerMatchHistoryEntry extends MatchSide {
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
}

export interface PlayerHistory {
	player: Player | null;
	rows: PlayerMatchHistoryEntry[];
}

export function usePlayerHistoryModeData(context: ScreenContext) {
	const config = useScreenModeConfig(context, 'player-history');
	const outputReads = useScreenOutputReads(context);

	const freshness = useScreenModeFreshness<PlayerHistory>({
		hearing: useScreenModeHearing(context, 'player-history', () => config.value),
		source: () => outputReads.scopeKey.value && config.value.playerId
			? `${outputReads.scopeKey.value}:${config.value.playerId}`
			: null,
		read: async () => {
			const data = await outputReads.playerHistory();
			return { player: data.player, rows: data.history };
		},
		initialData: { player: null, rows: [] },
		errorMessage: 'Failed to load player match history',
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const player = computed(() => freshness.data.value.player);
	const rows = computed(() => freshness.data.value.rows);

	const headerText = computed(() => config.value.headerText || (player.value
		? `${player.value.name} Match History`
		: 'Player Match History'));
	const isEmpty = computed(() => freshness.answered.value && (!config.value.playerId || rows.value.length === 0));
	const emptyMessage = computed(() => !config.value.playerId
		? 'Select a player to show match history.'
		: 'No matches found for this player.');

	const { pageData, pageSize, rowCount } = usePaginatedScreenMode(context, { mode: 'player-history', config, rows });

	function formatOutcome(row: PlayerMatchHistoryEntry) {
		if (row.outcome === 'bye')
			return 'BYE';
		const score = formatGameScore(row);
		return score
			? `${row.outcome.toUpperCase()} ${score}`
			: 'Pending';
	}

	return {
		/** Rendering Readiness: its first read has answered or failed. */
		ready: freshness.answered,
		config,
		loading,
		/** Whether its rows are a read's answer, or it selects nothing: false only while its first read is in flight. */
		answered: freshness.answered,
		error,
		isEmpty,
		emptyMessage,
		headerText,
		pageData,
		pageSize,
		rowCount,
		player,
		formatOutcome,
	};
}
