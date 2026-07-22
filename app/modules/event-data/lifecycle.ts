import type { Ref } from 'vue';
import { computed, ref } from 'vue';

interface EventDataLifecycleRepository<T, TCreate extends object, TUpdate extends object> {
	list: (eventId: number, ...args: any[]) => Promise<T[]>;
	create: (eventId: number, input: TCreate) => Promise<T>;
	update: (eventId: number, id: number, updates: TUpdate) => Promise<T>;
	remove: (eventId: number, id: number) => Promise<unknown>;
}

export interface EventDataLifecycleOptions<T extends { id: number; eventId?: number }, TCreate extends object, TUpdate extends object> {
	entityLabel: string;
	repository: EventDataLifecycleRepository<T, TCreate, TUpdate>;
	eventFilter?: (item: T, currentEventId: number | null) => boolean;
	remoteScopeFilter?: (item: T) => boolean;
	onLoad?: (items: T[]) => void;
	onMutation?: () => void;
	onReset?: () => void;
}

type EventDataLifecycleReset = () => void;

const eventDataLifecycleResets = new Set<EventDataLifecycleReset>();

export function registerEventDataLifecycleReset(reset: EventDataLifecycleReset) {
	eventDataLifecycleResets.add(reset);
	return () => eventDataLifecycleResets.delete(reset);
}

export function resetRegisteredEventDataLifecycles() {
	for (const reset of eventDataLifecycleResets)
		reset();
}

/**
 * Event Data lifecycle module.
 *
 * Owns common Event-scoped collection mechanics: list loading state,
 * create/update/delete orchestration, optimistic rollback, current Event
 * filtering, remote mutation application, and reset behaviour.
 */
export function useEventDataLifecycle<
	T extends { id: number; eventId?: number },
	TCreate extends object,
	TUpdate extends object,
>(options: EventDataLifecycleOptions<T, TCreate, TUpdate>) {
	const items = ref<T[]>([]) as Ref<T[]>;
	const listLoading = ref(false);
	const error = ref<string | null>(null);
	const currentEventId = ref<number | null>(null);
	const hasFetched = ref(false);
	const isLoaded = computed(() => hasFetched.value);

	const { executeAction, optimisticUpdate, optimisticDelete } = useStoreHelpers();
	let loadGeneration = 0;

	async function loadFrom(eventId: number, loader: (eventId: number) => Promise<T[]>) {
		const generation = ++loadGeneration;
		currentEventId.value = eventId;
		listLoading.value = true;
		error.value = null;

		try {
			const data = await loader(eventId);
			if (generation !== loadGeneration || currentEventId.value !== eventId)
				return null;

			items.value = data;
			hasFetched.value = true;
			options.onLoad?.(data);
			return data;
		}
		catch (caughtError) {
			if (generation === loadGeneration) {
				error.value = caughtError instanceof Error ? caughtError.message : `Failed to load ${options.entityLabel.toLowerCase()}`;
			}
			return null;
		}
		finally {
			if (generation === loadGeneration)
				listLoading.value = false;
		}
	}

	async function loadByEventId(eventId: number) {
		return loadFrom(eventId, options.repository.list);
	}

	async function create(eventId: number, input: TCreate) {
		return executeAction(
			async () => {
				const created = await options.repository.create(eventId, input);
				items.value.push(created);
				options.onMutation?.();
				return created;
			},
			{ errorRef: error },
		);
	}

	async function update(eventId: number, id: number, updates: TUpdate) {
		return optimisticUpdate({
			items,
			id,
			updates,
			apiCall: () => options.repository.update(eventId, id, updates),
			errorRef: error,
			entityLabel: options.entityLabel,
			onSuccess: options.onMutation,
		});
	}

	async function remove(eventId: number, id: number) {
		return optimisticDelete({
			items,
			id,
			apiCall: () => options.repository.remove(eventId, id),
			errorRef: error,
			entityLabel: options.entityLabel,
			onSuccess: options.onMutation,
		});
	}

	function getById(id: number): T | undefined {
		return items.value.find(item => item.id === id);
	}

	function applyRemoteCreated(item: T) {
		if (options.eventFilter && currentEventId.value !== null && !options.eventFilter(item, currentEventId.value))
			return;
		if (options.remoteScopeFilter && !options.remoteScopeFilter(item))
			return;

		const exists = items.value.some(existing => existing.id === item.id);
		if (!exists) {
			items.value.push(item);
			options.onMutation?.();
		}
	}

	function applyRemoteUpdated(item: T) {
		if (options.eventFilter && currentEventId.value !== null && !options.eventFilter(item, currentEventId.value))
			return;
		if (options.remoteScopeFilter && !options.remoteScopeFilter(item))
			return;

		const index = items.value.findIndex(existing => existing.id === item.id);
		if (index !== -1) {
			items.value[index] = item;
			options.onMutation?.();
		}
	}

	function applyRemoteDeleted(id: number) {
		const index = items.value.findIndex(item => item.id === id);
		if (index !== -1) {
			items.value.splice(index, 1);
			options.onMutation?.();
		}
	}

	function reset() {
		loadGeneration++;
		items.value = [];
		listLoading.value = false;
		error.value = null;
		currentEventId.value = null;
		hasFetched.value = false;
		options.onReset?.();
	}

	registerEventDataLifecycleReset(reset);

	return {
		items,
		loading: listLoading,
		listLoading,
		error,
		currentEventId,
		hasFetched,
		isLoaded,
		loadByEventId,
		loadFrom,
		create,
		update,
		remove,
		getById,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		reset,
	};
}
