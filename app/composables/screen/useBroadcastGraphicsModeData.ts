import type { BroadcastGraphicConfig, GraphicInputValue } from '~~/shared/types/graphics';
import type { GraphicsPreviewState } from '~/modules/graphics/previewMessages';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	GRAPHICS_PREVIEW_SELECT_MESSAGE,
	isGraphicsPreviewStateMessage,
} from '~/modules/graphics/previewMessages';

/**
 * What a Broadcast Graphics Screen Output renders.
 *
 * A live output composes the Screen's persisted stack, and its Broadcast
 * Graphics Live Session decides which of them are on air. The session snapshot
 * is loaded authoritatively rather than accumulated from realtime messages, so
 * an output that loads late, reloads, or reconnects catches up to the current
 * authoritative state instead of replaying how it got there.
 *
 * An embedded editor preview instead composes the working stack the editor
 * pushes in, showing the Broadcast Graphic being authored without touching live
 * Screen state.
 */
export function useBroadcastGraphicsModeData() {
	const { eventId, isPreview, screen } = useScreenContext();
	const storedConfig = useScreenModeConfig('broadcast-graphics');
	const sessionStore = useBroadcastGraphicsLiveSessionStore();
	const previewState = ref<GraphicsPreviewState | null>(null);

	const graphics = computed<readonly BroadcastGraphicConfig[]>(() =>
		previewState.value?.graphics ?? storedConfig.value.graphics ?? [],
	);

	/**
	 * An editor preview composes the whole authored stack, exactly as an on-air
	 * Screen would, so the authored Graphic Layer Order and any reordering of it
	 * are visible while authoring. A live output composes only what playout has
	 * taken on air, always in the Screen's authored stack order.
	 */
	const onAirGraphicIds = computed<readonly string[]>(() => {
		if (previewState.value)
			return previewState.value.graphics.map(graphic => graphic.id);

		const screenId = screen.value?.id;
		return screenId ? sessionStore.onAirGraphicIds(screenId, graphics.value) : [];
	});

	/**
	 * Whether this is an authoring preview rather than a live output.
	 *
	 * The distinction decides what an unset Graphic Input renders, so it is named once
	 * and both `inputValues` and the compositor read the same answer. A preview has no
	 * Live Session to accept anything and shows the design as authored; a live output
	 * shows only what an acceptance produced.
	 */
	const isAuthoringPreview = computed(() => previewState.value !== null || !screen.value?.id);

	/**
	 * The accepted on-air Graphic Input values each composed Broadcast Graphic
	 * renders.
	 *
	 * A live output contributes exactly what its Live Session has accepted — never a
	 * working edit, and never a declared default standing in for a value no acceptance
	 * produced. A preview contributes nothing and lets the compositor substitute
	 * authored defaults instead, which is why the two travel together.
	 */
	const inputValues = computed<Record<string, Record<string, GraphicInputValue>>>(() => {
		const screenId = screen.value?.id;
		if (isAuthoringPreview.value || !screenId)
			return {};

		return Object.fromEntries(graphics.value.map(graphic => [
			graphic.id,
			sessionStore.acceptedInputValues(screenId, graphic),
		]));
	});

	const selectedTarget = computed<GraphicsSelectionTarget>(() =>
		previewState.value?.selectedTarget ?? { type: 'canvas' },
	);

	function handlePreviewStateMessage(message: MessageEvent) {
		if (!isPreview?.value)
			return;
		if (!isGraphicsPreviewStateMessage(message, { origin: window.location.origin, source: window.parent }))
			return;

		previewState.value = message.data.state;
	}

	/** Report a canvas selection back to the editor that embedded this preview. */
	function publishSelection(target: GraphicsSelectionTarget) {
		if (!isPreview?.value || !import.meta.client)
			return;

		window.parent?.postMessage({ type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target }, window.location.origin);
	}

	// A preview has no Live Session of its own: it renders the working stack, so
	// asking for playout would open an epoch the author never took anything on.
	watch(
		() => [eventId.value, screen.value?.id, isPreview?.value ?? false] as const,
		([evtId, screenId, preview]) => {
			if (preview || !evtId || !screenId)
				return;
			void sessionStore.loadSession(evtId, screenId);
		},
		{ immediate: true },
	);

	onMounted(() => {
		window.addEventListener('message', handlePreviewStateMessage);
	});

	onBeforeUnmount(() => {
		window.removeEventListener('message', handlePreviewStateMessage);
	});

	return {
		graphics,
		onAirGraphicIds,
		inputValues,
		isAuthoringPreview,
		selectedTarget,
		publishSelection,
	};
}
