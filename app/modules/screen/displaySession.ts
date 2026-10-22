import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { ScreenOutputEvent } from '~~/shared/utils/screenOutputEvent';
import type { ScreenOutputReadScope } from '~/composables/repositories/useScreenOutputReadRepository';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { ScreenCardDataHealth, ScreenPresenceData } from '~/types/screen';
import type { Flight } from '~/utils/guardedSequence';
import { useIntervalFn } from '@vueuse/core';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import { eventRealtimeChannel } from '~~/shared/utils/realtimeChannels';
import {
	parseScreenEmbed,
	parseScreenOutput,
	screenOutputAssetCapabilityFromHash,
	screenOutputBackground,
} from '~~/shared/utils/screenOutput';
import { useRoute } from '#app';
import { useRealtime } from '~/composables/core/useRealtime';
import { useReconnectResync } from '~/composables/core/useReconnectResync';
import { useScreenOutputReadRepository } from '~/composables/repositories/useScreenOutputReadRepository';
import { useScreenRealtimeSession } from '~/composables/screen/useScreenRealtimeSession';
import { getScreenModeDisplayType, isControlScreenMode } from '~/modules/screen-mode';
import { SCREEN_MODE_REREAD_MS } from '~/modules/screen-mode/freshness';
import { useEventStore } from '~/stores/event';
import { useScreenStore } from '~/stores/screen';
import { buildFeatureMatchOverlayExportFilename, exportElementPng } from '~/utils/exportElementPng';
import { createGuardedSequence } from '~/utils/guardedSequence';

interface ScreenRealtimeDisplaySession {
	start: (eventId: number, screenId: number) => Promise<void>;
	stop: () => Promise<void>;
	updatePresenceData: () => Promise<void>;
}

interface ScreenDisplaySessionExportAdapter {
	exportElementPng: typeof exportElementPng;
	buildFilename: typeof buildFeatureMatchOverlayExportFilename;
	closeWindow: () => void;
}

interface ScreenDisplaySessionOptions {
	route?: RouteLocationNormalizedLoaded;
	eventStore?: ReturnType<typeof useEventStore>;
	screenStore?: ReturnType<typeof useScreenStore>;
	realtime?: ReturnType<typeof useRealtime>;
	outputReads?: Pick<ReturnType<typeof useScreenOutputReadRepository>, 'event'>;
	createRealtimeSession?: (options: Parameters<typeof useScreenRealtimeSession>[0]) => ScreenRealtimeDisplaySession;
	exportAdapter?: Partial<ScreenDisplaySessionExportAdapter>;
}

const defaultExportAdapter: ScreenDisplaySessionExportAdapter = {
	exportElementPng,
	buildFilename: buildFeatureMatchOverlayExportFilename,
	closeWindow: () => window.close(),
};

/**
 * How long a load whose Event context read failed waits before trying again:
 * the slow cadence Screen Mode Data Freshness retries a failed read on.
 */
export const SCREEN_OUTPUT_LOAD_RETRY_MS = SCREEN_MODE_REREAD_MS;

/** Why a load stopped short, which decides what the rendering says about it. */
type LoadFailure = 'event-missing' | 'screen-missing' | 'event-context-unavailable';

const loadFailureMessages: Record<LoadFailure, { title: string; detail: (screenSlug: string) => string }> = {
	'event-missing': {
		title: 'Event not found',
		detail: () => 'This output\'s address names no event.',
	},
	'screen-missing': {
		title: 'Screen not found',
		detail: screenSlug => `The screen "${screenSlug}" could not be found for this event.`,
	},
	'event-context-unavailable': {
		title: 'Event details unavailable',
		detail: screenSlug => `The screen "${screenSlug}" was found, but its event details could not be loaded. Retrying automatically.`,
	},
};

/** The Screen was found and its Event context read failed: not a missing Screen. */
class EventContextUnavailable extends Error {
	constructor(cause: unknown) {
		super('Event context unavailable', { cause });
	}
}

function firstRouteParam(value: string | string[]): string {
	return Array.isArray(value) ? value[0] ?? '' : value;
}

function routeEventId(route: RouteLocationNormalizedLoaded): number {
	return Number(firstRouteParam(route.params.eventId as string | string[]));
}

