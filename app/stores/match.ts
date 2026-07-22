import type {
	CreateMatchInput,
	Match,
	UpdateMatchInput,
} from '~/types';
import type { MessageData } from '~/types/realtime';
import { useEventDataLifecycle } from '~/modules/event-data/lifecycle';

export const useMatchStore = defineStore('match', () => {
	const matchRepo = useMatchRepository();
	const loadedRoundId = ref<number | null>(null);
	const lifecycle = useEventDataLifecycle<Match, CreateMatchInput, UpdateMatchInput>({
		repository: matchRepo,
		entityLabel: 'Match',
		eventFilter: (match, currentEventId) => match.eventId === currentEventId,
		remoteScopeFilter: match => !loadedRoundId.value || match.roundId === loadedRoundId.value,
		onReset: () => {
			loadedRoundId.value = null;
		},
	});
	const matches = lifecycle.items;
	const loading = lifecycle.loading;
	const error = lifecycle.error;
	const isLoaded = lifecycle.isLoaded;
	const currentEventId = lifecycle.currentEventId;

	async function loadMatchesByRoundId(eventId: number, roundId: number) {
		loadedRoundId.value = roundId;
		return lifecycle.loadFrom(eventId, () => matchRepo.list(eventId, roundId));
	}

	async function loadMatchesByEventId(eventId: number) {
		loadedRoundId.value = null;
		return lifecycle.loadByEventId(eventId);
	}

	const createMatch = lifecycle.create;
	const updateMatch = lifecycle.update;
	const removeMatch = lifecycle.remove;
	const getMatchById = lifecycle.getById;

	/**
	 * Get the label of the feature match that a match is promoted to (if any).
	 * Returns null if the match is not currently promoted.
	 */
	function getFeatureMatchLabel(matchId: number): string | null {
		const featureMatchStore = useFeatureMatchStore();
		const idx = featureMatchStore.featureMatches.findIndex(fm => fm.matchId === matchId);
		if (idx === -1)
			return null;
		return `Match ${idx + 1}`;
	}

	function applyRemoteCreated(data: MessageData<'match:created'>) {
		lifecycle.applyRemoteCreated(data.match as Match);
	}

	function applyRemoteUpdated(data: MessageData<'match:updated'>) {
		lifecycle.applyRemoteUpdated(data.match as Match);
	}

	function applyRemoteDeleted(data: MessageData<'match:deleted'>) {
		lifecycle.applyRemoteDeleted(data.matchId);
	}

	async function applyRemoteMatchesRefreshed(data: MessageData<'round:matchesRefreshed'>) {
		if (data.eventId !== currentEventId.value)
			return;
		if (loadedRoundId.value !== data.roundId)
			return;
		if (!currentEventId.value)
			return;

		await loadMatchesByRoundId(currentEventId.value, data.roundId);
	}

	/** Clear the match list and show loading state (e.g. before syncing a new round). */
	function clearMatches() {
		matches.value = [];
		loadedRoundId.value = null;
		lifecycle.listLoading.value = true;
	}

	const $reset = lifecycle.reset;

	return {
		matches,
		loading,
		error,
		isLoaded,
		loadedRoundId,
		loadMatchesByRoundId,
		loadMatchesByEventId,
		createMatch,
		updateMatch,
		removeMatch,
		getMatchById,
		getFeatureMatchLabel,
		clearMatches,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		applyRemoteMatchesRefreshed,
		$reset,
	};
});
