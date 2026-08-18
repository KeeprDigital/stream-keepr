import type { ScreenPresenceInfo } from '~/modules/screen/runtime';
import type { Screen } from '~/types';
import { toRaw } from 'vue';
import { useScreenRuntime } from '~/modules/screen/runtime';

export const useScreenStore = defineStore('screen', () => {
	const screenRepo = useScreenRepository();

	/**
	 * The seam every Screen write reports through: `executeAction` with the authority's
	 * own sentence substituted into whatever the action threw.
	 *
	 * `useReportingAction` owns the substitution and documents where it sits. Two things
	 * here rest on that placement: the deferred rejection a debounced config write answers
	 * its caller with carries the same sentence the banner shows, and `withConflictRetry`,
	 * nested further inside each action, still meets the raw `FetchError` and can read its
	 * 409 — substitute one level deeper and the retry stops recognising the conflict.
	 *
	 * Handed to the runtime Module as its `executeAction` so that every Screen write
	 * reports through one seam. Two seams that must agree are two seams that can drift.
	 */
	const { executeReporting } = useReportingAction();

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
	 * What a failed load says to whoever is looking at the Screens page.
	 *
	 * The sentence the authority wrote about the refusal where it wrote one; otherwise
	 * the failure's own message, which for a `$fetch` failure is the transport's status
	 * line — `[GET] "…": 409 Conflict` — and reads as machinery rather than as words
	 * anyone chose. `reportedMessage` owns that ordering, and `failureSentence` owns
	 * which bodies may be quoted at all. #245 did this for the live-session store; this
	 * is the same adoption for the Screen store, whose `error` is what the Screens page
	 * shows (#262).
	 *
	 * Read here rather than raised into the failure, unlike the writes below, because
	 * all three loaders report to `error` themselves rather than through the reporting
	 * seam — and `loadScreenBySlug` re-raises what it caught, where narrowing the
	 * failure to a fresh `Error` would take a status its caller may one day want.
	 */
	function loadErrorMessage(caughtError: unknown) {
		return reportedMessage(caughtError, 'An error occurred');
	}

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
	async function loadScreenBySlug(eventId: number, slug: string, assetCapability?: string | null) {
		const flight = activeScreenLoads.begin();
		const token = beginLoad();
		activeScreen.value = null;
		try {
			const screen = await screenRepo.getBySlug(eventId, slug, assetCapability);
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

	/**
	 * Re-read the Screen this client is already showing, without blanking it.
	 *
	 * The same fetch and the same version comparison as `loadScreenBySlug`, minus
	 * the two things that loader does because it is switching Screens: it empties
	 * `activeScreen` first, and it raises loading state. Neither is right here.
	 * A Screen Output resyncs after a suspended connection while it is on program —
	 * a Screen announcement carries no sequence number, so a mode change missed
	 * while away is never delivered late and re-reading is the only way to find out
	 * (#307) — and blanking program to fetch what is very often the same Screen is
	 * exactly the failure the reconnect discipline exists to avoid. There is also no
	 * wrong-Screen risk to trade against: this asks for the slug already on screen,
	 * where `loadScreenBySlug` is asking for a different one.
	 *
	 * It shares `activeScreenLoads`, so a real slug change started meanwhile
	 * supersedes it rather than racing it, and it answers `null` rather than
	 * throwing: nothing is waiting on this to decide what to render.
	 */
	async function refreshActiveScreen(eventId: number, slug: string, assetCapability?: string | null) {
		const flight = activeScreenLoads.begin();
		try {
			const screen = await screenRepo.getBySlug(eventId, slug, assetCapability);
			if (!screen || flight.stale)
				return null;
			const kept = keptRevision(screen);
			activeScreen.value = kept;
			return kept;
		}
		catch (caughtError) {
			if (flight.current)
				error.value = loadErrorMessage(caughtError);
			return null;
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
		refreshActiveScreen,
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
