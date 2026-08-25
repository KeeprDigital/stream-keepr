import type { Ref } from 'vue';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { SideboardRevealTrigger } from '~/modules/feature-match-overlay/sideboardRevealTrigger';
import type { GraphicsFeatureMatchContext } from '~/modules/graphics/renderModel';
import {
	applySideboardRevealEdge,
	settleSideboardRevealTriggers,
	sideboardRevealItemAnimation,
} from '~/modules/feature-match-overlay/sideboardRevealTrigger';

const PLAYER_SIDES = ['player1', 'player2'] as const;

/**
 * The per-item reveal trigger's host half (#492): watches each side's
 * `sideboardRevealed` in the resolved Feature Match context and, on an edge,
 * plays the authored `enter`/`exit` recipes of that side's Deck List Graphic
 * Items by projecting them into the compositor's per-item animation input.
 * Which items an edge reaches, how edges supersede, and when a trigger settles
 * are the pure module's; this owns the two things a pure function cannot —
 * seeing the edge, and a clock.
 *
 * Edge-triggered, never level-triggered: only a flip this client observed
 * animates. The value an output joins on — first load, reload, a reconnect
 * that replays state — resolves the settled frame, the same recovery idiom the
 * composition-lifecycle phases follow. A client whose connection was suspended
 * across the flip therefore plays the motion late rather than never, which on
 * air reads as the reveal arriving, not as a defect.
 *
 * The edge watch is `sync` so the trigger lands in the same flush as the flag:
 * a reveal's first rendered frame is then already under its enter's start —
 * hidden, for a fade-in — rather than flashing the settled item for one frame.
 *
 * The clock is this client's own `requestAnimationFrame` on `performance.now`,
 * not an authoritative effective start time: the flag lands at each output
 * within realtime-transport skew of the others, the recipes are sub-second, and
 * the Host Contract deliberately carries no animation timing (#480 scope
 * guard). The loop runs only while a trigger does — a quiet flag schedules no
 * frames — and each frame drops what settled, so the projection ends by
 * becoming `undefined`: exactly the compositor input an unanimated overlay
 * passes.
 */
export function useFeatureMatchOverlaySideboardRevealAnimation(
	config: Ref<FeatureMatchOverlayModeConfig>,
	featureMatch: Ref<GraphicsFeatureMatchContext | undefined>,
) {
	const triggers = ref<SideboardRevealTrigger[]>([]);
	const now = ref(0);
	let frame: number | null = null;

	function advanceClock() {
		now.value = performance.now();
		triggers.value = settleSideboardRevealTriggers(triggers.value, now.value);
		frame = triggers.value.length > 0 ? requestAnimationFrame(advanceClock) : null;
	}

	for (const side of PLAYER_SIDES) {
		watch(
			() => featureMatch.value?.[side].sideboardRevealed,
			(revealed, previous) => {
				// `previous === undefined` is the joining case, not an edge: the
				// context arriving is this client first seeing the value.
				if (!import.meta.client || revealed === undefined || previous === undefined)
					return;

				now.value = performance.now();
				triggers.value = applySideboardRevealEdge(
					triggers.value,
					config.value.layout.composition,
					side,
					revealed,
					now.value,
				);
				if (triggers.value.length > 0 && frame === null)
					frame = requestAnimationFrame(advanceClock);
			},
			{ flush: 'sync' },
		);
	}

	onScopeDispose(() => {
		if (frame !== null && import.meta.client)
			cancelAnimationFrame(frame);
		frame = null;
	});

	return {
		/** The compositor's per-item animation input; `undefined` while nothing plays. */
		itemAnimation: computed(() => sideboardRevealItemAnimation(triggers.value, now.value)),
	};
}
