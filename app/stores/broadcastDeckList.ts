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

interface PendingUpdate {
	token: symbol;
	kind: 'update';
	summaryFields: ReadonlySet<keyof BroadcastDeckListSummaryResponse>;
	detailFields: ReadonlySet<keyof BroadcastDeckListResponse>;
	remoteInvalidated: boolean;
}

interface PendingDelete {
	token: symbol;
	kind: 'delete';
	remoteInvalidated: boolean;
}

type PendingMutation = PendingUpdate | PendingDelete;

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
	const pendingMutations = new Map<number, PendingMutation>();

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

	function mergeFields<T extends object>(authority: T, local: T, fields: ReadonlySet<keyof T>): T {
		const merged = { ...authority };
		for (const field of fields)
			merged[field] = local[field];
		return merged;
	}

	function mergeSummaryFromAuthority(authority: BroadcastDeckListSummaryResponse) {
		const pending = pendingMutations.get(authority.id);
		if (pending?.kind === 'delete')
			return null;
		const local = summaries.value.find(item => item.id === authority.id);
		return pending?.kind === 'update' && local
			? mergeFields(authority, local, pending.summaryFields)
			: authority;
	}

	function mergeCollectionFromAuthority(authority: BroadcastDeckListSummaryResponse[]) {
		const merged = authority.flatMap((item) => {
			const next = mergeSummaryFromAuthority(item);
			return next ? [next] : [];
		});
		const foundIds = new Set(authority.map(item => item.id));
		for (const [listId, pending] of pendingMutations) {
			if (pending.kind !== 'update' || foundIds.has(listId))
				continue;
			const local = summaries.value.find(item => item.id === listId);
			if (local)
				merged.push(local);
		}
		return sortSummaries(merged);
	}

	function mergeDetailFromAuthority(listId: number, authority: BroadcastDeckListResponse | null) {
		const pending = pendingMutations.get(listId);
		if (pending?.kind === 'delete')
			return null;
		const local = detailById(listId);
		if (pending?.kind === 'update' && local)
			return authority ? mergeFields(authority, local, pending.detailFields) : local;
		return authority;
	}

	function restoreSummaryFields(
		listId: number,
		snapshot: BroadcastDeckListSummaryResponse | null,
		fields: ReadonlySet<keyof BroadcastDeckListSummaryResponse>,
	) {
		const local = summaries.value.find(item => item.id === listId);
		if (local && snapshot) {
			summaries.value = sortSummaries(summaries.value.map(item =>
				item.id === listId ? mergeFields(item, snapshot, fields) : item,
			));
		}
		else if (!snapshot) {
			summaries.value = summaries.value.filter(item => item.id !== listId);
		}
	}

	function restoreDetailFields(
		listId: number,
		snapshot: BroadcastDeckListResponse | null,
		fields: ReadonlySet<keyof BroadcastDeckListResponse>,
	) {
		const local = detailById(listId);
		if (local && snapshot)
			replaceDetail(listId, mergeFields(local, snapshot, fields));
		else if (!snapshot)
			replaceDetail(listId, null);
	}

	async function reloadListAuthority(eventId: number, listId: number) {
		await Promise.allSettled([
			loadCollection(eventId),
			...(consumedDetailIds.value.has(listId) || details.value.has(listId)
				? [loadDetail(eventId, listId)]
				: []),
		]);
	}

	function resetState(eventId: number | null) {
		collectionLoads.supersede();
		detailLoads.supersedeAll();
		summaries.value = [];
		details.value = new Map();
		consumedDetailIds.value = new Set();
		detailConsumerCounts.clear();
		pendingMutations.clear();
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
				summaries.value = mergeCollectionFromAuthority(loaded);
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
				replaceDetail(listId, mergeDetailFromAuthority(listId, loaded));
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
			if (currentEventId.value === eventId)
				error.value = cause instanceof Error ? cause.message : 'Failed to create Broadcast Deck List';
			throw cause;
		}
		if (currentEventId.value !== eventId)
			return created;
		collectionLoads.supersede();
		detailLoads.supersede(created.id);
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
		const sharedPatch = {
			...(input.name !== undefined ? { name: input.name } : {}),
			...(input.archetypeLabel !== undefined ? { archetypeLabel: input.archetypeLabel } : {}),
			...(input.colors !== undefined ? { colors: input.colors } : {}),
			revision: optimisticRevision,
		};
		const detailPatch = {
			...sharedPatch,
			...(input.sourceText !== undefined ? { sourceText: input.sourceText } : {}),
		};
		const summaryFields = new Set(Object.keys(sharedPatch) as (keyof BroadcastDeckListSummaryResponse)[]);
		const detailFields = new Set(Object.keys(detailPatch) as (keyof BroadcastDeckListResponse)[]);
		const token = Symbol('broadcast-deck-list-update');
		const pending: PendingUpdate = { token, kind: 'update', summaryFields, detailFields, remoteInvalidated: false };
		collectionLoads.supersede();
		detailLoads.supersede(listId);
		pendingMutations.set(listId, pending);
		if (previousDetail)
			replaceDetail(listId, { ...previousDetail, ...detailPatch });
		if (previousSummary) {
			summaries.value = sortSummaries(summaries.value.map(item =>
				item.id === listId ? { ...item, ...sharedPatch } : item,
			));
		}

		try {
			error.value = null;
			const updated = await withFailureSentence(() => repo.update(eventId, listId, input));
			if (currentEventId.value === eventId && pendingMutations.get(listId)?.token === token) {
				collectionLoads.supersede();
				detailLoads.supersede(listId);
				const shouldRefetch = pending.remoteInvalidated;
				pendingMutations.delete(listId);
				replaceDetail(listId, updated);
				summaries.value = sortSummaries([
					...summaries.value.filter(item => item.id !== listId),
					asSummary(updated),
				]);
				if (shouldRefetch)
					await reloadListAuthority(eventId, listId);
			}
			return updated;
		}
		catch (cause) {
			const failureSentence = cause instanceof Error ? cause.message : 'Failed to update Broadcast Deck List';
			if (currentEventId.value === eventId && pendingMutations.get(listId)?.token === token) {
				collectionLoads.supersede();
				detailLoads.supersede(listId);
				pendingMutations.delete(listId);
				restoreDetailFields(listId, previousDetail, detailFields);
				restoreSummaryFields(listId, previousSummary, summaryFields);
				await reloadListAuthority(eventId, listId);
				error.value = failureSentence;
			}
			throw cause;
		}
	}

	async function removeList(eventId: number, listId: number, expectedRevision: number) {
		ensureEvent(eventId);
		const previousDetail = detailById(listId);
		const previousSummary = summaries.value.find(item => item.id === listId) ?? null;
		const token = Symbol('broadcast-deck-list-delete');
		const pending: PendingDelete = { token, kind: 'delete', remoteInvalidated: false };
		collectionLoads.supersede();
		detailLoads.supersede(listId);
		pendingMutations.set(listId, pending);
		summaries.value = summaries.value.filter(item => item.id !== listId);
		replaceDetail(listId, null);
		try {
			error.value = null;
			const result = await withFailureSentence(() => repo.remove(eventId, listId, expectedRevision));
			if (currentEventId.value === eventId && pendingMutations.get(listId)?.token === token) {
				collectionLoads.supersede();
				detailLoads.supersede(listId);
				const shouldRefetch = pending.remoteInvalidated;
				pendingMutations.delete(listId);
				if (shouldRefetch)
					await reloadListAuthority(eventId, listId);
			}
			return result;
		}
		catch (cause) {
			const failureSentence = cause instanceof Error ? cause.message : 'Failed to delete Broadcast Deck List';
			if (currentEventId.value === eventId && pendingMutations.get(listId)?.token === token) {
				collectionLoads.supersede();
				detailLoads.supersede(listId);
				pendingMutations.delete(listId);
				if (previousSummary)
					summaries.value = sortSummaries([...summaries.value, previousSummary]);
				if (previousDetail)
					replaceDetail(listId, previousDetail);
				await reloadListAuthority(eventId, listId);
				error.value = failureSentence;
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
		const pending = pendingMutations.get(message.listId);
		if (pending)
			pending.remoteInvalidated = true;
		await reloadListAuthority(message.eventId, message.listId);
	}

	async function applyRemoteDeleted(message: BroadcastDeckListDeletedMessage) {
		if (currentEventId.value !== message.eventId)
			return;
		const pending = pendingMutations.get(message.listId);
		if (pending)
			pending.remoteInvalidated = true;
		await reloadListAuthority(message.eventId, message.listId);
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
