import type { ExecuteAction, ScreenPresenceInfo } from '~/modules/screen/runtime';
import type { Screen } from '~/types';
import { toRaw } from 'vue';
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

	/**
	 * Report a failure in the words the authority wrote about it, where it wrote any.
	 *
	 * Everything this store surfaces ends at an `Error.message`, and for a `$fetch`
	 * failure that message is the transport's status line — `[GET] "…": 409 Conflict` —
	 * which names neither what was refused nor what an operator can do about it. The
	 * sentence about the show is in the response body, and `failureSentence` owns when
	 * it may be quoted: a sub-500 status only, since a 5xx has had its prose replaced
	 * with a placeholder on the way out and a failure with no status never reached the
	 * server. #245 did this for the live-session store; this is the same adoption for
	 * the Screen store, whose `error` is what the Screens page shows (#262).
	 */
	function reportedFailure(caught: unknown): unknown {
		const sentence = failureSentence(caught);
		return sentence === undefined ? caught : new Error(sentence, { cause: caught });
	}

	function loadErrorMessage(caughtError: unknown) {
		const reported = reportedFailure(caughtError);
		return reported instanceof Error ? reported.message : 'An error occurred';
	}

	/**
	 * `executeAction`, with the substitution above applied to whatever the action threw.
	 *
	 * The substitution is inside the action rather than around the whole call so the
	 * two things downstream of it stay right: `onError` rollbacks and the deferred
	 * rejections a debounced config write answers its caller with get the same failure
	 * the banner does, and the conflict-retry inside each action still reads the raw
	 * `FetchError`'s status, because it is nested further in than this.
	 *
	 * Handed to the runtime Module as its `executeAction` so that every Screen write
	 * reports through one seam. Two seams that must agree are two seams that can drift.
	 */
	const executeReporting: ExecuteAction = (action, options) => executeAction(
		async () => {
			try {
				return await action();
			}
			catch (failure) {
				throw reportedFailure(failure);
			}
		},
		options,
	);

	// Screen presence tracking
	const screenPresence = ref<Map<number, ScreenPresenceInfo>>(new Map());
	const screenRuntime = useScreenRuntime({
		screens,
		activeScreen,
		currentEventId,
		screenPresence,
		error,
		executeAction: executeReporting,
	});

	const isLoaded = computed(() => hasFetched.value);

	/**
	 * The revision of a just-fetched Screen this client should keep.
	 *
	 * A loader's GET is version-blind: issued before the operator's own save
	 * commits, it can be served after that save settled, and caching its answer
	 * would undo an edit already back on screen. `isSupersededByCache` is the
	 * comparison #236 built for the announce path, reused here rather than copied.
	 *
	 * A refusal answers with the revision the cache kept, because all three loaders
	 * hand their answer to a caller that mirrors it into its own state — returning the
	 * refused payload would put it in front of the operator anyway. That revision
	 * comes from `cachedRevision`, the same selection `isSupersededByCache` compared
	 * against, so the two cannot name different entries when the cache holds one id
	 * twice. `toRaw` keeps the answer the same plain Screen every other cache write
	 * stores, rather than the reactive proxy a read out of the store hands back.
	 */
	function keptRevision(fetched: Screen): Screen {
		if (!screenRuntime.isSupersededByCache(fetched))
			return fetched;
		const cached = screenRuntime.cachedRevision(fetched.id);
		return cached ? toRaw(cached) : fetched;
	}

	async function loadScreensByEventId(eventId: number) {
		const flight = screensLoads.begin();
		const token = beginLoad();
		currentEventId.value = eventId;
		try {
			const data = await screenRepo.list(eventId);
			if (flight.stale || currentEventId.value !== eventId)
				return null;
			// Per Screen, not wholesale. The list is the authority on *membership* —
			// a Screen it omits is dropped however new the cache holds it, since
			// absence carries no revision to compare and a reload is how a client
			// that missed the delete announcement finds out. It is not the authority
			// on a member's *content*, which may be older than what this client holds.
			const kept = data.map(keptRevision);
			screens.value = kept;
			hasFetched.value = true;
			return kept;
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

	/**
	 * Load the Screen an output was opened on, and keep the newer of it and the cache.
	 *
	 * The comparison is the other two loaders' (#251), and reaches this one for the
	 * reason it reached them: a GET issued before a save commits can be served after
	 * it settles. What made this loader the last version-blind one is that the single
	 * route reaching it is the Screen Output, whose client issues no writes — so the
	 * race had nothing to race against. That is a fact about today's routing rather than
	 * about this loader, and it ends the day a display session is embedded in this
	 * document or the output route is linked to in-app — not with the Feature Match
	 * Overlay preview aside, which has landed and embeds through an iframe (see
	 * `cachedRevision`).
	 *
	 * `activeScreen` is emptied before the GET, deliberately: while a slug is loading
	 * this client holds no active Screen, and showing the previous one under the new
	 * slug would be worse than showing nothing. So the holder the comparison reads here
	 * is `screens` — which is where a writing client's save lands anyway, since every
	 * write path refuses a Screen it does not hold there.
	 */
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
			const kept = keptRevision(screen);
			activeScreen.value = kept;
			return kept;
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
		return executeReporting(
			async () => {
				const screenData = await screenRepo.getById(eventId, screenId);
				if (!screenData) {
					throw new Error('Screen not found');
				}
				const kept = keptRevision(screenData);
				if (kept !== screenData) {
					// Refused: the cache holds a revision the server sequenced after this
					// answer, so there is nothing to write and nothing this answer adds.
					return kept;
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
