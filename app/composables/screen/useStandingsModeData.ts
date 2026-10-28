import type { StandingsColumnKey } from '~~/shared/types/enums';
import type { ScreenOutputStandingsResponse } from '~~/shared/types/screenOutputReads';
import type { PositionChange } from '~~/shared/utils/standingsPositionChange';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import type { Player } from '~/types';
import { isColumnVisible } from '~~/shared/screenModeConfigs/subShapes';
import { getMtgGameData } from '~~/shared/utils/gameData';
import { formatPlayerRecord } from '~~/shared/utils/playerRecord';
import { formatPositionChange, positionChange } from '~~/shared/utils/standingsPositionChange';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { usePaginatedScreenMode } from '~/modules/screen-mode/pagination';

/**
 * Placed Players by position, unplaced ones last, ties by id: a total order, so
 * a re-read cannot reorder (and, under a moving `row-motion`, visibly move) rows that
 * did not change, whatever order the read answers them in.
 */
function byStandingsPosition(a: Player, b: Player): number {
	return Number(a.position == null) - Number(b.position == null)
		|| (a.position ?? 0) - (b.position ?? 0)
		|| a.id - b.id;
}

/**
 * The Event Data Standings are read from: the roster, the Round they are fixed
 * at and its snapshot, the watchlist they filter to, and, while the Position
 * Change column shows, the previous Round in the Event's Round order. Every
 * Player is a row, and Melee syncs rewrite records and snapshots wholesale, so
 * any sync of Players or Round Standings re-reads; a synced Match Result or
 * pairing does not, since Standings show only stored Round Standings. Any
 * Round or Phase edit may reorder the Event's Rounds, so while that column
 * shows, each one re-reads. A new Round holds no Round Standings until a Melee
 * sync stores them, which re-reads already.
 */
function standingsDependencies(
	watchlistId: () => number | null,
	showsPositionChange: () => boolean,
): ScreenModeDependencies<ScreenOutputStandingsResponse> {
	const holdsRound = (held: ScreenOutputStandingsResponse, roundId: number) => held.round?.id === roundId;
	const isWatchlist = (listId: number) => listId === watchlistId();

	return {
		'player:created': true,
		'player:updated': true,
		'player:deleted': true,
		'round:updated': ({ round }, held) => holdsRound(held, round.id) || showsPositionChange(),
		'round:deleted': ({ roundId }, held) => holdsRound(held, roundId) || showsPositionChange(),
		'phase:updated': () => showsPositionChange(),
		'phase:deleted': () => showsPositionChange(),
		'playerList:updated': ({ playerList }) => isWatchlist(playerList.id),
		'playerList:deleted': ({ listId }) => isWatchlist(listId),
		'playerList:membersChanged': ({ listId }) => isWatchlist(listId),
		'melee:dataReset': true,
		'melee:structureSynced': true,
		'melee:roundStandingsSynced': true,
		'melee:playersSynced': true,
	};
}

export function useStandingsModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('standings');

	const outputReads = useScreenOutputReads();
	const eventStore = useEventStore();

	const selectedWatchlistId = () => config.value.viewMode === 'watchlist'
		? config.value.playerListId ?? null
		: null;
	const showsPositionChange = () => isColumnVisible(config.value.columns, 'positionChange');

	// ── Data Loading ──
	/**
	 * One Screen Output read answers everything Standings renders from, derived
	 * on the server from the saved configuration (#604). It is held here, never
	 * in the Player store, so an operator's roster cannot stand in for it (#603).
	 */
	const freshness = useScreenModeFreshness<ScreenOutputStandingsResponse>({
		eventId,
		source: () => outputReads.scopeKey.value
			? `${outputReads.scopeKey.value}:${config.value.viewMode}:${config.value.playerListId}:${config.value.roundId}:${showsPositionChange()}`
			: null,
		read: () => outputReads.standings(),
		initialData: {
			players: [],
			round: null,
			roundStandings: null,
			watchlist: null,
			previousRoundPositions: null,
		},
		errorMessage: 'Failed to load standings data',
		dependsOn: standingsDependencies(selectedWatchlistId, showsPositionChange),
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const round = computed(() => freshness.data.value.round);
	const watchlist = computed(() => freshness.data.value.watchlist);
	const watchlistPlayerIds = computed(() => new Set(watchlist.value?.playerIds ?? []));
	const roundSnapshotMap = computed(() => {
		const standings = freshness.data.value.roundStandings;
		return standings
			? new Map(standings.map(({ playerId, ...snapshot }) => [playerId, snapshot]))
			: null;
	});
	const previousRoundPositionMap = computed(() => {
		const previous = freshness.data.value.previousRoundPositions;
		return previous
			? new Map(previous.positions.map(({ playerId, position }) => [playerId, position]))
			: null;
	});

	// ── Header ──
	const headerText = computed(() => computeHeaderText());
	const visibleColumns = computed(() =>
		config.value.columns.filter(c => c.visible),
	);
	const standingsRows = computed(() => {
		const selectedRoundId = config.value.roundId;
		const rows: Player[] = [...freshness.data.value.players];

		if (!selectedRoundId) {
			return rows.sort(byStandingsPosition);
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
			.sort(byStandingsPosition);
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
	const {
		rowCount,
		pageData,
		totalPages,
		currentPage,
		setPage,
		nextPage,
		prevPage,
	} = usePaginatedScreenMode({ mode: 'standings', config, rows: displayRows });

	// ── Header Text Computation ──
	function computeHeaderText(): string {
		if (config.value.headerText)
			return config.value.headerText;

		if (config.value.roundId && round.value?.id === config.value.roundId) {
			return `End of ${round.value.name}`;
		}

		switch (config.value.viewMode) {
			case 'topN':
				return `Top ${config.value.topNCount} Standings`;
			case 'slice':
				return `Standings (${config.value.sliceStart}-${config.value.sliceEnd})`;
			case 'watchlist': {
				return watchlist.value?.name ?? 'Players to Watch';
			}
			case 'reveal':
				return `Top ${config.value.revealCount}`;
			default:
				return 'Standings';
		}
	}

	// ── Position Change ──
	/** How far a row's Player moved since the previous Round (#755). */
	function positionChangeOf(player: Player): PositionChange {
		return positionChange(player.id, player.position, previousRoundPositionMap.value);
	}

	// ── Cell Formatting ──
	function formatCell(player: Player, key: StandingsColumnKey): string {
		const event = eventStore.displayEvent;

		switch (key) {
			case 'position':
				return player.position != null
					? String(player.position)
					: '-';
			case 'name':
				return player.name;
			case 'record':
				return formatPlayerRecord(player, event);
			case 'points':
				return player.points != null
					? String(player.points)
					: '-';
			case 'deck': {
				return getMtgGameData(player.gameData).deckName ?? '-';
			}
			case 'positionChange':
				return formatPositionChange(positionChangeOf(player));
		}
	}

	// ── Empty State ──
	const isEmpty = computed(() => freshness.answered.value && displayRows.value.length === 0);
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

	return {
		/** Rendering Readiness: its first read has answered or failed. */
		ready: freshness.answered,
		config,
		loading,
		error,
		isEmpty,
		emptyMessage,
		headerText,
		visibleColumns,
		displayRows,
		pageData,
		rowCount,
		currentPage,
		totalPages,
		nextPage,
		prevPage,
		setPage,
		formatCell,
		positionChangeOf,
	};
}
