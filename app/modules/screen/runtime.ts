import type { ModeConfigsMap, ScreenModeConfigPatch } from '~~/shared/types/screenConfig';
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
import { getDefaultConfigForMode, toModeConfigPatch } from '~~/shared/types/screenConfig';
import { screenRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import { isStateConflictFetchFailure } from '~~/shared/utils/stateConflict';
import { createCancelableDebounce } from '~/utils/cancelableDebounce';
import { createKeyedGuardedSequence } from '~/utils/guardedSequence';
import { createKeyedQueue } from '~/utils/keyedQueue';

/** The `executeAction` seam a caller hands this Module, and wraps to report through. */
export type ExecuteAction = ReturnType<typeof useAsyncAction>['executeAction'];

/**
 * Who is present on one Screen's channel.
 *
 * Only a Screen Output enters a Screen's presence — a control surface watches without
 * joining — so every member here is an output, and the payload each carries is the one
 * a Screen Output enters with.
 *
 * What makes that true is the embed role on the Screen URL, and nothing else: a
 * control surface that embeds a live rendering of its own Screen is opening the same
 * route an output opens, and is one until its URL says otherwise. The Broadcast
 * Graphics Program monitor was exactly that for as long as its URL carried no role —
 * so a workspace with no output open anywhere counted one client live, its own.
 */
export interface ScreenPresenceInfo {
	count: number;
	members: RealtimePresenceMessage<ScreenPresenceData>[];
}

/** The credential the active Screen was looked up with, so an announcement re-reads it the same way. */
export interface ActiveScreenLookup {
	assetCapability: string | null;
}

interface ScreenRuntimeState {
	screens: Ref<Screen[]>;
	activeScreen: Ref<Screen | null>;
	activeScreenLookup: Ref<ActiveScreenLookup | null>;
	currentEventId: Ref<number | null>;
	screenPresence: Ref<Map<number, ScreenPresenceInfo>>;
	error: Ref<string | null>;
	executeAction: ExecuteAction;
}

/*
 * Only a marked lost race may be absorbed by the refresh-and-retry below. A 409
 * is also how the server refuses a write outright — an unselectable Graphic
 * Asset Reference, most visibly — and a refusal replayed onto refreshed state
 * fails identically, costing a second multi-second save before anyone is told
 * (#381). `mapPublicNitroError` marks the curable kind; everything else
 * propagates to whoever owes the author an answer.
 */
const isConflictError = isStateConflictFetchFailure;

function stripNullValues<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value).filter(([, entryValue]) => entryValue !== null),
	);
}

/** The fields one unsettled write owns on a Screen, as the write names them. */
type OwnedFields
	= | { owner: symbol; kind: 'screen'; patch: Record<string, unknown> }
		| { owner: symbol; kind: 'mode'; mode: ScreenMode; patch: Record<string, unknown> }
		| { owner: symbol; kind: 'theme-overrides'; patch: Record<string, unknown> };

