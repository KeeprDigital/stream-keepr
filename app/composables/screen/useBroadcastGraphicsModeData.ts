import type { BroadcastGraphicConfig, GraphicInputValue } from '~~/shared/types/graphics';
import type { GraphicsPreviewState } from '~/modules/graphics/previewMessages';
import type { GraphicsAnimationProjection } from '~/modules/graphics/renderModel';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	broadcastGraphicAnimationTimeline,
	graphicAnimationTimelineAt,
	graphicAnimationTimelineDurationMs,
} from '~~/shared/modules/graphics';
import { GRAPHIC_ANIMATION_PHASE_VALUES } from '~~/shared/types/graphics';
import {
	GRAPHICS_PREVIEW_SELECT_MESSAGE,
	isGraphicsPreviewStateMessage,
	readGraphicsPreviewState,
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
	 * The accepted on-air Graphic Input values each composed Broadcast Graphic
	 * renders.
	 *
	 * A preview has no Live Session, so it contributes nothing here and the
	 * compositor falls back to each graphic's declared defaults — the design as
	 * authored. A live output contributes what its Live Session has accepted, so
	 * program shows accepted values and never a working edit.
	 */
	const inputValues = computed<Record<string, Record<string, GraphicInputValue>>>(() => {
		const screenId = screen.value?.id;
		if (previewState.value || !screenId)
			return {};

		return Object.fromEntries(graphics.value.map(graphic => [
			graphic.id,
			sessionStore.acceptedInputValues(screenId, graphic),
		]));
	});

	const selectedTarget = computed<GraphicsSelectionTarget>(() =>
		previewState.value?.selectedTarget ?? { type: 'canvas' },
	);

	/*
	 * Graphic Animation Preview.
	 *
	 * The editor sends a plan; the clock lives here, beside the composition it
	 * animates. Elapsed time is the only thing that advances, and the frame is a
	 * pure projection of it, so a run is repeatable and identical at the same
	 * elapsed time however it was reached.
	 *
	 * A live output reaches none of this: it has no preview plan, so its projection
	 * stays empty until #70 derives one from the Live Session's own authoritative
	 * effective start times. Preview and live therefore share the projection and
	 * share nothing else — the preview never opens a session, never accepts an
	 * input, and never writes Screen state.
	 */
	const previewElapsed = ref(0);
	const previewPlan = computed(() => previewState.value?.animation ?? null);

	const previewTimeline = computed(() => {
		const plan = previewPlan.value;
		if (!plan)
			return [];
		const graphic = graphics.value.find(entry => entry.id === plan.graphicId);
		if (!graphic)
			return [];

		const phases = plan.scope === 'phase'
			? [plan.phase]
			: GRAPHIC_ANIMATION_PHASE_VALUES.slice(GRAPHIC_ANIMATION_PHASE_VALUES.indexOf(plan.phase));
		return broadcastGraphicAnimationTimeline(graphic, phases);
	});

	const animationProjection = computed<Record<string, GraphicsAnimationProjection>>(() => {
		const plan = previewPlan.value;
		if (!plan)
			return {};
		const position = graphicAnimationTimelineAt(previewTimeline.value, previewElapsed.value);
		return position ? { [plan.graphicId]: position } : {};
	});

	let frame: number | null = null;
	let startedAt = 0;

	function stopPreviewClock() {
		if (frame !== null && import.meta.client)
			cancelAnimationFrame(frame);
		frame = null;
	}

	function advancePreviewClock() {
		const plan = previewPlan.value;
		if (!plan) {
			stopPreviewClock();
			previewElapsed.value = 0;
			return;
		}

		const total = graphicAnimationTimelineDurationMs(previewTimeline.value);
		const elapsed = (performance.now() - startedAt) * plan.speed;

		if (total > 0 && elapsed >= total && plan.loop) {
			startedAt = performance.now();
			previewElapsed.value = 0;
		}
		else {
			// Held rather than reset once a run completes: the last phase settled is
			// what the author just watched arrive.
			previewElapsed.value = elapsed;
		}

		frame = requestAnimationFrame(advancePreviewClock);
	}

	// A new run token restarts the clock; that is the only thing that does. Editing
	// the composition mid-run changes what is projected without disturbing when.
	watch(
		() => (previewPlan.value ? `${previewPlan.value.graphicId}:${previewPlan.value.run}` : null),
		(token) => {
			stopPreviewClock();
			previewElapsed.value = 0;
			if (token === null || !import.meta.client)
				return;
			startedAt = performance.now();
			frame = requestAnimationFrame(advancePreviewClock);
		},
	);

	function handlePreviewStateMessage(message: MessageEvent) {
		if (!isPreview?.value)
			return;
		if (!isGraphicsPreviewStateMessage(message, { origin: window.location.origin, source: window.parent }))
			return;

		previewState.value = readGraphicsPreviewState(message.data.state);
	}

	/** Report a canvas selection back to the editor that embedded this preview. */
	function publishSelection(target: GraphicsSelectionTarget) {
		if (!isPreview?.value || !import.meta.client)
			return;

		window.parent?.postMessage({ type: GRAPHICS_PREVIEW_SELECT_MESSAGE, target }, window.location.origin);
	}

	// A preview has no Live Session of its own: it renders the working stack, so
	// asking for playout would open an epoch the author never took anything on.
	//
	// A live output loads the authoritative snapshot and reloads it whenever it has
	// been out of touch, which is what lets a late-loading or reconnected output
	// catch up to the current authoritative state rather than replaying how it got
	// there. It never clears on a disconnection: program holds its last accepted
	// rendering.
	useBroadcastGraphicsLiveSessionSync(
		() => (isPreview?.value ? undefined : eventId.value ?? undefined),
		() => (isPreview?.value ? undefined : screen.value?.id),
	);

	onMounted(() => {
		window.addEventListener('message', handlePreviewStateMessage);
	});

	onBeforeUnmount(() => {
		window.removeEventListener('message', handlePreviewStateMessage);
		stopPreviewClock();
	});

	return { animationProjection, graphics, onAirGraphicIds, inputValues, selectedTarget, publishSelection };
}
