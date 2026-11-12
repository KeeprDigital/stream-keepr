import type { ScreenOutputPairingsResponse, ScreenOutputRoundMatch } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { formatGameScore, readMatchFromPlayer1Side } from '~~/shared/utils/matchFromPlayerSide';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';
import { usePaginatedScreenMode } from '~/modules/screen-mode/pagination';

type HeldPairings = ScreenOutputPairingsResponse | null;

export function usePairingsModeData(context: ScreenContext) {
	const config = useScreenModeConfig(context, 'pairings');
	const outputReads = useScreenOutputReads(context);

	const freshness = useScreenModeFreshness<HeldPairings>({
		hearing: useScreenModeHearing(context, 'pairings', () => config.value),
		source: () => outputReads.scopeKey.value && config.value.roundId
			? `${outputReads.scopeKey.value}:${config.value.roundId}`
			: null,
		read: () => outputReads.pairings(),
		initialData: null,
		errorMessage: 'Failed to load pairings',
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const round = computed(() => freshness.data.value?.round ?? null);
	const rows = computed(() => freshness.data.value?.matches ?? []);

	const headerText = computed(() => config.value.headerText || (round.value
		? `${round.value.name} Pairings`
		: 'Pairings'));
	const isEmpty = computed(() => freshness.answered.value && (!config.value.roundId || rows.value.length === 0));

	const { pageData, pageSize, rowCount } = usePaginatedScreenMode(context, { mode: 'pairings', config, rows });

	function formatResult(row: ScreenOutputRoundMatch) {
		if (row.isBye)
			return 'BYE';
		return formatGameScore(readMatchFromPlayer1Side(row)) ?? 'Pending';
	}

	/** Which side won the Match: the seated Player of a bye, or the one with more game wins; `null` for a draw or a pending Match. */
	function winner(row: ScreenOutputRoundMatch): 1 | 2 | null {
		if (row.isBye) {
			return row.player1 || !row.player2
				? 1
				: 2;
		}
		if (!row.hasResult || row.player1GameWins == null || row.player2GameWins == null || row.player1GameWins === row.player2GameWins)
			return null;
		return row.player1GameWins > row.player2GameWins
			? 1
			: 2;
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
		headerText,
		round,
		pageData,
		pageSize,
		rowCount,
		formatResult,
		winner,
	};
}
