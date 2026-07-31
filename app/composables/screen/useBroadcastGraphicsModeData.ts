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
	 * The one instant every live projection below is read at, on the authoritative
	 * clock rather than this browser's.
	 *
	 * Declared here because what is on program, which values are showing, and where the
	 * motion is are all answers to the same question — "at *when*?" — and reading two of
	 * them at two instants is how an output composites a frame that never existed. The
	 * clock that advances it sits further down, beside the preview clock it parallels.
	 */
	const liveNow = ref(Date.now());

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
		// Timed, because an exiting Broadcast Graphic is still on program: it leaves the
		// frame when its exit phase completes, not when Out is accepted.
		return screenId ? sessionStore.onAirGraphicIds(screenId, graphics.value, liveNow.value) : [];
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
	 * The rendering each composed Broadcast Graphic draws, and the one an update phase
	 * is leaving behind.
	 *
	 * A live output contributes exactly what its Live Session says is on screen at this
	 * instant — never a working edit, and never a declared default standing in for a
	 * value no acceptance produced. That is not always the accepted set: an acceptance
	 * coalescing behind an entrance has been accepted without yet being shown.
	 *
	 * A preview contributes nothing and lets the compositor substitute authored defaults
	 * instead — the design as authored — which is why the two travel together.
	 */
	const renderedInputs = computed(() => {
		const screenId = screen.value?.id;
		if (isAuthoringPreview.value || !screenId)
			return { current: {} as Record<string, Record<string, GraphicInputValue>>, outgoing: {} };

		return sessionStore.renderedInputValues(screenId, graphics.value, liveNow.value);
	});

	const inputValues = computed<Record<string, Record<string, GraphicInputValue>>>(() => renderedInputs.value.current);
	const outgoingInputValues = computed(() => renderedInputs.value.outgoing);

	const selectedTarget = computed<GraphicsSelectionTarget>(() =>
		previewState.value?.selectedTarget ?? { type: 'canvas' },
	);

	/*
	 * The live playout clock.
	 *
	 * One reactive instant, on the authoritative clock rather than this browser's, and
	 * every frame of live animation is a pure projection of it. Nothing accumulates
	 * between frames — no playhead, no tween state — which is what makes a late-loading
	 * or reconnected output catch up to the current phase rather than replay it, and what
	 * makes two outputs agree without talking to each other.
	 *
	 * It runs only while something is actually moving. An on-screen Graphic Animation
	 * Recipe may cycle indefinitely, so "moving" cannot mean "a finite phase is
	 * running"; it means the Live Session has a projection to offer at all, which
	 * settles to nothing when every graphic is off or resting.
	 */
	let liveFrame: number | null = null;

	/** Whether the Live Session still has a phase to project at the current instant. */
	function hasLiveMotion(): boolean {
		const screenId = screen.value?.id;
		if (previewState.value || !screenId)
			return false;

		return Object.keys(sessionStore.animationProjection(screenId, graphics.value, liveNow.value)).length > 0;
	}

	function stopLiveClock() {
		if (liveFrame !== null && import.meta.client)
			cancelAnimationFrame(liveFrame);
		liveFrame = null;
	}

	function advanceLiveClock() {
		liveNow.value = sessionStore.serverNow();
		// Settled means settled: a broadcast machine must not be asked to wake up sixty
		// times a second to redraw a frame that cannot change. Leaving the instant where
		// it stopped is safe precisely because everything is at rest there — the same
		// saturation that lets a stale start time be read literally.
		if (!hasLiveMotion()) {
			stopLiveClock();
			return;
		}
		liveFrame = requestAnimationFrame(advanceLiveClock);
	}

	function startLiveClock() {
		if (!import.meta.client || previewState.value)
			return;
		liveNow.value = sessionStore.serverNow();
		if (liveFrame === null)
			liveFrame = requestAnimationFrame(advanceLiveClock);
	}

	// Every accepted command reaches this client as a new snapshot, and a new snapshot is
	// the only thing that can start a phase — so that is what restarts the clock.
	watch(
		() => {
			const screenId = screen.value?.id;
			const session = screenId ? sessionStore.sessions.get(screenId) : undefined;
			return session ? `${session.id}:${session.sequence}` : null;
		},
		() => startLiveClock(),
		{ immediate: true },
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
		if (plan) {
			const position = graphicAnimationTimelineAt(previewTimeline.value, previewElapsed.value);
			return position ? { [plan.graphicId]: position } : {};
		}

		const screenId = screen.value?.id;
		if (previewState.value || !screenId)
			return {};

		// Live playout: every phase derived from the Live Session's own authoritative
		// effective start times, read on the authoritative clock. Nothing here is
		// accumulated between frames, so an output that opens late, reloads, or
		// reconnects catches up to the current phase instead of replaying it.
		return sessionStore.animationProjection(screenId, graphics.value, liveNow.value);
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
		stopLiveClock();
	});

	return {
		animationProjection,
		graphics,
		onAirGraphicIds,
		inputValues,
		outgoingInputValues,
		isAuthoringPreview,
		selectedTarget,
		publishSelection,
	};
}
