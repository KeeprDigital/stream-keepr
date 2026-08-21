import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { ScreenCardDataHealth, ScreenPresenceData } from '~/types/screen';
import { useIntervalFn } from '@vueuse/core';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import {
	parseScreenEmbed,
	parseScreenOutput,
	screenOutputAssetCapabilityFromHash,
	screenOutputBackground,
} from '~~/shared/utils/screenOutput';
import { useRoute } from '#app';
import { useRealtime } from '~/composables/core/useRealtime';
import { useReconnectResync } from '~/composables/core/useReconnectResync';
import { useScreenRealtimeSession } from '~/composables/screen/useScreenRealtimeSession';
import { getScreenModeDisplayType, isControlScreenMode } from '~/modules/screen-mode';
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
	createRealtimeSession?: (options: Parameters<typeof useScreenRealtimeSession>[0]) => ScreenRealtimeDisplaySession;
	exportAdapter?: Partial<ScreenDisplaySessionExportAdapter>;
}

const defaultExportAdapter: ScreenDisplaySessionExportAdapter = {
	exportElementPng,
	buildFilename: buildFeatureMatchOverlayExportFilename,
	closeWindow: () => window.close(),
};

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
	 * correctly and reports nothing: it is absent from its Screen's connected count,
	 * from the Open Screen Output Engines, and from the asset-access warning. That is
	 * a worse silence than the guides one, since those three surfaces exist precisely
	 * to state what the outputs watching right now cost. It is accepted on the same
	 * ground — no URL this application produces sets the role, and every surface that
	 * hands an operator an output URL goes through `useScreenOutputAccessUrl`, which
	 * asks for no role at all.
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
	const error = ref<string | null>(null);
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
			userAgent: navigator.userAgent,
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
		if (!shouldDownload.value || !screenStore.activeScreen || !overlayContainer.value)
			return;

		await nextTick();

		const width = screenStore.activeScreen.screenConfig?.width ?? overlayContainer.value.offsetWidth;
		const height = screenStore.activeScreen.screenConfig?.height ?? overlayContainer.value.offsetHeight;
		const output = outputMode.value;

		try {
			await exportAdapter.exportElementPng(overlayContainer.value, {
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

	async function loadActiveScreen(slug: string, flight = loads.begin()) {
		const evtId = resolveEventId();

		loading.value = true;
		error.value = null;
		exportError.value = null;

		if (!evtId) {
			if (flight.current) {
				error.value = 'Event not found';
				loading.value = false;
			}
			return;
		}

		try {
			// The capability is this output's credential for the lookup itself since
			// #397, not only for the media it later resolves. An `embed=preview`
			// surface has none and is admitted by its operator's session instead.
			const loadedScreen = await screenStore.loadScreenBySlug(evtId, slug, assetCapability.value);
			if (flight.stale)
				return;
			if (!loadedScreen || screenStore.activeScreen?.id !== loadedScreen.id)
				throw new Error('Screen not found');

			// Only a Screen Output joins its Screen's presence and answers its Screen's
			// commands. An embedded rendering of either kind is a control surface's own
			// view — counting it would report the operator's own window back to them as
			// a client watching, and an Identify meant to locate a display in a venue
			// would flash the one screen they are already looking at.
			if (!embed.value) {
				await screenRealtimeSession.start(evtId, loadedScreen.id);
			}
			if (flight.stale)
				return;

			loading.value = false;
			await captureDownload();
		}
		catch (err) {
			if (flight.stale)
				return;
			console.error('Failed to load screen:', err);
			error.value = 'Screen not found';
			loading.value = false;
		}
	}

	/**
	 * Re-read authoritative Screen state after this output has been out of touch.
	 *
	 * A Screen announcement carries no sequence number, so unlike a Broadcast
	 * Graphics notification it cannot tell a client it fell behind — and Ably drops
	 * message continuity after a couple of minutes suspended. An output that missed
	 * a mode change while away therefore renders the old mode indefinitely, on
	 * program, with nothing anywhere reporting it (#307).
	 *
	 * An output already rendering takes the non-blanking read, because program must
	 * not flash while the Screen is fetched. One showing nothing has nothing to
	 * protect and takes the ordinary load, which is also the one that starts the
	 * realtime session it never got.
	 */
	function resyncActiveScreen() {
		const slug = screenSlug.value;
		const evtId = resolveEventId();
		if (!slug || !evtId)
			return;

		if (!screenStore.activeScreen) {
			void loadActiveScreen(slug);
			return;
		}
		void screenStore.refreshActiveScreen(evtId, slug, assetCapability.value);
	}

	useReconnectResync(resyncActiveScreen, realtime);

	onMounted(async () => {
		await loadActiveScreen(screenSlug.value);
	});

	watch(screenSlug, async (newSlug) => {
		if (!newSlug)
			return;

		// Begin before stopping so anything the stop awaits past is already stale.
		const flight = loads.begin();
		await screenRealtimeSession.stop();
		await loadActiveScreen(newSlug, flight);
	});

	onBeforeUnmount(async () => {
		loads.supersede();
		await screenRealtimeSession.stop();
	});

	return {
		layoutName,
		loading,
		error,
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
