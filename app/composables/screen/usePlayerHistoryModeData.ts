import type { Player } from '~/types';
import { useScreenModePagination } from '~/modules/screen-mode/pagination';

export interface PlayerMatchHistoryEntry {
	id: number;
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

export function usePlayerHistoryModeData() {
	const { screen, eventId, interactive } = useScreenContext();
	const config = useScreenModeConfig('player-history');
	const screenStore = useScreenStore();

	const displayData = useBroadcastDisplayData<{ player: Player | null; rows: PlayerMatchHistoryEntry[] }>({
		initialData: { player: null, rows: [] },
	});
	const loading = displayData.loading;
	const error = displayData.error;
	const player = computed(() => displayData.data.value.player);
	const rows = computed(() => displayData.data.value.rows);

	const headerText = computed(() => config.value.headerText || (player.value ? `${player.value.name} Match History` : 'Player Match History'));
	const isEmpty = computed(() => !loading.value && (!config.value.playerId || rows.value.length === 0));
	const emptyMessage = computed(() => !config.value.playerId ? 'Select a player to show match history.' : 'No matches found for this player.');

	const currentPage = computed(() => config.value.currentPage ?? 1);
	const { pageData } = useScreenModePagination({
		rows: computed(() => rows.value),
		pageSize: computed(() => config.value.rowsPerPage),
		currentPage,
		autoPageEnabled: computed(() => config.value.autoPageEnabled),
		autoPageIntervalMs: computed(() => config.value.autoPageIntervalMs),
		interactive,
		persistPage: (page) => {
			if (screen.value && eventId.value) {
				void Promise.resolve(
					screenStore.updateModeConfig(eventId.value, screen.value.id, 'player-history', { currentPage: page }),
				).catch(() => {});
			}
		},
	});

	async function load() {
		const evtId = eventId.value;
		const playerId = config.value.playerId;
		if (!evtId || !playerId) {
			displayData.clear();
			return;
		}

		await displayData.refresh(async () => {
			const data = await $fetch<{ player: Player; history: PlayerMatchHistoryEntry[] }>(`/api/events/${evtId}/players/${playerId}/match-history`);
			return { player: data.player, rows: data.history };
		}, 'Failed to load player match history');
	}

	watch(() => [eventId.value, config.value.playerId], load, { immediate: true });

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
