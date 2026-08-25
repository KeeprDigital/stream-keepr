import type {
	BroadcastDeckListResponse,
	BroadcastDeckListSummaryResponse,
	CreateBroadcastDeckListInput,
	UpdateBroadcastDeckListInput,
} from '~/types';

interface BroadcastDeckListChangedMessage {
	eventId: number;
	listId: number;
	revision: number;
}

interface BroadcastDeckListDeletedMessage {
	eventId: number;
	listId: number;
}

function asSummary(detail: BroadcastDeckListResponse): BroadcastDeckListSummaryResponse {
	const { sourceText: _sourceText, entries: _entries, ...summary } = detail;
	return summary;
}

function sortSummaries(summaries: BroadcastDeckListSummaryResponse[]) {
	return [...summaries].sort((left, right) => {
		const leftName = left.name.normalize('NFKC').toLocaleLowerCase('en-US');
		const rightName = right.name.normalize('NFKC').toLocaleLowerCase('en-US');
		const byName = leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
		return byName || left.id - right.id;
	});
}

export const useBroadcastDeckListStore = defineStore('broadcastDeckList', () => {
	const repo = useBroadcastDeckListRepository();
	const summaries = ref<BroadcastDeckListSummaryResponse[]>([]);
	const details = ref(new Map<number, BroadcastDeckListResponse>());
	const consumedDetailIds = ref(new Set<number>());
	const detailConsumerCounts = new Map<number, number>();
	const currentEventId = ref<number | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const collectionLoads = createGuardedSequence();
	const detailLoads = createKeyedGuardedSequence<number>();

	function replaceDetail(listId: number, detail: BroadcastDeckListResponse | null) {
		const next = new Map(details.value);
		if (detail)
			next.set(listId, detail);
		else
			next.delete(listId);
		details.value = next;
	}

	function detailById(listId: number) {
		return details.value.get(listId) ?? null;
	}

	function resetState(eventId: number | null) {
		collectionLoads.supersede();
		detailLoads.supersedeAll();
		summaries.value = [];
		details.value = new Map();
		consumedDetailIds.value = new Set();
		detailConsumerCounts.clear();
		currentEventId.value = eventId;
		loading.value = false;
		error.value = null;
	}

	function ensureEvent(eventId: number) {
		if (currentEventId.value !== eventId)
			resetState(eventId);
	}

	function consumeDetail(eventId: number, listId: number) {
		ensureEvent(eventId);
		detailConsumerCounts.set(listId, (detailConsumerCounts.get(listId) ?? 0) + 1);
		consumedDetailIds.value = new Set(consumedDetailIds.value).add(listId);
		let released = false;
		return () => {
			if (released || currentEventId.value !== eventId)
				return;
			released = true;
			const remaining = (detailConsumerCounts.get(listId) ?? 1) - 1;
			if (remaining > 0) {
				detailConsumerCounts.set(listId, remaining);
				return;
			}
			detailConsumerCounts.delete(listId);
			const next = new Set(consumedDetailIds.value);
			next.delete(listId);
			consumedDetailIds.value = next;
		};
	}

	async function loadCollection(eventId: number) {
		ensureEvent(eventId);
		const flight = collectionLoads.begin();
		loading.value = true;
		error.value = null;
		try {
			const loaded = await withFailureSentence(() => repo.list(eventId));
			if (flight.current && currentEventId.value === eventId)
				summaries.value = loaded;
			return loaded;
		}
		catch (cause) {
			if (flight.current)
				error.value = cause instanceof Error ? cause.message : 'Failed to load Broadcast Deck Lists';
			throw cause;
		}
		finally {
			if (flight.current)
				loading.value = false;
		}
	}

	async function loadDetail(eventId: number, listId: number) {
		ensureEvent(eventId);
		const flight = detailLoads.begin(listId);
		try {
			const loaded = await withFailureSentence(() => repo.getById(eventId, listId));
			if (flight.current && currentEventId.value === eventId)
				replaceDetail(listId, loaded);
			return loaded;
		}
		catch (cause) {
			if (flight.current)
				error.value = cause instanceof Error ? cause.message : 'Failed to load Broadcast Deck List';
			throw cause;
		}
	}

	async function reloadAuthoritativeState() {
		const eventId = currentEventId.value;
		if (eventId === null)
			return;
		await Promise.allSettled([
			loadCollection(eventId),
			...[...consumedDetailIds.value].map(listId => loadDetail(eventId, listId)),
		]);
	}

	async function createList(eventId: number, input: CreateBroadcastDeckListInput) {
		ensureEvent(eventId);
		error.value = null;
		let created: BroadcastDeckListResponse;
		try {
			created = await withFailureSentence(() => repo.create(eventId, input));
		}
		catch (cause) {
			error.value = cause instanceof Error ? cause.message : 'Failed to create Broadcast Deck List';
			throw cause;
		}
		summaries.value = sortSummaries([
			...summaries.value.filter(item => item.id !== created.id),
			asSummary(created),
		]);
		replaceDetail(created.id, created);
		return created;
	}

	async function updateList(eventId: number, listId: number, input: UpdateBroadcastDeckListInput) {
		ensureEvent(eventId);
		const previousDetail = detailById(listId);
		const previousSummary = summaries.value.find(item => item.id === listId) ?? null;
		const optimisticRevision = input.expectedRevision + 1;
		const detailPatch = {
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}),
			...(input.archetypeLabel !== undefined ? { archetypeLabel: input.archetypeLabel } : {}),
			...(input.colors !== undefined ? { colors: input.colors } : {}),
			revision: optimisticRevision,
		};
		const summaryPatch = {
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.archetypeLabel !== undefined ? { archetypeLabel: input.archetypeLabel } : {}),
			...(input.colors !== undefined ? { colors: input.colors } : {}),
			revision: optimisticRevision,
		};
		if (previousDetail)
			replaceDetail(listId, { ...previousDetail, ...detailPatch });
		if (previousSummary) {
			summaries.value = sortSummaries(summaries.value.map(item =>
				item.id === listId ? { ...item, ...summaryPatch } : item,
			));
		}

		try {
			error.value = null;
			const updated = await withFailureSentence(() => repo.update(eventId, listId, input));
			if (currentEventId.value === eventId) {
				replaceDetail(listId, updated);
				summaries.value = sortSummaries([
					...summaries.value.filter(item => item.id !== listId),
					asSummary(updated),
				]);
			}
			return updated;
		}
		catch (cause) {
			error.value = cause instanceof Error ? cause.message : 'Failed to update Broadcast Deck List';
			if (currentEventId.value === eventId) {
				if (detailById(listId)?.revision === optimisticRevision)
					replaceDetail(listId, previousDetail);
				if (summaries.value.find(item => item.id === listId)?.revision === optimisticRevision) {
					summaries.value = previousSummary
						? sortSummaries([...summaries.value.filter(item => item.id !== listId), previousSummary])
						: summaries.value.filter(item => item.id !== listId);
				}
			}
			throw cause;
		}
	}

	async function removeList(eventId: number, listId: number, expectedRevision: number) {
		ensureEvent(eventId);
		const previousDetail = detailById(listId);
		const previousSummary = summaries.value.find(item => item.id === listId) ?? null;
		summaries.value = summaries.value.filter(item => item.id !== listId);
		replaceDetail(listId, null);
		try {
			error.value = null;
			return await withFailureSentence(() => repo.remove(eventId, listId, expectedRevision));
		}
		catch (cause) {
			error.value = cause instanceof Error ? cause.message : 'Failed to delete Broadcast Deck List';
			if (currentEventId.value === eventId) {
				if (previousSummary)
					summaries.value = sortSummaries([...summaries.value, previousSummary]);
				if (previousDetail)
					replaceDetail(listId, previousDetail);
			}
			throw cause;
		}
	}

	async function applyRemoteCreated(message: BroadcastDeckListChangedMessage) {
		if (currentEventId.value !== message.eventId)
			return;
		await loadCollection(message.eventId);
	}

	async function applyRemoteUpdated(message: BroadcastDeckListChangedMessage) {
		if (currentEventId.value !== message.eventId)
			return;
		await Promise.allSettled([
			loadCollection(message.eventId),
			...(details.value.has(message.listId) ? [loadDetail(message.eventId, message.listId)] : []),
		]);
	}

	function applyRemoteDeleted(message: BroadcastDeckListDeletedMessage) {
		if (currentEventId.value !== message.eventId)
			return;
		summaries.value = summaries.value.filter(item => item.id !== message.listId);
		replaceDetail(message.listId, null);
	}

	function $reset() {
		resetState(null);
	}

	return {
		summaries,
		details,
		consumedDetailIds,
		currentEventId,
		loading,
		error,
		detailById,
		consumeDetail,
		loadCollection,
		loadDetail,
		reloadAuthoritativeState,
		createList,
		updateList,
		removeList,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		$reset,
	};
});
