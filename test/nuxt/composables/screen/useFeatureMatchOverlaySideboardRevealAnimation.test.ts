import type { EffectScope } from 'vue';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { GraphicsFeatureMatchContext } from '~/modules/graphics/renderModel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, ref } from 'vue';
import { createFeatureMatchLayoutComposition } from '~~/shared/featureMatchLayoutComposition';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { useFeatureMatchOverlaySideboardRevealAnimation } from '~/composables/screen/useFeatureMatchOverlaySideboardRevealAnimation';

const LINEAR = { duration: 400, easing: 'linear' as const, delay: 0 };

function overlayConfig(): FeatureMatchOverlayModeConfig {
	const deckList = Object.assign(
		getGraphicItemDefinition('deck-list').createDefault({
			id: 'side-1',
			label: 'side-1',
			canvasWidth: 1920,
			canvasHeight: 1080,
		}),
		{ animation: { enter: { ...LINEAR, fade: { opacity: 0 } }, exit: { ...LINEAR, fade: { opacity: 0 } } } },
	);
	return {
		layout: { composition: { ...createFeatureMatchLayoutComposition(), items: [deckList] } },
	} as unknown as FeatureMatchOverlayModeConfig;
}

function context(player1Revealed: boolean): GraphicsFeatureMatchContext {
	return {
		clockDisplayTime: '0:00',
		player1: { lifeTotal: null, gameWins: 0, sideboard: [], sideboardRevealed: player1Revealed },
		player2: { lifeTotal: null, gameWins: 0, sideboard: null, sideboardRevealed: false },
		bestOf: 3,
	};
}

describe('useFeatureMatchOverlaySideboardRevealAnimation', () => {
	let scope: EffectScope;
	let rafQueue: FrameRequestCallback[];
	let nowMs: number;

	beforeEach(() => {
		rafQueue = [];
		nowMs = 1000;
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			rafQueue.push(callback);
			return rafQueue.length;
		});
		vi.stubGlobal('cancelAnimationFrame', () => {});
		vi.spyOn(performance, 'now').mockImplementation(() => nowMs);
		scope = effectScope();
	});

	afterEach(() => {
		scope.stop();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	/** Advance the host clock and deliver the pending animation frames. */
	function tick(ms: number) {
		nowMs += ms;
		const pending = rafQueue;
		rafQueue = [];
		for (const callback of pending)
			callback(nowMs);
	}

	function mounted(initialRevealed = false) {
		const featureMatch = ref<GraphicsFeatureMatchContext | undefined>(context(initialRevealed));
		const config = ref(overlayConfig());
		const composable = scope.run(() =>
			useFeatureMatchOverlaySideboardRevealAnimation(config, featureMatch))!;
		return { featureMatch, ...composable };
	}

	it('plays the enter on the reveal edge, advancing on the animation-frame clock', () => {
		const { featureMatch, itemAnimation } = mounted(false);
		expect(itemAnimation.value).toBeUndefined();

		featureMatch.value = context(true);
		expect(itemAnimation.value).toEqual({ 'side-1': [{ phase: 'enter', elapsed: 0 }] });

		tick(250);
		expect(itemAnimation.value).toEqual({ 'side-1': [{ phase: 'enter', elapsed: 250 }] });
	});

	it('drops a settled trigger and stops projecting entirely', () => {
		const { featureMatch, itemAnimation } = mounted(true);

		featureMatch.value = context(false);
		tick(250);
		expect(itemAnimation.value).toEqual({ 'side-1': [{ phase: 'exit', elapsed: 250 }] });

		// Past delay + duration the trigger settles: the flag's renders-nothing
		// state takes over, and no animation frame stays scheduled for a quiet flag.
		tick(200);
		expect(itemAnimation.value).toBeUndefined();
		expect(rafQueue).toEqual([]);
	});

	it('plays nothing for the value it joins on, only for an edge it observed', () => {
		// A late-joining or recovered output resolves the settled state rather than
		// replaying the reveal — the composition-lifecycle recovery idiom.
		const { featureMatch, itemAnimation } = mounted(true);
		expect(itemAnimation.value).toBeUndefined();

		// The context object is re-created on every host-state change; an unchanged
		// flag inside it is not an edge.
		featureMatch.value = context(true);
		expect(itemAnimation.value).toBeUndefined();
	});

	it('treats crossing to or from an absent context as joining, not as an edge', () => {
		// The host hands this composable no context while a preview shows the
		// sample dataset. Switching data sources is not an operator's reveal, so a
		// flag that differs across the crossing plays nothing in either direction.
		const { featureMatch, itemAnimation } = mounted(true);

		featureMatch.value = undefined;
		expect(itemAnimation.value).toBeUndefined();

		featureMatch.value = context(false);
		expect(itemAnimation.value).toBeUndefined();
	});
});
