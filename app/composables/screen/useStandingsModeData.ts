import type { StandingsColumnKey } from '~~/shared/types/enums';
import type { Player } from '~/types';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { useScreenModePagination } from '~/modules/screen-mode/pagination';

export function useStandingsModeData() {
	const { screen, eventId, interactive } = useScreenContext();
	const config = useScreenModeConfig('standings');

	const playerStore = usePlayerStore();
	const playerListStore = usePlayerListStore();
	const playerListRepo = usePlayerListRepository();
	const roundStore = useRoundStore();
	const screenStore = useScreenStore();
	const eventStore = useEventStore();

	const displayData = useBroadcastDisplayData<null>({ initialData: null });
	const loading = displayData.loading;
	const error = displayData.error;
	const roundSnapshotMap = ref<Map<number, Pick<Player, 'wins' | 'losses' | 'draws' | 'position' | 'points'>> | null>(null);
	let roundSnapshotRequestId = 0;

	// ── Watchlist Member Tracking ──
	const watchlistPlayerIds = ref<Set<number>>(new Set());

	// ── Header ──
	const headerText = computed(() => computeHeaderText());
	const visibleColumns = computed(() =>
		config.value.columns.filter(c => c.visible),
	);
	const standingsRows = computed(() => {
		const selectedRoundId = config.value.roundId;
		const rows = [...playerStore.players];

		if (!selectedRoundId) {
			return rows;
		}

		const snapshotMap = roundSnapshotMap.value;
		if (!snapshotMap || snapshotMap.size === 0) {
			return [] as Player[];
		}

		return rows
			.map((player) => {
				const snapshot = snapshotMap.get(player.id);
				if (!snapshot) {
					return null;
				}

				return {
					...player,
					wins: snapshot.wins,
					losses: snapshot.losses,
					draws: snapshot.draws,
					position: snapshot.position,
					points: snapshot.points,
				};
			})
			.filter((player): player is Player => player !== null)
			.sort((a, b) => (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY));
	});

	// ── Display Rows (view mode filtering + reveal logic) ──
	const displayRows = computed(() => {
		const mode = config.value.viewMode;
		let rows = [...standingsRows.value];

		if (mode === 'topN') {
			rows = rows.slice(0, config.value.topNCount);
		}
		else if (mode === 'slice') {
			rows = rows.filter(p =>
				p.position != null
				&& p.position >= config.value.sliceStart
				&& p.position <= config.value.sliceEnd,
			);
		}
		else if (mode === 'watchlist') {
			rows = rows.filter(p => watchlistPlayerIds.value.has(p.id));
		}
		else if (mode === 'reveal') {
			rows = rows.slice(0, config.value.revealCount);
			const revealed = config.value.revealedCount;
			if (config.value.revealOrder === 'bottomUp') {
				// Show last N revealed (e.g., revealed=3 of 8: show positions 6,7,8)
				rows = rows.slice(Math.max(0, rows.length - revealed));
			}
			else {
				// Show first N revealed
				rows = rows.slice(0, revealed);
			}
		}

		return rows;
	});

	// ── Pagination ──
	const currentPage = computed(() => config.value.currentPage ?? 1);
	const {
		pageData,
		totalPages,
		setPage,
		nextPage,
		prevPage,
	} = useScreenModePagination({
		rows: displayRows,
		pageSize: computed(() => config.value.rowsPerPage),
		currentPage,
		autoPageEnabled: computed(() => config.value.autoPageEnabled),
		autoPageIntervalMs: computed(() => config.value.autoPageIntervalMs),
		interactive,
		persistPage: (page) => {
			if (screen.value) {
				void Promise.resolve(screenStore.updateModeConfig(
					eventId.value!,
					screen.value.id,
					'standings',
					{ currentPage: page },
				)).catch(() => {});
			}
		},
	});

	// ── Data Loading ──
	async function ensurePlayersLoaded() {
		const evtId = eventId.value;
		if (!evtId) {
			error.value = 'No event loaded';
			displayData.clear();
			return;
		}

		await displayData.refresh(async () => {
			if (!playerStore.isLoaded) {
				await playerStore.loadPlayersByEventId(evtId);
			}

			if (config.value.roundId && !roundStore.isLoaded) {
				await roundStore.loadRoundsByEventId(evtId);
			}

			if (config.value.viewMode === 'watchlist' && config.value.playerListId) {
				await loadWatchlistMembers(config.value.playerListId);
			}

			if (!playerListStore.isLoaded) {
				await playerListStore.loadByEventId(evtId);
			}

			if (config.value.roundId) {
				await loadRoundSnapshot(evtId, config.value.roundId);
			}
			else {
				roundSnapshotRequestId++;
				roundSnapshotMap.value = null;
			}

			return null;
		}, 'Failed to load standings data');
	}

	async function loadRoundSnapshot(evtId: number, roundId: number) {
		const requestId = ++roundSnapshotRequestId;

		try {
			const data = await $fetch<{
				standings: Array<{
					playerId: number;
					wins: number | null;
					losses: number | null;
					draws: number | null;
					position: number | null;
					points: number | null;
				}>;
			}>(`/api/events/${evtId}/standings?roundId=${roundId}`);

			if (requestId !== roundSnapshotRequestId) {
				return;
			}

			roundSnapshotMap.value = new Map(
				data.standings.map(entry => [
					entry.playerId,
					{
						wins: entry.wins,
						losses: entry.losses,
						draws: entry.draws,
						position: entry.position,
						points: entry.points,
					},
				]),
			);
		}
		catch {
			if (requestId !== roundSnapshotRequestId) {
				return;
			}

			if (!roundSnapshotMap.value) {
				roundSnapshotMap.value = new Map();
			}
			throw new Error('Failed to load round snapshot');
		}
	}

	async function loadWatchlistMembers(listId: number) {
		try {
			const listDetail = await playerListRepo.getById(eventId.value!, listId);
			watchlistPlayerIds.value = new Set(
				listDetail?.members.map((m: Player) => m.id) ?? [],
			);
		}
		catch {
			watchlistPlayerIds.value = new Set();
			error.value = 'Selected player list not found';
		}
	}

	// ── Header Text Computation ──
	function computeHeaderText(): string {
		if (config.value.headerText)
			return config.value.headerText;

		if (config.value.roundId) {
			const round = roundStore.getRoundById(config.value.roundId);
			if (round) {
				return `End of ${round.name}`;
			}
		}

		switch (config.value.viewMode) {
			case 'topN':
				return `Top ${config.value.topNCount} Standings`;
			case 'slice':
				return `Standings (${config.value.sliceStart}-${config.value.sliceEnd})`;
			case 'watchlist': {
				const list = playerListStore.lists.find(l => l.id === config.value.playerListId);
				return list?.name ?? 'Players to Watch';
			}
			case 'reveal':
				return `Top ${config.value.revealCount}`;
			default:
				return 'Standings';
		}
	}

	// ── Cell Formatting ──
	function formatCell(player: Player, key: StandingsColumnKey): string {
		const event = eventStore.event;

		switch (key) {
			case 'position':
				return player.position != null ? String(player.position) : '-';
			case 'name':
				return player.name;
			case 'record': {
				const wins = player.wins ?? 0;
				const losses = player.losses ?? 0;
				const draws = player.draws ?? 0;
				const sep = event?.displayRecordSeparator ?? '-';
				const hideZeroDraws = event?.displayHideZeroDraws ?? true;
				if (hideZeroDraws && draws === 0)
					return `${wins}${sep}${losses}`;
				return `${wins}${sep}${losses}${sep}${draws}`;
			}
			case 'points':
				return player.points != null ? String(player.points) : '-';
			case 'deck': {
				return getMtgGameData(player.gameData).deckName ?? '-';
			}
		}
	}

	// ── Empty State ──
	const isEmpty = computed(() => !loading.value && displayRows.value.length === 0);
	const emptyMessage = computed(() => {
		if (config.value.roundId) {
			return 'No standings snapshot available for this round';
		}

		if (config.value.viewMode === 'watchlist') {
			if (!config.value.playerListId)
				return 'Select a player list in settings';
			return 'No players in this list';
		}
		if (config.value.viewMode === 'reveal' && config.value.revealedCount === 0) {
			return 'Waiting for reveal...';
		}
		return 'No standings data available';
	});

	// ── Watchers ──
	watch(
		() => [config.value.viewMode, config.value.playerListId, config.value.roundId],
		() => ensurePlayersLoaded(),
		{ immediate: true },
	);

	// Refetch watchlist members when membership changes (via realtime)
	watch(
		() => playerListStore.lists.find(l => l.id === config.value.playerListId)?.memberCount,
		() => {
			if (config.value.viewMode === 'watchlist' && config.value.playerListId) {
				void loadWatchlistMembers(config.value.playerListId);
			}
		},
	);

	return {
		config,
		loading,
		error,
		isEmpty,
		emptyMessage,
		headerText,
		visibleColumns,
		displayRows,
		pageData,
		currentPage,
		totalPages,
		nextPage,
		prevPage,
		setPage,
		formatCell,
	};
}
