import type { RouteLocationNormalizedLoaded } from 'vue-router';
import type { ScreenOutput } from '~~/shared/types/screenConfig';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { ScreenPresenceData } from '~/types/screen';
import { useIntervalFn } from '@vueuse/core';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import { parseScreenOutput, screenOutputBackground } from '~~/shared/utils/screenOutput';
import { useRoute } from '#app';
import { useRealtime } from '~/composables/core/useRealtime';
import { useScreenRealtimeSession } from '~/composables/screen/useScreenRealtimeSession';
import { getScreenModeDisplayType, isControlScreenMode } from '~/modules/screen-mode';
import { useEventStore } from '~/stores/event';
import { useScreenStore } from '~/stores/screen';
import { buildFeatureMatchOverlayExportFilename, exportElementPng } from '~/utils/exportElementPng';
import { createGuardedSequence } from '~/utils/guardedSequence';

interface ScreenRealtimeDisplaySession {
	start: (eventId: number, screenId: number) => Promise<void>;
	stop: () => Promise<void>;
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

function screenOutputAssetCapability(hash: string): string | null {
	const value = new URLSearchParams(hash.replace(/^#/, ''))
		.get('asset-capability');
	return value && /^[\w-]{20,200}$/.test(value) ? value : null;
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
	const fitToViewport = computed(() => route.query.fit === '1');
	const isPreview = computed(() => route.query.preview === '1');
	/*
	 * Editor-only guides require the preview flag as well as their own, so an
	 * ordinary Screen Output URL draws none.
	 *
	 * That is a structural barrier rather than a convention, because the preview flag
	 * is not a decoration a live output could wear — it selects a rendering that
	 * cannot be a live one. A preview never starts the Screen realtime session
	 * (below), so it never joins its Screen's channel, never receives a take, and
	 * never catches up to the authoritative phase; it resolves Graphic Asset content
	 * through the author-session library path rather than the Screen Output Asset
	 * Capability, so without an author session it shows no media at all; and its
	 * Overlay Output draws a checkerboard where the transparency belongs.
	 *
	 * So a deliberately constructed `preview=1&guides=1` URL pointed at a broadcast
	 * source does not produce a live Screen Output with guides over it. It produces
	 * an editor preview, missing the show, and the guides are the least visible thing
	 * wrong with it. Gating guides on something a URL cannot carry — a handshake with
	 * the embedding editor, say — would add a race on every preview load to remove a
	 * risk that already fails louder than the guides ever could (issue #134).
	 */
	const previewGuides = computed(() => isPreview.value && route.query.guides === '1');
	const previewSafeAreas = computed(() => isPreview.value && route.query.safe === '1');
	const assetCapability = computed(() => screenOutputAssetCapability(route.hash ?? ''));

	const isControlScreen = computed(() => {
		const mode = screenStore.activeScreen?.currentMode;
		return mode ? isControlScreenMode(mode) : false;
	});
	const layoutName = computed(() => isControlScreen.value ? 'screen-control' : 'screen');

	const activeScreen = toRef(screenStore, 'activeScreen');
	const interactiveRef = ref(false);
	const overlayContainer = ref<HTMLElement | null>(null);
	const screenContext: ScreenContext = {
		screen: activeScreen,
		eventId,
		interactive: interactiveRef,
		overlayContainer,
		outputMode,
		outputWarning,
		fitToViewport,
		isPreview,
		previewGuides,
		previewSafeAreas,
		assetCapability,
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
		}),
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
			const loadedScreen = await screenStore.loadScreenBySlug(evtId, slug);
			if (flight.stale)
				return;
			if (!loadedScreen || screenStore.activeScreen?.id !== loadedScreen.id)
				throw new Error('Screen not found');

			if (!isPreview.value) {
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
