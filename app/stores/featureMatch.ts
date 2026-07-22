import type {
	CreateFeatureMatchInput,
	FeatureMatch,
	UpdateFeatureMatchInput,
} from '~/types';
import type { MessageData } from '~/types/realtime';
import { useEventDataLifecycle } from '~/modules/event-data/lifecycle';

export const useFeatureMatchStore = defineStore('featureMatch', () => {
	const matchRepo = useFeatureMatchRepository();
	const { executeAction } = useStoreHelpers();

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

	async function getFeatureMatchById(eventId: number, matchId: number) {
		return executeAction(
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
		const createdMatch = await lifecycle.create(eventId, input);
		if (createdMatch)
			useFeatureMatchStateStore().cacheSlotSession(createdMatch);
		return createdMatch;
	}

	async function updateFeatureMatch(eventId: number, matchId: number, updates: UpdateFeatureMatchInput) {
		const updated = await lifecycle.update(eventId, matchId, updates);
		if (updated)
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
		return executeAction(
			async () => {
				await matchRepo.reorder(eventId, slotId, direction);
			},
			{
				errorRef: error,
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
		lifecycle.applyRemoteUpdated(data.featureMatch);
		useFeatureMatchStateStore().cacheSlotSession(data.featureMatch);
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
		getFeatureMatchById,
		createFeatureMatch,
		updateFeatureMatch,
		removeFeatureMatch,
		reorderFeatureMatch,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		applyRemoteReordered,
		$reset,
	};
});
