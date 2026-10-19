import type {
	CreateFeatureMatchInput,
	FeatureMatch,
	UpdateFeatureMatchInput,
} from '~/types';
import type { MessageData } from '~/types/realtime';
import { useEventDataLifecycle } from '~/modules/event-data/lifecycle';

export const useFeatureMatchStore = defineStore('featureMatch', () => {
	const matchRepo = useFeatureMatchRepository();
	const { executeReporting } = useReportingAction();

	const itemLoading = ref(false);
	const lifecycle = useEventDataLifecycle<FeatureMatch, CreateFeatureMatchInput, UpdateFeatureMatchInput>({
		repository: {
			...matchRepo,
			remove: async (eventId, matchId) => {
				const result = await matchRepo.remove(eventId, matchId);
				if (!result.success)
					throw new Error('Failed to delete feature match');
				return result;
			},
		},
		entityLabel: 'Feature match',
		onReset: () => {
			itemLoading.value = false;
		},
	});
	const featureMatches = lifecycle.items;
	const loading = computed(() => lifecycle.loading.value || itemLoading.value);
	const error = lifecycle.error;
	const currentEventId = lifecycle.currentEventId;
	const isLoaded = lifecycle.isLoaded;

	async function loadFeatureMatchesByEventId(eventId: number) {
		const data = await lifecycle.loadByEventId(eventId);
		if (data) {
			const stateStore = useFeatureMatchStateStore();
			for (const match of data)
				stateStore.cacheSlotSession(match);
		}
		return data;
	}

	/**
	 * Hold one Slot a Screen Output read answered (#604), with its Session, so
	 * `featureMatch:updated` keeps it live without loading the Event's Slots.
	 */
	function holdFeatureMatch(slot: FeatureMatch) {
		const index = featureMatches.value.findIndex(held => held.id === slot.id);
		if (index === -1)
			featureMatches.value.push(slot);
		else
			featureMatches.value[index] = slot;
		useFeatureMatchStateStore().cacheSlotSession(slot);
	}

	async function getFeatureMatchById(eventId: number, matchId: number) {
		return executeReporting(
			async () => {
				const matchData = await matchRepo.getById(eventId, matchId);
				if (!matchData) {
					throw new Error('Feature match not found');
				}
				return matchData;
			},
			{ loadingRef: itemLoading, errorRef: error },
		);
	}

	async function createFeatureMatch(eventId: number, input: CreateFeatureMatchInput) {
		const flight = lifecycle.currentLifetime();
		const createdMatch = await lifecycle.create(eventId, input);
		if (createdMatch && flight.current)
			useFeatureMatchStateStore().cacheSlotSession(createdMatch);
		return createdMatch;
	}

	async function updateFeatureMatch(eventId: number, matchId: number, updates: UpdateFeatureMatchInput) {
		const flight = lifecycle.currentLifetime();
		const updated = await lifecycle.update(eventId, matchId, updates);
		if (updated && flight.current)
			useFeatureMatchStateStore().cacheSlotSession(updated);
		return updated;
	}

	async function removeFeatureMatch(eventId: number, matchId: number) {
		return lifecycle.remove(eventId, matchId);
	}

	async function reorderFeatureMatch(slotId: number, direction: 'up' | 'down') {
		if (!currentEventId.value)
			return;

		const index = featureMatches.value.findIndex(m => m.id === slotId);
		if (index === -1)
			return;

		const swapIndex = direction === 'up' ? index - 1 : index + 1;
		if (swapIndex < 0 || swapIndex >= featureMatches.value.length)
			return;

		// Optimistic swap
		const snapshot = [...featureMatches.value];
		const temp = featureMatches.value[index]!;
		featureMatches.value[index] = featureMatches.value[swapIndex]!;
		featureMatches.value[swapIndex] = temp;

		const eventId = currentEventId.value;
		const flight = lifecycle.currentLifetime();
		return executeReporting(
			async () => {
				await matchRepo.reorder(eventId, slotId, direction);
			},
			{
				errorRef: error,
				flight,
				onError: () => {
					featureMatches.value = snapshot;
				},
			},
		);
	}

	// Realtime handlers
	function applyRemoteCreated(data: MessageData<'featureMatch:created'>) {
		lifecycle.applyRemoteCreated(data.featureMatch);
		featureMatches.value.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
		useFeatureMatchStateStore().cacheSlotSession(data.featureMatch);
	}

	function applyRemoteUpdated(data: MessageData<'featureMatch:updated'>) {
		applySavedFeatureMatch(data.featureMatch);
	}

	/**
	 * Hold a Slot an accepted write answered with — this client's own, such as a
	 * Feature Match Slot Promotion's promoted and cleared Slots, or another's
	 * announced. Its Session passes the Live State Follower first: a Slot carrying a
	 * Session the Slot has since replaced is itself from before what is held, and is
	 * not put back over it.
	 */
	function applySavedFeatureMatch(slot: FeatureMatch) {
		if (useFeatureMatchStateStore().cacheSlotSession(slot))
			lifecycle.applyRemoteUpdated(slot);
	}

	function applyRemoteDeleted(data: MessageData<'featureMatch:deleted'>) {
		lifecycle.applyRemoteDeleted(data.featureMatchId);
	}

	function applyRemoteReordered(data: MessageData<'featureMatch:reordered'>) {
		// Apply new sortOrder values, re-sort array
		for (const { featureMatchId, sortOrder } of data.featureMatches) {
			const match = featureMatches.value.find(m => m.id === featureMatchId);
			if (match)
				match.sortOrder = sortOrder;
		}
		featureMatches.value.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
	}

	function $reset() {
		lifecycle.reset();
	}

	return {
		// State
		featureMatches,
		loading,
		error,
		currentEventId,

		// Computed
		isLoaded,

		// Actions
		loadFeatureMatchesByEventId,
		holdFeatureMatch,
		getFeatureMatchById,
		createFeatureMatch,
		updateFeatureMatch,
		removeFeatureMatch,
		reorderFeatureMatch,
		applyRemoteCreated,
		applyRemoteUpdated,
		applySavedFeatureMatch,
		applyRemoteDeleted,
		applyRemoteReordered,
		currentLifetime: lifecycle.currentLifetime,
		$reset,
	};
});