/** A Screen with one write's fields laid over it; a `null` field reads as deleted. */
function applyOwnedFields(screen: Screen, fields: OwnedFields): Screen {
	switch (fields.kind) {
		case 'screen':
			return {
				...screen,
				...fields.patch,
			};
		case 'mode': {
			const configs = (screen.modeConfigs ?? {}) as ModeConfigsMap;
			const current = configs[fields.mode] ?? getDefaultConfigForMode(fields.mode);
			return {
				...screen,
				modeConfigs: {
					...configs,
					[fields.mode]: stripNullValues({
						...current,
						...fields.patch,
					}),
				},
			};
		}
		case 'theme-overrides':
			return {
				...screen,
				themeOverrides: stripNullValues({
					...(screen.themeOverrides ?? {}),
					...fields.patch,
				}),
			};
	}
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
	interface PendingModeConfigWrite {
		eventId: number;
		screenId: number;
		mode: ScreenMode;
		partialConfig: Record<string, unknown>;
		owner: symbol;
		lifetime: WriteLifetime;
		deferred: Deferred<Screen>[];
	}
	const pendingModeConfigWrites = new Map<string, PendingModeConfigWrite>();
	/**
	 * Every write of one Screen, in order, whichever part of it the write names. Each
	 * is sent at the revision the one before it was answered with, so this client's
	 * own writes do not race each other into a conflict.
	 */
	const writeQueue = createKeyedQueue<number>();

	/**
	 * A Screen as shown while writes to it are out: the newest revision the server
	 * answered with (`base`), and every unsettled write's fields laid over it, oldest
	 * first — Field Ownership. A revision arriving from anywhere replaces only `base`,
	 * so it cannot take back a field a write still owns. A write settling drops only
	 * its own fields, so a failed one rolls back to what the server holds now, keeping
	 * a remote change that landed meanwhile, and never over a newer local edit.
	 */
	interface OwnedScreen {
		base: Screen;
		writes: OwnedFields[];
	}

	/**
	 * The Event Lifetime a Screen write belongs to, begun afresh by each reset, so its
	 * answer or rollback never lands in a later lifetime — even one of the same Event
	 * (ADR-0024).
	 *
	 * It also keeps what a write needs to finish for the Event it was made in after
	 * that lifetime has ended (#703): the newest revision of each Screen the lifetime
	 * held or was answered with. A write still queued when the operator moves on is
	 * sent at it, and its conflict refresh records into it, rather than reading a
	 * cache that by then holds another Event, or nothing.
	 */
	interface WriteLifetime {
		flight: Flight;
		versions: Map<number, number>;
		owned: Map<number, OwnedScreen>;
	}
	const lifetimes = createGuardedSequence();
	function beginLifetime(): WriteLifetime {
		return {
			flight: lifetimes.begin(),
			versions: new Map(),
			owned: new Map(),
		};
	}
	let lifetime = beginLifetime();

	function heard(writeLifetime: WriteLifetime, screen: Screen) {
		const known = writeLifetime.versions.get(screen.id) ?? 0;
		writeLifetime.versions.set(screen.id, Math.max(known, screen.stateVersion));
	}

	/** The revision a write is sent at: the newest one its own lifetime knows of. */
	function versionToSend(writeLifetime: WriteLifetime, screenId: number): number {
		const known = writeLifetime.versions.get(screenId) ?? 0;
		if (writeLifetime.flight.stale)
			return known;
		return Math.max(known, cachedRevision(screenId)?.stateVersion ?? 0);
	}

	/** Put a Screen where this client shows it: `screens`, and `activeScreen` when it is that one. */
	function show(screen: Screen) {
		const index = state.screens.value.findIndex(existing => existing.id === screen.id);
		if (index === -1)
			state.screens.value.push(screen);
		else
			state.screens.value[index] = screen;

		if (state.activeScreen.value?.id === screen.id)
			state.activeScreen.value = screen;
	}

	function own(screenId: number, fields: OwnedFields) {
		const shown = state.screens.value.find(existing => existing.id === screenId);
		if (!shown)
			return;
		let owned = lifetime.owned.get(screenId);
		if (!owned) {
			owned = {
				base: toRaw(shown),
				writes: [],
			};
			lifetime.owned.set(screenId, owned);
		}
		owned.writes.push(fields);
		show(owned.writes.reduce(applyOwnedFields, owned.base));
	}

	/** Drop every field `owner` owns, and show what remains. */
	function release(writeLifetime: WriteLifetime, screenId: number, owner: symbol) {
		const owned = writeLifetime.owned.get(screenId);
		if (!owned)
			return;
		owned.writes = owned.writes.filter(write => write.owner !== owner);
		if (owned.writes.length === 0)
			writeLifetime.owned.delete(screenId);
		// A Screen deleted meanwhile stays deleted: releasing an edit of it shows nothing.
		if (writeLifetime.flight.current && holdsScreen(screenId))
			show(owned.writes.reduce(applyOwnedFields, owned.base));
	}

	/**
	 * A server revision as this client should show it: with every field a write still
	 * owns laid over it. It becomes the base those fields are laid over, so a loader
	 * holding it through here cannot take back an unsettled edit either.
	 */
	function withOwnedFields(screen: Screen): Screen {
		const owned = lifetime.owned.get(screen.id);
		if (!owned)
			return screen;
		owned.base = screen;
		return owned.writes.reduce(applyOwnedFields, screen);
	}

	/**
	 * Hold a revision the server answered with, unless a newer one is held already.
	 * Every write answer, conflict refresh and announced reload comes through here, so
	 * none of them can move a Screen's `stateVersion` backwards (#703).
	 */
	function holdRevision(screen: Screen) {
		if (isSupersededByCache(screen))
			return;
		show(withOwnedFields(screen));
	}

	/**
	 * What a write answers its caller with: the server's answer, or the newer server
	 * revision this client held by the time it came, so a caller mirroring it cannot
	 * regress. Never with another write's unsettled fields, which the server does not
	 * hold yet.
	 */
	function answerFor(writeLifetime: WriteLifetime, answer: Screen): Screen {
		if (writeLifetime.flight.stale)
			return answer;
		const held = writeLifetime.owned.get(answer.id)?.base ?? cachedRevision(answer.id);
		return held && held.stateVersion > answer.stateVersion
			? toRaw(held)
			: answer;
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

	/**
	 * Re-fetch a Screen after a lost race. Its write's lifetime hears the revision
	 * either way, so the retry is sent at it; the caches hold it only while that
	 * lifetime is current.
	 */
	function makeRefreshScreen(eventId: number, screenId: number, writeLifetime: WriteLifetime) {
		return async () => {
			const freshScreen = await screenRepo.getById(eventId, screenId);
			if (!freshScreen)
				return;
			heard(writeLifetime, freshScreen);
			if (writeLifetime.flight.current && holdsScreen(screenId))
				holdRevision(freshScreen);
		};
	}

	/**
	 * Run one write of a Screen in its turn: sent at the newest revision its lifetime
	 * knows, retried once onto a refreshed one after a lost race, and its fields
	 * released however it ends. A failure reaches the caller as a rejection, whatever
	 * the lifetime; the error banner hears it only while the lifetime is current.
	 */
	function runWrite(
		writeLifetime: WriteLifetime,
		eventId: number,
		screenId: number,
		owner: symbol,
		send: (stateVersion: number) => Promise<Screen>,
	): Promise<Screen> {
		return writeQueue.enqueue(screenId, async () => {
			const written = await state.executeAction(
				async () => {
					try {
						const answer = await withConflictRetry(
							() => send(versionToSend(writeLifetime, screenId)),
							makeRefreshScreen(eventId, screenId, writeLifetime),
						);
						heard(writeLifetime, answer);
						// A Screen deleted while the write was out stays deleted.
						if (writeLifetime.flight.current && holdsScreen(screenId))
							holdRevision(answer);
						return answerFor(writeLifetime, answer);
					}
					finally {
						release(writeLifetime, screenId, owner);
					}
				},
				{ errorRef: state.error, flight: writeLifetime.flight, throwError: true },
			);
			return written!;
		});
	}

	/**
	 * Create a Screen, and hold the server's answer the way every other write's is held.
	 *
	 * The answer used to be pushed unconditionally, which made `screens` able to hold
	 * one id twice — a state #251's review constructed through the public store API,
	 * and the one in which the version comparison and the revision a refusal answers
	 * with could name different entries. `show` is the discipline that keeps an id to
	 * one entry (#261).
	 *
	 * Which revision survives a collision is the same question `cachedRevision` already
	 * answers everywhere else, so it is answered by the same comparison rather than by
	 * a rule of this function's own: a create's answer is refused exactly when a load's
	 * would be, and no door into `screens` can move a Screen's `stateVersion` backwards.
	 * Equal is not older, as everywhere the comparison is used.
	 *
	 * It returns what the server created either way, and that is the one place this
	 * departs from the loaders. A refusal decides what this client should *hold*, and a
	 * loader must answer with the revision it kept because of what its caller does with
	 * the answer — the configuration page mirrors it into its own `screen` ref, and the
	 * display session checks it against the holder it renders from. Neither happens here,
	 * and there is no third thing this answer feeds: `Screen/CreateModal.vue` names the
	 * Screen in a success toast, otherwise reads the answer only to tell success from
	 * failure, and the `created` event it emits has no listener. So the question the
	 * answer belongs to is "what did the server make", and an entry that merely shares an
	 * id is not an answer to it.
	 */
	async function createScreen(eventId: number, input: CreateScreenInput) {
		const flight = lifetime.flight;
		return state.executeAction(
			async () => {
				const createdScreen = await screenRepo.create(eventId, input);
				if (flight.current)
					holdRevision(createdScreen);
				return createdScreen;
			},
			{ errorRef: state.error, flight },
		);
	}

	/**
	 * An ordinary Screen update: shown at once, and written in its turn among the
	 * Screen's other writes. It answers `null` on failure, as it always has.
	 */
	async function updateScreen(eventId: number, screenId: number, updates: Omit<UpdateScreenInput, 'stateVersion'>) {
		if (!state.screens.value.some(s => s.id === screenId)) {
			state.error.value = 'Screen not found';
			return null;
		}

		const owner = Symbol('screen-update');
		const writeLifetime = lifetime;
		own(screenId, { owner, kind: 'screen', patch: updates });

		try {
			return await runWrite(writeLifetime, eventId, screenId, owner, stateVersion =>
				screenRepo.update(eventId, screenId, { ...updates, stateVersion }));
		}
		catch {
			return null;
		}
	}

	async function setScreenMode(eventId: number, screenId: number, mode: ScreenMode) {
		return updateScreen(eventId, screenId, { currentMode: mode });
	}

	function flushModeConfigWrites() {
		const entries = [
			...pendingModeConfigWrites.values(),
		];
		pendingModeConfigWrites.clear();
		for (const entry of entries) {
			void runWrite(entry.lifetime, entry.eventId, entry.screenId, entry.owner, stateVersion =>
				screenRepo.updateModeConfig(entry.eventId, entry.screenId, entry.mode, entry.partialConfig, stateVersion))
				.then(
					written => resolveAll(entry.deferred, written),
					error => rejectAll(entry.deferred, error),
				);
		}
	}
	const modeConfigWriteDebounce = createCancelableDebounce(flushModeConfigWrites, 300, 1000);

	/**
	 * Edit one mode's config: shown at once, batched with the edits that follow it
	 * within the debounce, and written as one PATCH. A field the edit clears is sent
	 * as the `null` that deletes it (#703).
	 */
	async function updateModeConfig<M extends ScreenMode>(
		eventId: number,
		screenId: number,
		mode: M,
		partialConfig: ScreenModeConfigPatch<M>,
	) {
		if (!state.screens.value.some(s => s.id === screenId)) {
			state.error.value = 'Screen not found';
			return null;
		}

		const patch: Record<string, unknown> = toModeConfigPatch(mode, partialConfig);
		const key = `mode:${screenId}:${mode}`;
		const entry: PendingModeConfigWrite = pendingModeConfigWrites.get(key)
			?? {
				eventId,
				screenId,
				mode,
				partialConfig: {},
				owner: Symbol(key),
				lifetime,
				deferred: [],
			};
		pendingModeConfigWrites.set(key, entry);
		entry.partialConfig = {
			...entry.partialConfig,
			...patch,
		};
		own(screenId, {
			owner: entry.owner,
			kind: 'mode',
			mode,
			patch,
		});

		return new Promise<Screen>((resolve, reject) => {
			entry.deferred.push({ resolve, reject });
			modeConfigWriteDebounce.schedule();
		});
	}

	/**
	 * Set Screen Theme Overrides, or clear each one named with `null`: shown at
	 * once, and written in its turn among the Screen's other writes. Each edit is
	 * a finished one, so it is sent without a debounce. A failure rejects.
	 */
	async function updateThemeOverrides(eventId: number, screenId: number, tokens: Record<string, unknown>) {
		if (!state.screens.value.some(s => s.id === screenId)) {
			state.error.value = 'Screen not found';
			return null;
		}

		const owner = Symbol('theme-overrides');
		const writeLifetime = lifetime;
		own(screenId, { owner, kind: 'theme-overrides', patch: tokens });

		return await runWrite(writeLifetime, eventId, screenId, owner, stateVersion =>
			screenRepo.updateThemeOverrides(eventId, screenId, tokens, stateVersion));
	}

	async function removeScreen(eventId: number, screenId: number) {
		const index = state.screens.value.findIndex(s => s.id === screenId);
		if (index === -1) {
			state.error.value = 'Screen not found';
			return null;
		}

		const removed = state.screens.value[index]!;
		state.screens.value.splice(index, 1);
		const flight = lifetime.flight;

		return state.executeAction(
			async () => {
				const result = await screenRepo.remove(eventId, screenId);
				if (!result.success)
					throw new Error('Failed to delete screen');
				return result;
			},
			{
				errorRef: state.error,
				flight,
				onError: () => {
					const idx = state.screens.value.findIndex(s => s.id === screenId);
					if (idx === -1) {
						const insertIdx = index < state.screens.value.length
							? index
							: state.screens.value.length;
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

	/**
	 * The newest revision of a Screen this client holds, or null if it holds none.
	 *
	 * Both holders are consulted because three loaders each populate only one:
	 * `loadScreensByEventId` and `getScreenById` write `screens`, `loadScreenBySlug`
	 * writes `activeScreen`. What keeps them from disagreeing today is not that they
	 * are kept in step — only `show` does that — but that the one route
	 * reaching `loadScreenBySlug` is the Screen Output, which is `layout: false` and
	 * always its own document: embedded in an iframe or opened in its own window,
	 * never navigated to in-page. So no single store ever holds both.
	 *
	 * Embed a display session in-page — in this document, not in a frame — or add an
	 * in-app link to that route, and the two sources hold different revisions at once,
	 * at which point what keeps refusing safe is taking the *newest*: taking the oldest
	 * would let a reload downgrade `activeScreen` to a revision the client had already
	 * moved past.
	 *
	 * The Feature Match Overlay preview aside used to be named here as the change that
	 * would do it. It had already landed when that was written, and it does not: it
	 * embeds the output through an `<iframe>` (`FeatureMatchOverlay/PreviewOutputAside.vue`),
	 * which is its own document with its own store, so the disjointness survives it.
	 * Whatever ends it will be one of the two shapes above.
	 *
	 * Ending it would also cost something this returns for free today. With the holders
	 * disjoint, a refusal in #251's loaders always answers from `screens` and leaves it
	 * populated. Break disjointness and a refusal can answer from `activeScreen`
	 * instead, returning without putting anything in `screens` — so the next
	 * `updateModeConfig` finds no entry and fails with "Screen not found", where caching
	 * the fetched Screen would have let it proceed. Restoring that fallback belongs with
	 * whichever change ends the disjointness, not before it (#261 item 2).
	 *
	 * The debt is those two loaders' and stays that size now that the slug loader
	 * gates on this comparison too (#261): it empties `activeScreen` before its GET,
	 * so its refusals can only ever answer from `screens`, which is populated by
	 * definition when one happens.
	 *
	 * That disjointness is about the two holders, and says nothing about `screens`
	 * holding one id twice. Nothing this client does builds that state any more —
	 * `createScreen` was the last door that pushed without checking, and it now
	 * enters through `show` like every other write (#261) — but the reduction
	 * is over every matching entry regardless, because a list response is not this
	 * client's to guarantee, and because one selection that cannot disagree with
	 * itself is worth more than an argument about reachability. So this returns the
	 * Screen rather than its version, and every consumer selects through it: the
	 * loaders answer a refusal with exactly the revision the comparison refused
	 * against. Selecting twice is what went wrong — a `find` beside this `max`
	 * answered a refusal with an arbitrary entry, older than both the cache's
	 * newest and the payload it had just refused.
	 */
	function cachedRevision(screenId: number): Screen | null {
		const held = state.screens.value.filter(screen => screen.id === screenId);
		if (state.activeScreen.value?.id === screenId)
			held.push(state.activeScreen.value);
		return held.reduce<Screen | null>(
			(newest, screen) => (!newest || screen.stateVersion > newest.stateVersion
				? screen
				: newest),
			null,
		);
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
	 * Nothing in that is particular to an announcement: a GET the operator asked
	 * for — a page load, a route change, a refresh — races a save the same way, so
	 * all three loaders in the store gate on this too (#251, #261), and so does a
	 * create's answer (#261). What it still cannot see is an *unsettled* edit, which
	 * has no server revision yet and is masked by the editing field rather than by
	 * this comparison.
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
		const cached = cachedRevision(screen.id);
		return cached !== null && screen.stateVersion < cached.stateVersion;
	}

	/**
	 * The active Screen is re-read through the Screen Output path, with the
	 * credential it was first read with: a Screen Output holds no Session for the
	 * operator's Screen-by-id path, which used to refuse it here silently, so an
	 * output never saw a mode or configuration change (#604).
	 */
	function fetchAnnouncedScreen(eventId: number, screenId: number) {
		const lookup = state.activeScreenLookup.value;
		if (lookup && state.activeScreen.value?.id === screenId)
			return screenRepo.getScreenOutputById(eventId, screenId, lookup.assetCapability);
		return screenRepo.getById(eventId, screenId);
	}

	async function reloadAnnouncedScreen(eventId: number, screenId: number) {
		const flight = remoteScreenLoads.begin(`screen:${screenId}`);
		try {
			const screen = await fetchAnnouncedScreen(eventId, screenId);
			if (flight.stale || !screen)
				return;
			holdRevision(screen);
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
		lifetime.owned.delete(data.screenId);
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
		for (const screenId of [
			...presenceUnsubscribers.keys(),
		])
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

	/**
	 * Tear down everything this Module holds for the Event scope that is ending.
	 *
	 * The pending config writes are spent rather than discarded. Each one is an edit
	 * the operator has already been shown as applied — that is what local-first
	 * means — so cancelling it reverted the setting on the next load with nothing
	 * anywhere reporting a failure (#308). They are flushed first, and the lifetime
	 * ending hears the revision of every Screen it held, so a write still queued
	 * behind another is sent for its own Event at the revision that write answers
	 * with (#703). The lifetime is then superseded, so the answers they eventually
	 * get are not cached back into an Event this client has left. Their callers are
	 * still answered with the real outcome.
	 */
	function resetRuntime() {
		modeConfigWriteDebounce.flushIfPending();
		for (const screen of state.screens.value)
			heard(lifetime, screen);
		if (state.activeScreen.value)
			heard(lifetime, state.activeScreen.value);
		// A queued write with no armed timer is not constructible today — every entry
		// is inserted in the same breath as a `schedule()` — but an entry left here
		// would leave its caller's promise waiting forever, so it is settled rather
		// than dropped.
		const cancellation = new Error('Screen write cancelled because its Event scope changed');
		for (const entry of pendingModeConfigWrites.values())
			rejectAll(entry.deferred, cancellation);
		pendingModeConfigWrites.clear();
		lifetime = beginLifetime();
		remoteScreenLoads.supersedeAll();
		unsubscribeFromAllPresence();
		state.screens.value = [];
		state.activeScreen.value = null;
		state.activeScreenLookup.value = null;
		state.error.value = null;
		state.currentEventId.value = null;
		state.screenPresence.value = new Map();
	}

	return {
		withOwnedFields,
		cachedRevision,
		isSupersededByCache,
		createScreen,
		updateScreen,
		setScreenMode,
		updateModeConfig,
		updateThemeOverrides,
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
