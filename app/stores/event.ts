import type {
	CreateEventInput,
	CreateTalentInput,
	Event,
	Talent,
	UpdateEventInput,
	UpdateTalentInput,
} from '~/types';
import type { MessageData } from '~/types/realtime';
import { useEventDataResource } from '~/modules/event-data/client';

export const useEventStore = defineStore('event', () => {
	const eventRepo = useEventRepository();
	const talentRepo = useEventDataResource<Talent, CreateTalentInput, UpdateTalentInput>({
		resourcePath: 'talents',
		eventScoped: true,
		includeHeaders: true,
	});
	const { executeReporting } = useReportingAction();

	const event = ref<Event | null>(null);
	const eventsList = ref<Event[]>([]);
	const loading = ref(false);
	const error = ref<string | null>(null);
	let eventLoadGeneration = 0;
	let listLoadGeneration = 0;
	const activeLoads = new Set<symbol>();

	function beginLoad() {
		const token = Symbol('event-load');
		activeLoads.add(token);
		loading.value = true;
		error.value = null;
		return token;
	}

	function endLoad(token: symbol) {
		activeLoads.delete(token);
		loading.value = activeLoads.size > 0;
	}

	/**
	 * What a failed load says to whoever is looking at the page.
	 *
	 * The sentence the server wrote about the refusal where it wrote one — an Event that
	 * belongs to another installation says so, and `[GET] "/api/events/1": 403 Forbidden`
	 * does not (#262).
	 *
	 * Read here rather than raised into the failure, unlike every other action in this
	 * store, because both loads re-raise what they caught — and what a caller does with a
	 * failure this store did not report is not this store's business. No caller branches
	 * on the status today; the point is that replacing the failure with a fresh `Error`
	 * carrying a message and nothing else would narrow, at a seam nobody asked to be
	 * narrowed, what every future catch here is allowed to see. Reporting and re-raising
	 * are different jobs, and only the first one is about words.
	 */
	function loadErrorMessage(caughtError: unknown) {
		return failureSentence(caughtError)
			?? (caughtError instanceof Error ? caughtError.message : 'An error occurred');
	}

	const isLoaded = computed(() => event.value !== null);

	const eventId = computed(() => {
		if (!event.value)
			return null;
		return event.value.id;
	});

	function upsertTalentById(talentData: Talent) {
		const index = event.value?.talents.findIndex(t => t.id === talentData.id) ?? -1;
		if (index !== -1 && event.value) {
			event.value.talents[index] = { ...talentData, updatedAt: new Date() };
			return;
		}
		if (event.value) {
			event.value.talents.push({ ...talentData, createdAt: new Date(), updatedAt: new Date() });
		}
	}

	function removeTalentById(talentId: number) {
		if (!event.value)
			return;
		const index = event.value.talents.findIndex(t => t.id === talentId);
		if (index !== -1) {
			event.value.talents.splice(index, 1);
		}
	}

	function setEvent(data: Event) {
		event.value = data;
	}

	function applyRemoteUpdated(data: MessageData<'event:updated'>) {
		if (event.value && data.event.id === event.value.id) {
			event.value = {
				...event.value,
				...data.event,
			};
		}

		const index = eventsList.value.findIndex(e => e.id === data.event.id);
		if (index !== -1) {
			Object.assign(eventsList.value[index]!, data.event);
		}
	}

	function applyRemoteTalentCreated(data: MessageData<'talent:created'>) {
		if (event.value && data.talent.eventId === event.value.id) {
			upsertTalentById(data.talent);
		}
	}

	function applyRemoteTalentUpdated(data: MessageData<'talent:updated'>) {
		if (event.value && data.talent.eventId === event.value.id) {
			upsertTalentById(data.talent);
		}
	}

	function applyRemoteTalentDeleted(data: MessageData<'talent:deleted'>) {
		if (event.value && data.eventId === event.value.id) {
			removeTalentById(data.talentId);
		}
	}

	async function loadEvent(id: number) {
		const generation = ++eventLoadGeneration;
		const token = beginLoad();
		try {
			const eventData = await eventRepo.getById(id);
			if (!eventData)
				throw new Error('Event not found');
			if (generation !== eventLoadGeneration)
				return null;
			setEvent(eventData);
			return eventData;
		}
		catch (caughtError) {
			if (generation === eventLoadGeneration)
				error.value = loadErrorMessage(caughtError);
			throw caughtError;
		}
		finally {
			endLoad(token);
		}
	}

	async function loadEventsList(game?: 'mtg' | 'op') {
		const generation = ++listLoadGeneration;
		const token = beginLoad();
		try {
			const eventsData = await eventRepo.list({ game });
			if (generation !== listLoadGeneration)
				return null;
			eventsList.value = eventsData;
			return eventsData;
		}
		catch (caughtError) {
			if (generation === listLoadGeneration)
				error.value = loadErrorMessage(caughtError);
			throw caughtError;
		}
		finally {
			endLoad(token);
		}
	}

	async function createEvent(input: CreateEventInput) {
		return executeReporting(
			async () => {
				const createdEvent = await eventRepo.create(input);

				eventsList.value.push(createdEvent);

				setEvent(createdEvent);

				return createdEvent;
			},
			{ loadingRef: loading, errorRef: error },
		);
	}

	async function updateEvent(updates: UpdateEventInput) {
		if (!event.value) {
			error.value = 'No event loaded';
			return null;
		}

		const original = structuredClone(toRaw(event.value));

		// Type-safe optimistic update for event
		const optimisticEvent: Event = {
			...event.value,
			...updates,
		};
		event.value = optimisticEvent;

		return executeReporting(
			async () => {
				const updatedEvent = await eventRepo.update(original.id, updates);

				if (!event.value)
					return null;

				event.value = {
					...event.value,
					...updatedEvent,
				};

				const listItemIndex = eventsList.value.findIndex(e => e.id === original.id);
				if (listItemIndex !== -1) {
					eventsList.value[listItemIndex] = {
						...eventsList.value[listItemIndex],
						...updatedEvent,
					};
				}

				await syncEventDependents(original.id, updates);

				return event.value;
			},
			{
				errorRef: error,
				onError: () => {
					event.value = original;
				},
			},
		);
	}

	async function addTalent(input: CreateTalentInput) {
		if (!event.value) {
			error.value = 'No event loaded';
			return null;
		}

		const eventId = event.value.id;

		return executeReporting(
			async () => {
				const createdTalent = await talentRepo.create(eventId, input);

				if (!event.value)
					return createdTalent;

				// Avoid duplicates if real-time already appended
				const exists = event.value.talents.some(t => t.id === createdTalent.id);
				if (!exists) {
					event.value.talents.push(createdTalent);
				}

				return createdTalent;
			},
			{ errorRef: error },
		);
	}

	async function updateTalent(talentId: number, updates: UpdateTalentInput) {
		if (!event.value) {
			error.value = 'No event loaded';
			return null;
		}

		const index = event.value.talents.findIndex(t => t.id === talentId);
		if (index === -1) {
			error.value = 'Talent not found';
			return null;
		}

		const currentTalent = event.value.talents[index]!;
		const original = structuredClone(toRaw(currentTalent));

		event.value.talents[index] = {
			...currentTalent,
			...updates,
		};

		const eventId = event.value.id;

		return executeReporting(
			async () => {
				const updatedTalentData = await talentRepo.update(eventId, talentId, updates);

				if (!event.value)
					return updatedTalentData;

				const idx = event.value.talents.findIndex(t => t.id === talentId);
				if (idx !== -1) {
					event.value.talents[idx] = updatedTalentData;
				}

				return updatedTalentData;
			},
			{
				errorRef: error,
				onError: () => {
					if (!event.value)
						return;
					const idx = event.value.talents.findIndex(t => t.id === talentId);
					if (idx !== -1) {
						event.value.talents[idx] = original;
					}
				},
			},
		);
	}

	async function removeTalent(talentId: number) {
		if (!event.value) {
			error.value = 'No event loaded';
			return null;
		}

		const index = event.value.talents.findIndex(t => t.id === talentId);
		if (index === -1) {
			error.value = 'Talent not found';
			return null;
		}

		const removed = event.value.talents[index]!;
		event.value.talents.splice(index, 1);

		const eventId = event.value.id;

		return executeReporting(
			async () => {
				const result = await talentRepo.remove(eventId, talentId);
				if (!result.success) {
					throw new Error('Failed to delete talent');
				}

				return result;
			},
			{
				errorRef: error,
				onError: () => {
					if (!event.value)
						return;
					const idx = event.value.talents.findIndex(t => t.id === talentId);
					if (idx === -1) {
						// If not found, insert at original position or at end
						const insertIdx = index < event.value.talents.length ? index : event.value.talents.length;
						event.value.talents.splice(insertIdx, 0, removed);
					}
				},
			},
		);
	}

	/**
	 * After a successful event update, sync dependent stores with any settings
	 * that changed. Uses lazy store access (Pinia-idiomatic cross-store pattern)
	 * so the event store does not import from the other stores at the module level.
	 */
	async function syncEventDependents(eventId: number, updates: UpdateEventInput) {
		// Reload feature match slots when slot count changes. The realtime
		// self-origin guard skips the server-broadcast update for the originating
		// client, so an explicit reload is required here.
		if (updates.numFeatureMatches !== undefined)
			await useFeatureMatchStore().loadFeatureMatchesByEventId(eventId);

		// Push updated clock settings to any already-loaded match states.
		if (
			updates.featureMatchDefaultClockType !== undefined
			|| updates.featureMatchDefaultClockDuration !== undefined
			|| updates.featureMatchDefaultCountUpAfterCountdown !== undefined
		) {
			const durationMs = updates.featureMatchDefaultClockDuration !== undefined
				? updates.featureMatchDefaultClockDuration * 60 * 1000
				: undefined;
			useFeatureMatchStateStore().updateAllClockSettings(
				updates.featureMatchDefaultClockType,
				durationMs,
				updates.featureMatchDefaultCountUpAfterCountdown,
			);
		}
	}

	async function deleteEvent(id: number) {
		return executeReporting(
			async () => {
				const result = await eventRepo.remove(id);
				if (!result.success) {
					throw new Error('Failed to delete event');
				}

				if (event.value?.id === id) {
					$reset();
				}

				eventsList.value = eventsList.value.filter(e => e.id !== id);

				return result;
			},
			{ loadingRef: loading, errorRef: error },
		);
	}

	function $reset() {
		eventLoadGeneration++;
		activeLoads.clear();
		event.value = null;
		error.value = null;
		loading.value = false;
	}

	return {
		// State
		event,
		eventsList,
		loading,
		error,

		// Computed
		isLoaded,
		eventId,

		// Actions
		setEvent,
		loadEvent,
		loadEventsList,
		createEvent,
		updateEvent,
		addTalent,
		updateTalent,
		removeTalent,
		deleteEvent,
		applyRemoteUpdated,
		applyRemoteTalentCreated,
		applyRemoteTalentUpdated,
		applyRemoteTalentDeleted,
		$reset,
	};
});
