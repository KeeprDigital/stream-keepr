import type { ModeConfigsMap, ScreenConfig, ScreenModeConfig } from '~~/shared/types/screenConfig';
import type { useAsyncAction } from '~/composables/core/useAsyncAction';
import type {
	CreateScreenInput,
	Screen,
	ScreenCommand,
	ScreenMode,
	UpdateScreenInput,
} from '~/types';
import type { MessageData, RealtimePresenceMessage } from '~/types/realtime';
import type { ScreenPresenceData } from '~/types/screen';
import type { Flight } from '~/utils/guardedSequence';
import { toRaw } from 'vue';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { createCancelableDebounce } from '~/utils/cancelableDebounce';
import { createKeyedGuardedSequence } from '~/utils/guardedSequence';
import { createKeyedQueue } from '~/utils/keyedQueue';

type ExecuteAction = ReturnType<typeof useAsyncAction>['executeAction'];

/**
 * Who is present on one Screen's channel.
 *
 * Only a Screen Output enters a Screen's presence — a control surface watches without
 * joining — so every member here is an output, and the payload each carries is the one
 * a Screen Output enters with.
 */
export interface ScreenPresenceInfo {
	count: number;
	members: RealtimePresenceMessage<ScreenPresenceData>[];
}

interface ScreenRuntimeState {
	screens: Ref<Screen[]>;
	activeScreen: Ref<Screen | null>;
	currentEventId: Ref<number | null>;
	screenPresence: Ref<Map<number, ScreenPresenceInfo>>;
	error: Ref<string | null>;
	executeAction: ExecuteAction;
}

function isConflictError(err: unknown): boolean {
	const httpErr = err as { statusCode?: number; status?: number };
	return httpErr?.statusCode === 409 || httpErr?.status === 409;
}

function stripNullValues<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value).filter(([, entryValue]) => entryValue !== null),
	);
}

/**
 * Screen write/runtime Module.
 *
 * The store owns Pinia exposure and loading state; this Module owns Screen write
 * orchestration, conflict refresh/retry, active cache updates, admin presence,
 * realtime cache mutation, and command dispatch.
 */