export function useScreenDisplaySession(options: ScreenDisplaySessionOptions = {}) {
	const route = options.route ?? useRoute();
	const eventStore = options.eventStore ?? useEventStore();
	const screenStore = options.screenStore ?? useScreenStore();
	const realtime = options.realtime ?? useRealtime();
	const outputReads = options.outputReads ?? useScreenOutputReadRepository();
	const exportAdapter = { ...defaultExportAdapter, ...options.exportAdapter };

	const eventId = computed(() => eventStore.eventId);
	const screenSlug = computed(() => firstRouteParam(route.params.screenSlug as string | string[]));
	const parsedOutput = computed(() => parseScreenOutput(route.query.output));
	const outputMode = computed<ScreenOutput>(() => parsedOutput.value.output);
	const outputWarning = computed(() => parsedOutput.value.warning);
	const shouldDownload = computed(() => route.query.download === '1');
	/**
	 * Which control surface, if any, embedded this rendering — and so whether it is
	 * one of its Screen's outputs at all.
	 *
	 * ## Why the two roles are one selection
	 *
	 * A Program monitor and an editor preview overlap in exactly one thing: neither is
	 * a Screen Output, so neither joins its Screen's presence. Everything else about
	 * them is opposed. A preview composes the stack its embedder pushes in and
	 * resolves media as the author; a monitor loads playout and resolves media through
	 * the capability, because its whole job is showing what is on air and it cannot do
	 * that on authored state or on media a real output could not fetch.
	 *
	 * So a monitor is not a preview with an exception, and pointing one at
	 * `embed=preview` to borrow the presence suppression would leave it composing
	 * nothing — `useBroadcastGraphicsModeData` withholds the Live Session from a
	 * preview, and no editor pushes a monitor a stack. One selection keeps that
	 * mistake unspellable.
	 */
	const embed = computed(() => parseScreenEmbed(route.query.embed));
	const isPreview = computed(() => embed.value === 'preview');
	/*
	 * Editor-only guides require the preview role as well as their own flag, so an
	 * ordinary Screen Output URL draws none.
	 *
	 * ## What holds, and why guide visibility is left as it is (issue #134)
	 *
	 * The guide flags carry no authority of their own: neither draws anything without
	 * `embed=preview`. And `screenOutputPath` sets an embed role only when an embedder
	 * asks for one, which the copyable broadcast URLs and the PNG capture URL never
	 * do. So no Screen Output URL this application hands an operator can render a
	 * guide, and that is the property the glossary states.
	 *
	 * ## What does not hold, so nobody rebuilds an argument on it
	 *
	 * The preview role is *not* proof that an output is not live. It suppresses the
	 * Screen realtime session (below) — no takes, no playout, no presence — and for a
	 * Broadcast Graphics Screen that is most of what live means. A Feature Match
	 * Overlay degrades far less: the Event realtime session is started by a plugin
	 * this role does not suppress, so Feature Match updates still arrive; the sample
	 * dataset is skipped whenever a Slot is assigned, so the data is real; the
	 * transparent-preview backdrop is drawn only for the Overlay Output, so `fill` and
	 * `key` composite normally; and asset resolution only degrades a layout that
	 * references Graphic Assets. A hand-built `embed=preview&guides=1&output=fill` URL
	 * on such a Screen renders close to a live output with guides over it, and fails
	 * nothing loudly.
	 *
	 * That residual is accepted rather than closed. Reaching it means constructing by
	 * hand a URL the application never produces, and closing it means gating guides on
	 * something a URL cannot carry — a handshake with the embedding editor — which
	 * buys a race on every preview load, on a surface an author is clicking.
	 *
	 * ## The monitor role's own residual, which is the same shape
	 *
	 * A hand-built `embed=monitor` URL opened as a real output renders program
	 * correctly and reports nothing: it is absent from its Screen's connected count
	 * and from the asset-access warning. That is a worse silence than the guides one,
	 * since those surfaces exist precisely to state what the outputs watching right
	 * now cost. It is accepted on the same ground — no URL this application produces
	 * sets the role, and every surface that hands an operator an output URL goes
	 * through `useScreenOutputAccessUrl`, which asks for no role at all.
	 */
	const previewGuides = computed(() => isPreview.value && route.query.guides === '1');
	const previewSafeAreas = computed(() => isPreview.value && route.query.safe === '1');
	const assetCapability = computed(() => screenOutputAssetCapabilityFromHash(route.hash ?? ''));

	const isControlScreen = computed(() => {
		const mode = screenStore.activeScreen?.currentMode;
		return mode ? isControlScreenMode(mode) : false;
	});
	const layoutName = computed(() => isControlScreen.value ? 'screen-control' : 'screen');

	const activeScreen = toRef(screenStore, 'activeScreen');
	const interactiveRef = ref(false);
	const overlayContainer = ref<HTMLElement | null>(null);
	/**
	 * The rendering's self-report on its card data, carried to control surfaces
	 * through presence exactly as `assetAccess` is (#231, #465). It reaches
	 * program never: outputs keep rendering whatever they resolved, and the
	 * operator learns about the degradation beside the controls instead.
	 */
	const cardDataHealth = ref<ScreenCardDataHealth>('complete');
	const screenContext: ScreenContext = {
		screen: activeScreen,
		eventId,
		interactive: interactiveRef,
		overlayContainer,
		outputMode,
		outputWarning,
		isPreview,
		previewGuides,
		previewSafeAreas,
		assetCapability,
		cardDataHealth,
	};

	watch(isControlScreen, (isControl) => {
		interactiveRef.value = isControl;
	}, { immediate: true });

	const loading = ref(true);
	const loadFailure = ref<LoadFailure | null>(null);
	const error = computed(() => loadFailure.value ? loadFailureMessages[loadFailure.value].title : null);
	const errorDetail = computed(() => loadFailure.value ? loadFailureMessages[loadFailure.value].detail(screenSlug.value) : null);
	const exportError = ref<string | null>(null);
	const showIdentify = ref(false);
	const showDebug = ref(false);
	const loads = createGuardedSequence();
	const connectedAt = Date.now();
	const uptimeSeconds = ref(0);

	useIntervalFn(() => {
		uptimeSeconds.value = Math.floor((Date.now() - connectedAt) / 1000);
	}, 1000);

	const identifyClass = computed(() => outputMode.value === 'key' ? 'border-white' : 'border-primary');
	const debugPanelClass = computed(() => outputMode.value === 'key'
		? 'bg-white text-white border border-white'
		: 'bg-black/80 text-white');

	const debugInfo = computed(() => ({
		connectionId: realtime.connectionId ?? 'N/A',
		screenId: screenStore.activeScreen?.id,
		screenSlug: screenSlug.value,
		displayType: screenStore.activeScreen?.currentMode
			? getScreenModeDisplayType(screenStore.activeScreen.currentMode)
			: 'unknown',
		mode: screenStore.activeScreen?.currentMode,
		output: outputMode.value,
		outputWarning: outputWarning.value,
		// Named here rather than left to be inferred from an absent picture: with no
		// capability this output renders every graphic except its media, and the two
		// look the same from the far end of a venue (#231).
		assetAccess: assetCapability.value ? 'granted' : 'absent',
		cardData: cardDataHealth.value,
		uptime: uptimeSeconds.value,
		connectionState: realtime.connectionState,
	}));

	function resolveEventId() {
		return eventId.value ?? routeEventId(route);
	}

	function handleRefresh() {
		window.location.reload();
	}

	function handleIdentify() {
		showIdentify.value = true;
		setTimeout(() => {
			showIdentify.value = false;
		}, 2000);
	}

	function handleDebug() {
		showDebug.value = !showDebug.value;
	}

	const screenRealtimeSession = (options.createRealtimeSession ?? useScreenRealtimeSession)({
		onRefresh: handleRefresh,
		onIdentify: handleIdentify,
		onDebug: handleDebug,
		getPresenceData: (_evtId, screenId): ScreenPresenceData => ({
			screenId,
			connectedAt,
			outputMode: outputMode.value,
			assetAccess: assetCapability.value ? 'granted' : 'absent',
			cardData: cardDataHealth.value,
		}),
	});

	// A health change after entry re-announces this output's presence data; the
	// session makes it a no-op on any surface that never entered (previews,
	// monitors), so only real Screen Outputs report.
	watch(cardDataHealth, () => {
		void screenRealtimeSession.updatePresenceData();
	});

	async function captureDownload() {
		if (!shouldDownload.value || !screenStore.activeScreen)
			return;

		// `loading = false` makes the ScreenRenderer eligible to mount, but its
		// template ref is not assigned until Vue flushes that render. Checking the
		// container before this tick silently abandoned captures opened with
		// `download=1`: the temporary tab rendered the page and then did nothing.
		await nextTick();
		const container = overlayContainer.value;
		if (!container)
			return;

		const width = screenStore.activeScreen.screenConfig?.width ?? container.offsetWidth;
		const height = screenStore.activeScreen.screenConfig?.height ?? container.offsetHeight;
		const output = outputMode.value;

		try {
			await exportAdapter.exportElementPng(container, {
				width,
				height,
				filename: exportAdapter.buildFilename({
					screenSlug: screenSlug.value,
					output,
					width,
					height,
				}),
				backgroundColor: screenOutputBackground(output),
			});
			setTimeout(exportAdapter.closeWindow, 500);
		}
		catch (err) {
			console.error('Failed to export screen PNG:', err);
			exportError.value = err instanceof Error ? err.message : 'Failed to export PNG';
		}
	}

	/**
	 * The Screen and Event this rendering finished loading, or nothing while its
	 * load is incomplete.
	 *
	 * A load is the whole of what a rendering needs: its Screen looked up, its
	 * Event context read through that Screen, and — for a Screen Output — its
	 * realtime session started. A Screen lookup alone is not a finished load: an
	 * output whose Event context failed holds a Screen and renders nothing, and
	 * treating the held Screen as loaded left it so for good, because its recovery
	 * only ever re-read the Screen (#705).
	 */
	const loadedOn = ref<ScreenOutputReadScope | null>(null);
	/** Recovery of a loaded rendering; superseded by every new load. */
	const recoveries = createGuardedSequence();

	/** Forget the finished load and drop any recovery or retry of it, because a new load begins. */
	function forgetLoad() {
		loadedOn.value = null;
		recoveries.supersede();
		cancelLoadRetry();
	}

	/**
	 * The current load attempt's own listening on its Event channel, for what
	 * Reconnect Resync cannot hear yet: it follows only a finished load's Event.
	 *
	 * - **The first attach.** A load reads before it listens: the Event channel
	 *   attaches only once the Event context names it, after the reads have
	 *   answered. Whatever was published in between reached neither the reads nor
	 *   any listener, and a first attach on an unbroken connection reports no
	 *   continuity loss (ADR-0023). So a load re-reads once off that attach, rather
	 *   than attaching before it reads, which would hold program blank for as long
	 *   as a token outage lasts (#727). Inert when the channel is attached already
	 *   — a Screen change within one Event — because then it was listening before
	 *   the reads went out.
	 * - **A continuity loss.** On a channel already attached, a loss while the
	 *   load reads means something published meanwhile went unheard too (#733).
	 *
	 * Either one heard mid-load asks for one recovery once the load finishes,
	 * rather than superseding it; heard once loaded, it recovers. Begun before the
	 * load's first read is sent, and ended by the next attempt, a failure, or
	 * disposal.
	 */
	let stopListeningForLoad: Array<() => void> = [];
	/** The load that heard a reason to re-read while it was still reading, if any. */
	let loadAskedRecovery: Flight | null = null;

	function listenDuringLoad(evtId: number, flight: Flight) {
		stopListeningDuringLoad();
		const channel = eventRealtimeChannel(evtId);
		function askForRecovery() {
			if (flight.stale)
				return;
			if (loadedOn.value)
				queueRecovery();
			else
				loadAskedRecovery = flight;
		}
		stopListeningForLoad = [
			realtime.onceAttached(channel, askForRecovery),
			realtime.onContinuityLost(channel, askForRecovery),
		];
	}

	function stopListeningDuringLoad() {
		for (const stop of stopListeningForLoad.splice(0))
			stop();
		loadAskedRecovery = null;
	}

	/** The slow retry of a load whose Event context read failed. */
	let loadRetry: ReturnType<typeof setTimeout> | null = null;

	function cancelLoadRetry() {
		if (loadRetry)
			clearTimeout(loadRetry);
		loadRetry = null;
	}

	/** Begin one attempt at a load: no retry stands for it, and it listens on its Event channel. */
	function beginLoadAttempt(evtId: number, flight: Flight) {
		cancelLoadRetry();
		listenDuringLoad(evtId, flight);
	}

	function readScope(evtId: number, screenId: number): ScreenOutputReadScope {
		return { eventId: evtId, screenId, assetCapability: assetCapability.value };
	}

	async function loadActiveScreen(slug: string, flight = loads.begin()) {
		const evtId = resolveEventId();

		forgetLoad();
		loading.value = true;
		loadFailure.value = null;
		exportError.value = null;

		if (!evtId) {
			if (flight.current) {
				loadFailure.value = 'event-missing';
				loading.value = false;
			}
			return;
		}

		beginLoadAttempt(evtId, flight);
		try {
			// The capability is this output's credential for the lookup itself since
			// #397, not only for the media it later resolves. An `embed=preview`
			// surface has none and is admitted by its operator's session instead.
			const loadedScreen = await screenStore.loadScreenBySlug(evtId, slug, assetCapability.value);
			if (flight.stale)
				return;
			if (!loadedScreen || screenStore.activeScreen?.id !== loadedScreen.id)
				throw new Error('Screen not found');

			await finishLoad(readScope(evtId, loadedScreen.id), flight);
		}
		catch (err) {
			failLoad(err instanceof EventContextUnavailable ? 'event-context-unavailable' : 'screen-missing', err, flight);
		}
	}

	/**
	 * Everything a load does once its Screen is held. Throws on failure, which
	 * leaves the Screen held and the load incomplete, so the next recovery resumes
	 * here rather than settling for the Screen.
	 */
	async function finishLoad(scope: ScreenOutputReadScope, flight: Flight) {
		// The Event context comes through the same Screen, not the operator's
		// private Event read: an output has no Session for that read to admit
		// (#604). Rendering waits for it, because every mode reads its Event.
		let outputEvent: ScreenOutputEvent;
		try {
			outputEvent = await outputReads.event(scope);
		}
		catch (err) {
			throw new EventContextUnavailable(err);
		}
		if (flight.stale)
			return;
		eventStore.setOutputEvent(outputEvent);

		// Only a Screen Output joins its Screen's presence and answers its Screen's
		// commands. An embedded rendering of either kind is a control surface's own
		// view — counting it would report the operator's own window back to them as
		// a client watching, and an Identify meant to locate a display in a venue
		// would flash the one screen they are already looking at.
		if (!embed.value) {
			await screenRealtimeSession.start(scope.eventId, scope.screenId);
		}
		if (flight.stale)
			return;

		loadedOn.value = scope;
		loadFailure.value = null;
		loading.value = false;
		if (loadAskedRecovery === flight) {
			loadAskedRecovery = null;
			queueRecovery();
		}
		await captureDownload();
	}

	/**
	 * A load that stopped short says why. A failed Event context read is not a
	 * missing Screen, and nothing else retries it while the connection stays up, so
	 * it retries itself on a slow cadence until the load finishes (#727).
	 */
	function failLoad(failure: LoadFailure, err: unknown, flight: Flight) {
		if (flight.stale)
			return;
		console.error('Failed to load screen:', err);
		stopListeningDuringLoad();
		loading.value = false;
		loadFailure.value = failure;
		if (failure === 'event-context-unavailable') {
			loadRetry = setTimeout(() => {
				loadRetry = null;
				resyncActiveScreen();
			}, SCREEN_OUTPUT_LOAD_RETRY_MS);
		}
	}

	/**
	 * Finish a load that held its Screen and failed after it. The held Screen is
	 * re-read by its id first, because it may have changed — or been renamed —
	 * while this rendering showed nothing. The failure it shows stands until the
	 * load finishes, and a failure leaves it incomplete for the next recovery.
	 *
	 * A failure here is never "Screen not found": the Screen was found, and its
	 * re-read answers nothing for a failed read as for a missing Screen, so one
	 * that answers nothing is retried like the Event context read it resumes.
	 */
	async function resumeLoad(scope: ScreenOutputReadScope) {
		const flight = loads.begin();
		beginLoadAttempt(scope.eventId, flight);
		try {
			const screen = await screenStore.refreshActiveScreen(scope.eventId, scope.screenId, scope.assetCapability);
			if (flight.stale)
				return;
			if (!screen)
				throw new Error('The Screen re-read answered nothing');
			await finishLoad(scope, flight);
		}
		catch (err) {
			failLoad('event-context-unavailable', err, flight);
		}
	}

	/**
	 * Re-read the Event context a loaded rendering holds. An `event:updated` that
	 * lands while the read is in flight may be newer or older than its answer, and
	 * the context carries no revision to tell them apart, so the answer is not
	 * applied over it and one more read settles which is current — as Screen Mode
	 * Data Freshness does for a mode's data.
	 */
	async function rereadOutputEvent(scope: ScreenOutputReadScope, flight: Flight) {
		for (;;) {
			const heldBefore = eventStore.outputEvent;
			let outputEvent: ScreenOutputEvent;
			try {
				outputEvent = await outputReads.event(scope);
			}
			catch (err) {
				if (flight.current)
					console.warn('Failed to re-read the Event context; keeping the last one:', err);
				return;
			}
			if (flight.stale)
				return;
			if (eventStore.outputEvent === heldBefore) {
				eventStore.setOutputEvent(outputEvent);
				return;
			}
		}
	}

	/**
	 * Re-read what a loaded rendering holds: its Screen, by the id it holds, and
	 * its Event context, both through that Screen with the credential it loaded
	 * with. Program keeps its last accepted rendering throughout — nothing is
	 * emptied, and loading and error are left alone — and a read that fails is
	 * simply not applied, so the next recovery tries again.
	 */
	async function recoverLoadedRendering(scope: ScreenOutputReadScope) {
		const flight = recoveries.begin();
		await Promise.allSettled([
			screenStore.refreshActiveScreen(scope.eventId, scope.screenId, scope.assetCapability),
			rereadOutputEvent(scope, flight),
		]);
	}

	let recoveryQueued = false;
	/**
	 * One recovery of the finished load for however many reasons arrive together:
	 * one attach can report a continuity loss and a first attach at once, and both
	 * the load's own listening and Reconnect Resync hear a loss once it is loaded.
	 */
	function queueRecovery() {
		if (recoveryQueued)
			return;
		recoveryQueued = true;
		queueMicrotask(() => {
			recoveryQueued = false;
			const loaded = loadedOn.value;
			if (loaded)
				void recoverLoadedRendering(loaded);
		});
	}

	/**
	 * Re-read authoritative state after this rendering has been out of touch.
	 *
	 * A Screen announcement carries no sequence number, so unlike a Broadcast
	 * Graphics notification it cannot tell a client it fell behind — and Ably drops
	 * message continuity after a couple of minutes suspended. An output that missed
	 * a mode change while away therefore renders the old mode indefinitely, on
	 * program, with nothing anywhere reporting it (#307). The same holds for an
	 * `event:updated` it missed: orientation, formatting, defaults and feature
	 * settings (#705).
	 *
	 * Three cases, by what this rendering holds:
	 *
	 * - A finished load: the non-blanking re-read of the Screen and its Event
	 *   context, because program must not flash while they are fetched.
	 * - A Screen but no finished load: resume the load from that Screen.
	 * - Nothing: the ordinary load, which has nothing on program to protect.
	 *
	 * The Screen is addressed by the id it holds, never by the route's slug: a
	 * rename under an output on program leaves that slug naming nothing (#705).
	 */
	function resyncActiveScreen() {
		const evtId = resolveEventId();
		if (!evtId)
			return;

		const held = screenStore.activeScreen;
		if (!held) {
			if (screenSlug.value)
				void loadActiveScreen(screenSlug.value);
			return;
		}

		const loaded = loadedOn.value;
		if (loaded?.screenId === held.id)
			queueRecovery();
		else
			void resumeLoad(readScope(evtId, held.id));
	}

	// A loaded rendering hears its Screen's announcements on the Event channel.
	// One not loaded listens on none — its Event context, which names the channel,
	// may be what failed — so the connection coming back retries it.
	useReconnectResync(resyncActiveScreen, () => loadedOn.value?.eventId ?? null, realtime);
	// Subscriptions that waited on a token missed what was published meanwhile,
	// and a first attach over an unbroken connection reports no continuity loss
	// (ADR-0023), exactly as the Realtime Event Session resyncs on it.
	watch(() => !!realtime.tokenError, (waiting, wasWaiting) => {
		if (wasWaiting && !waiting)
			resyncActiveScreen();
	});

	onMounted(async () => {
		await loadActiveScreen(screenSlug.value);
	});

	watch(screenSlug, async (newSlug) => {
		if (!newSlug)
			return;

		// Begin before stopping so anything the stop awaits past is already stale.
		// The load forgets the old one again; forgetting it here as well keeps a
		// recovery landing during the stop from applying to the Screen being left.
		const flight = loads.begin();
		forgetLoad();
		await screenRealtimeSession.stop();
		await loadActiveScreen(newSlug, flight);
	});

	onBeforeUnmount(async () => {
		loads.supersede();
		forgetLoad();
		stopListeningDuringLoad();
		await screenRealtimeSession.stop();
	});

	return {
		layoutName,
		loading,
		error,
		errorDetail,
		exportError,
		showIdentify,
		showDebug,
		identifyClass,
		debugPanelClass,
		debugInfo,
		screenContext,
		handleRefresh,
		handleIdentify,
		handleDebug,
		captureDownload,
		loadActiveScreen,
	};
}

export type ScreenDisplaySession = ReturnType<typeof useScreenDisplaySession>;
