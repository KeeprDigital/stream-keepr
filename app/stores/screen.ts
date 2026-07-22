import type { ScreenPresenceInfo } from '~/modules/screen/runtime';
import type { Screen } from '~/types';
import { useScreenRuntime } from '~/modules/screen/runtime';

export const useScreenStore = defineStore('screen', () => {
	const screenRepo = useScreenRepository();
	const { executeAction } = useAsyncAction();

	const screens = ref<Screen[]>([]);
	const activeScreen = ref<Screen | null>(null);
	const loading = ref(false);
	const error = ref<string | null>(null);
	const currentEventId = ref<number | null>(null);
	const hasFetched = ref(false);
	const screensLoads = createGuardedSequence();
	const activeScreenLoads = createGuardedSequence();
	const activeLoads = new Set<symbol>();

	function beginLoad() {
		const token = Symbol('screen-load');
		activeLoads.add(token);
		loading.value = true;
		error.value = null;
		return token;
	}

	function endLoad(token: symbol) {
		activeLoads.delete(token);
		loading.value = activeLoads.size > 0;
	}

	function loadErrorMessage(caughtError: unknown) {
		return caughtError instanceof Error ? caughtError.message : 'An error occurred';
	}

	// Screen presence tracking
	const screenPresence = ref<Map<number, ScreenPresenceInfo>>(new Map());
	const screenRuntime = useScreenRuntime({
		screens,
		activeScreen,
		currentEventId,
		screenPresence,
		error,
		executeAction,
	});

	const isLoaded = computed(() => hasFetched.value);

	async function loadScreensByEventId(eventId: number) {
		const flight = screensLoads.begin();
		const token = beginLoad();
		currentEventId.value = eventId;
		try {
			const data = await screenRepo.list(eventId);
			if (flight.stale || currentEventId.value !== eventId)
				return null;
			screens.value = data;
			hasFetched.value = true;
			return data;
		}
		catch (caughtError) {
			if (flight.current)
				error.value = loadErrorMessage(caughtError);
			return null;
		}
		finally {
			endLoad(token);
		}
	}

	async function loadScreenBySlug(eventId: number, slug: string) {
		const flight = activeScreenLoads.begin();
		const token = beginLoad();
		activeScreen.value = null;
		try {
			const screen = await screenRepo.getBySlug(eventId, slug);
			if (!screen)
				throw new Error('Screen not found');
			if (flight.stale)
				return null;
			activeScreen.value = screen;
			return screen;
		}
		catch (caughtError) {
			if (flight.current)
				error.value = loadErrorMessage(caughtError);
			throw caughtError;
		}
		finally {
			endLoad(token);
		}
	}

	async function getScreenById(eventId: number, screenId: number) {
		currentEventId.value = eventId;
		return executeAction(
			async () => {
				const screenData = await screenRepo.getById(eventId, screenId);
				if (!screenData) {
					throw new Error('Screen not found');
				}
				// Ensure screen is in the screens array for updateModeConfig to work
				const existingIndex = screens.value.findIndex(s => s.id === screenId);
				if (existingIndex === -1) {
					screens.value.push(screenData);
				}
				else {
					screens.value[existingIndex] = screenData;
				}
				return screenData;
			},
			{ loadingRef: loading, errorRef: error },
		);
	}

	const createScreen = screenRuntime.createScreen;
	const updateScreen = screenRuntime.updateScreen;
	const setScreenMode = screenRuntime.setScreenMode;
	const updateModeConfig = screenRuntime.updateModeConfig;
	const updateScreenConfig = screenRuntime.updateScreenConfig;
	const removeScreen = screenRuntime.removeScreen;
	const applyRemoteCreated = screenRuntime.applyRemoteCreated;
	const applyRemoteUpdated = screenRuntime.applyRemoteUpdated;
	const applyRemoteDeleted = screenRuntime.applyRemoteDeleted;
	const getConnectedCount = screenRuntime.getConnectedCount;
	const subscribeToScreenPresence = screenRuntime.subscribeToScreenPresence;
	const unsubscribeFromScreenPresence = screenRuntime.unsubscribeFromScreenPresence;
	const sendScreenCommand = screenRuntime.sendScreenCommand;

	function $reset() {
		screensLoads.supersede();
		activeScreenLoads.supersede();
		activeLoads.clear();
		screenRuntime.resetRuntime();
		loading.value = false;
		hasFetched.value = false;
	}

	return {
		// State
		screens,
		activeScreen,
		loading,
		error,
		currentEventId,
		screenPresence,

		// Computed
		isLoaded,

		// Actions
		loadScreensByEventId,
		loadScreenBySlug,
		getScreenById,
		createScreen,
		updateScreen,
		setScreenMode,
		updateModeConfig,
		updateScreenConfig,
		removeScreen,
		applyRemoteCreated,
		applyRemoteUpdated,
		applyRemoteDeleted,
		$reset,

		// Presence
		getConnectedCount,
		subscribeToScreenPresence,
		unsubscribeFromScreenPresence,
		sendScreenCommand,
	};
});