export function useScreenRuntime(state: ScreenRuntimeState) {
	const screenRepo = useScreenRepository();
	const presenceUnsubscribers = new Map<number, () => void>();
	interface Deferred<T> {
		resolve: (value: T) => void;
		reject: (reason?: unknown) => void;
	}
	interface PendingScreenConfigWrite {
		eventId: number;
		screenId: number;
		partialConfig: Record<string, unknown>;
		original: Screen;
		flight: Flight;
		deferred: Deferred<Screen>[];
	}
	interface PendingModeConfigWrite {
		eventId: number;
		screenId: number;
		mode: ScreenMode;
		partialConfig: Partial<ScreenModeConfig>;
		original: Screen;
		flight: Flight;
		deferred: Deferred<Screen>[];
	}
	const pendingScreenConfigWrites = new Map<string, PendingScreenConfigWrite>();
	const pendingModeConfigWrites = new Map<string, PendingModeConfigWrite>();
	const writeQueue = createKeyedQueue();
	const writeFlights = createKeyedGuardedSequence();

	function cacheScreen(screen: Screen) {
		const index = state.screens.value.findIndex(existing => existing.id === screen.id);
		if (index === -1)
			state.screens.value.push(screen);
		else
			state.screens.value[index] = screen;

		if (state.activeScreen.value?.id === screen.id)
			state.activeScreen.value = screen;
	}

	function resolveAll<T>(deferred: Deferred<T>[], value: T) {
		for (const item of deferred)
			item.resolve(value);
	}

	function rejectAll<T>(deferred: Deferred<T>[], reason: unknown) {
		for (const item of deferred)
			item.reject(reason);
	}

	/** On a 409 conflict, refresh the local screen state then retry once. */
	async function withConflictRetry<T>(
		action: () => Promise<T>,
		refresh: () => Promise<void>,
	): Promise<T> {
		try {
			return await action();
		}
		catch (err: unknown) {
			if (isConflictError(err)) {
				await refresh();
				return await action();
			}
			throw err;
		}
	}

	/** Re-fetch a screen from the API and update local Screen caches. */
	function makeRefreshScreen(eventId: number, screenId: number) {
		return async () => {
			const freshScreen = await screenRepo.getById(eventId, screenId);
			if (freshScreen)
				cacheScreen(freshScreen);
		};
	}

	async function createScreen(eventId: number, input: CreateScreenInput) {
		return state.executeAction(
			async () => {
				const createdScreen = await screenRepo.create(eventId, input);
				state.screens.value.push(createdScreen);
				return createdScreen;
			},
			{ errorRef: state.error },
		);
	}

	async function updateScreen(eventId: number, screenId: number, updates: Omit<UpdateScreenInput, 'stateVersion'>) {
		const index = state.screens.value.findIndex(s => s.id === screenId);
		if (index === -1) {
			state.error.value = 'Screen not found';
			return null;
		}

		const currentScreen = state.screens.value[index]!;
		const original = structuredClone(toRaw(currentScreen));

		state.screens.value[index] = {
			...currentScreen,
			...updates,
		};

		const refreshScreen = makeRefreshScreen(eventId, screenId);

		return state.executeAction(
			async () => {
				const updatedScreenData = await withConflictRetry(
					() => {
						const screen = state.screens.value.find(s => s.id === screenId);
						const stateVersion = screen?.stateVersion ?? 0;
						return screenRepo.update(eventId, screenId, { ...updates, stateVersion });
					},
					refreshScreen,
				);
				cacheScreen(updatedScreenData);
				return updatedScreenData;
			},
			{
				errorRef: state.error,
				onError: () => cacheScreen(original),
			},
		);
	}

	async function setScreenMode(eventId: number, screenId: number, mode: ScreenMode) {
		return updateScreen(eventId, screenId, { currentMode: mode });
	}

	function flushModeConfigWrites() {
		const entries = [...pendingModeConfigWrites.entries()];
		pendingModeConfigWrites.clear();
		for (const [key, entry] of entries) {
			void writeQueue.enqueue(key, () => state.executeAction(
				async () => {
					const refreshScreen = makeRefreshScreen(entry.eventId, entry.screenId);
					const updated = await withConflictRetry(
						() => {
							const screen = state.screens.value.find(s => s.id === entry.screenId);
							const stateVersion = screen?.stateVersion ?? 0;
							return screenRepo.updateModeConfig(entry.eventId, entry.screenId, entry.mode, entry.partialConfig, stateVersion);
						},
						refreshScreen,
					);
					if (entry.flight.current)
						cacheScreen(updated);
					resolveAll(entry.deferred, updated);
					return updated;
				},
				{
					errorRef: state.error,
					onError: (error) => {
						if (entry.flight.current)
							cacheScreen(entry.original);
						rejectAll(entry.deferred, error);
					},
				},
			));
		}
	}
	const modeConfigWriteDebounce = createCancelableDebounce(flushModeConfigWrites, 300, 1000);

	function flushScreenConfigWrites() {
		const entries = [...pendingScreenConfigWrites.entries()];
		pendingScreenConfigWrites.clear();
		for (const [key, entry] of entries) {
			void writeQueue.enqueue(key, () => state.executeAction(
				async () => {
					const refreshScreen = makeRefreshScreen(entry.eventId, entry.screenId);
					const updated = await withConflictRetry(
						() => {
							const screen = state.screens.value.find(s => s.id === entry.screenId);
							const stateVersion = screen?.stateVersion ?? 0;
							return screenRepo.updateScreenConfig(entry.eventId, entry.screenId, entry.partialConfig, stateVersion);
						},
						refreshScreen,
					);
					if (entry.flight.current)
						cacheScreen(updated);
					resolveAll(entry.deferred, updated);
					return updated;
				},
				{
					errorRef: state.error,
					onError: (error) => {
						if (entry.flight.current)
							cacheScreen(entry.original);
						rejectAll(entry.deferred, error);
					},
				},
			));
		}
	}
	const screenConfigWriteDebounce = createCancelableDebounce(flushScreenConfigWrites, 300, 1000);

	async function updateModeConfig(
		eventId: number,
		screenId: number,
		mode: ScreenMode,
		partialConfig: Partial<ScreenModeConfig>,
	) {
		const index = state.screens.value.findIndex(s => s.id === screenId);
		if (index === -1) {
			state.error.value = 'Screen not found';
			return null;
		}

		const original = state.screens.value[index]!;
		const currentConfigs = (original.modeConfigs ?? {}) as ModeConfigsMap;
		const currentModeConfig = currentConfigs[mode] ?? getDefaultConfigForMode(mode);
		const optimisticConfigs: ModeConfigsMap = {
			...currentConfigs,
			[mode]: stripNullValues({ ...currentModeConfig, ...partialConfig }),
		};
		state.screens.value[index] = { ...original, modeConfigs: optimisticConfigs };

		return new Promise<Screen>((resolve, reject) => {
			const key = `mode:${screenId}:${mode}`;
			const flight = writeFlights.begin(key);
			const existing = pendingModeConfigWrites.get(key);
			if (existing) {
				existing.partialConfig = { ...existing.partialConfig, ...partialConfig } as Partial<ScreenModeConfig>;
				existing.flight = flight;
				existing.deferred.push({ resolve, reject });
			}
			else {
				pendingModeConfigWrites.set(key, { eventId, screenId, mode, partialConfig, original, flight, deferred: [{ resolve, reject }] });
			}
			modeConfigWriteDebounce.schedule();
		});
	}

	async function updateScreenConfig(eventId: number, screenId: number, partialConfig: Record<string, unknown>) {
		const index = state.screens.value.findIndex(s => s.id === screenId);
		if (index === -1) {
			state.error.value = 'Screen not found';
			return null;
		}

		const original = state.screens.value[index]!;
		const currentConfig = (original.screenConfig ?? {}) as ScreenConfig;
		const optimisticConfig = stripNullValues({ ...currentConfig, ...partialConfig }) as ScreenConfig;
		state.screens.value[index] = { ...original, screenConfig: optimisticConfig };

		return new Promise<Screen>((resolve, reject) => {
			const key = `screen-config:${screenId}`;
			const flight = writeFlights.begin(key);
			const existing = pendingScreenConfigWrites.get(key);
			if (existing) {
				existing.partialConfig = { ...existing.partialConfig, ...partialConfig };
				existing.flight = flight;
				existing.deferred.push({ resolve, reject });
			}
			else {
				pendingScreenConfigWrites.set(key, { eventId, screenId, partialConfig, original, flight, deferred: [{ resolve, reject }] });
			}
			screenConfigWriteDebounce.schedule();
		});
	}

	async function removeScreen(eventId: number, screenId: number) {
		const index = state.screens.value.findIndex(s => s.id === screenId);
		if (index === -1) {
			state.error.value = 'Screen not found';
			return null;
		}

		const removed = state.screens.value[index]!;
		state.screens.value.splice(index, 1);

		return state.executeAction(
			async () => {
				const result = await screenRepo.remove(eventId, screenId);
				if (!result.success)
					throw new Error('Failed to delete screen');
				return result;
			},
			{
				errorRef: state.error,
				onError: () => {
					const idx = state.screens.value.findIndex(s => s.id === screenId);
					if (idx === -1) {
						const insertIdx = index < state.screens.value.length ? index : state.screens.value.length;
						state.screens.value.splice(insertIdx, 0, removed);
					}
				},
			},
		);
	}

	/**
	 * Load the announced Screen from the API and cache it.
	 *
	 * `screen:created` and `screen:updated` name a Screen rather than carrying one,
	 * so the authority is the API. Reloads are sequenced per Screen: two changes in
	 * quick succession start two loads, and without the flight the earlier answer
	 * could land last and cache a Screen that is already stale.
	 *
	 * Best effort, like the notification that triggered it. A Screen deleted between
	 * the announcement and the load simply has nothing to cache, and a failed load
	 * leaves the previous state rather than surfacing an error the operator did not
	 * cause — the next change, or a navigation, reloads it.
	 */
	const remoteScreenLoads = createKeyedGuardedSequence();

	/** The newest revision of a Screen this client holds, or null if it holds none. */
	function cachedStateVersion(screenId: number): number | null {
		const held = state.screens.value.filter(screen => screen.id === screenId);
		if (state.activeScreen.value?.id === screenId)
			held.push(state.activeScreen.value);
		if (held.length === 0)
			return null;
		return Math.max(...held.map(screen => screen.stateVersion));
	}

	/**
	 * Whether this client already holds a revision newer than the one loaded.
	 *
	 * The flight above orders reloads against each other; it cannot see a *write*.
	 * A GET issued for an announcement can be served before this client's own save
	 * commits and still land after it, and by then the save has settled and the
	 * editing field has stopped masking the store — so re-caching the superseded
	 * revision is an operator's edit visibly undone (#236).
	 *
	 * `stateVersion` is the ordering authority: the server bumps it once per Screen
	 * write, and it only ever reaches the cache from a write's own answer, never
	 * from an optimistic patch. So a cached version above the loaded one means the
	 * cache came from a write the server sequenced *after* the one being loaded —
	 * which, being a merge onto it, already carries everything the load would bring.
	 * Dropping it loses nothing, including the other operator's change that
	 * announced it.
	 */
	function isSupersededByCache(screen: Screen): boolean {
		const cachedVersion = cachedStateVersion(screen.id);
		return cachedVersion !== null && screen.stateVersion < cachedVersion;
	}

	async function reloadAnnouncedScreen(eventId: number, screenId: number) {
		const flight = remoteScreenLoads.begin(`screen:${screenId}`);
		try {
			const screen = await screenRepo.getById(eventId, screenId);
			if (flight.stale || !screen || isSupersededByCache(screen))
				return;
			cacheScreen(screen);
		}
		catch {
			// Best effort: a notification is not a write, and failing to catch up on
			// one must not put an error in front of an operator who did nothing.
		}
	}

	/** Whether this client holds the Screen, and so has something to catch up. */
	function holdsScreen(screenId: number) {
		return state.activeScreen.value?.id === screenId
			|| state.screens.value.some(screen => screen.id === screenId);
	}

	/**
	 * A created Screen is only loaded by a client that holds the Event's Screen
	 * collection — `currentEventId` is set by the list and the configuration page and
	 * deliberately not by a Screen Output, which loads one Screen by slug. An output
	 * has no list to add to, so fetching every Screen an operator creates mid-show
	 * would be work it can never use.
	 */
	async function applyRemoteCreated(data: MessageData<'screen:created'>) {
		if (state.currentEventId.value !== data.eventId)
			return;
		await reloadAnnouncedScreen(data.eventId, data.screenId);
	}

	async function applyRemoteUpdated(data: MessageData<'screen:updated'>) {
		if (!holdsScreen(data.screenId) && state.currentEventId.value !== data.eventId)
			return;
		await reloadAnnouncedScreen(data.eventId, data.screenId);
	}

	function applyRemoteDeleted(data: MessageData<'screen:deleted'>) {
		state.screens.value = state.screens.value.filter(s => s.id !== data.screenId);
		if (state.activeScreen.value?.id === data.screenId)
			state.activeScreen.value = null;
	}

	function getConnectedCount(screenId: number): number {
		return state.screenPresence.value.get(screenId)?.count ?? 0;
	}

	function subscribeToScreenPresence(screenId: number) {
		if (!state.currentEventId.value || presenceUnsubscribers.has(screenId))
			return;

		try {
			const realtime = useRealtime();
			const channel = screenRealtimeChannel(state.currentEventId.value, screenId);
			const unsubscribe = realtime.watchPresence(
				channel,
				(members: RealtimePresenceMessage<ScreenPresenceData>[]) => {
					const newMap = new Map(state.screenPresence.value);
					newMap.set(screenId, {
						count: members.length,
						members,
					});
					state.screenPresence.value = newMap;
				},
			);

			presenceUnsubscribers.set(screenId, unsubscribe);
		}
		catch (err) {
			console.warn(`Failed to subscribe to screen presence for screen ${screenId}:`, err);
		}
	}

	function unsubscribeFromScreenPresence(screenId: number) {
		const unsubscribe = presenceUnsubscribers.get(screenId);
		if (unsubscribe) {
			unsubscribe();
			presenceUnsubscribers.delete(screenId);
			const newMap = new Map(state.screenPresence.value);
			newMap.delete(screenId);
			state.screenPresence.value = newMap;
		}
	}

	function unsubscribeFromAllPresence() {
		for (const screenId of [...presenceUnsubscribers.keys()])
			unsubscribeFromScreenPresence(screenId);
	}

	async function sendScreenCommand(screenId: number, command: ScreenCommand): Promise<void> {
		if (!state.currentEventId.value)
			return;

		await $fetch(`/api/events/${state.currentEventId.value}/screens/${screenId}/command`, {
			method: 'POST',
			body: { command },
		});
	}

	function resetRuntime() {
		modeConfigWriteDebounce.cancel();
		screenConfigWriteDebounce.cancel();
		const cancellation = new Error('Screen write cancelled because its Event scope changed');
		for (const entry of pendingModeConfigWrites.values())
			rejectAll(entry.deferred, cancellation);
		for (const entry of pendingScreenConfigWrites.values())
			rejectAll(entry.deferred, cancellation);
		pendingModeConfigWrites.clear();
		pendingScreenConfigWrites.clear();
		writeFlights.supersedeAll();
		remoteScreenLoads.supersedeAll();
		unsubscribeFromAllPresence();
		state.screens.value = [];
		state.activeScreen.value = null;
		state.error.value = null;
		state.currentEventId.value = null;
		state.screenPresence.value = new Map();
	}

	return {
		cacheScreen,
		createScreen,
		updateScreen,
		setScreenMode,
		updateModeConfig,
		updateScreenConfig,
		removeScreen,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		getConnectedCount,
		subscribeToScreenPresence,
		unsubscribeFromScreenPresence,
		sendScreenCommand,
		resetRuntime,
	};
}
