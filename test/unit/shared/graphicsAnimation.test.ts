import type {
	BroadcastGraphicConfig,
	GraphicAnimationRecipe,
	GraphicGroupItemConfig,
	GraphicItemConfig,
} from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	broadcastGraphicAnimationTimeline,
	broadcastGraphicHasPhaseAnimation,
	broadcastGraphicOnScreenRunMs,
	broadcastGraphicPhaseDurationMs,
	createDefaultGraphicAnimationRecipe,
	getGraphicAnimationPreset,
	GRAPHIC_ANIMATION_ORIGINS,
	GRAPHIC_ANIMATION_PRESETS,
	GRAPHIC_SLIDE_DIRECTIONS,
	graphicAnimationEasedProgress,
	graphicAnimationPresetsForPhase,
	graphicAnimationRecipeEndMs,
	graphicAnimationStaggerOffset,
	graphicAnimationTimelineAt,
	graphicAnimationTimelineDurationMs,
	graphicOnScreenCycleMs,
	resolveGraphicAnimationOrigin,
	resolveGraphicSlideDirection,
} from '~~/shared/modules/graphics';
import {
	GRAPHIC_ANIMATION_EASING_VALUES,
	GRAPHIC_ANIMATION_ORIGIN_VALUES,
	GRAPHIC_ANIMATION_PHASE_VALUES,
	GRAPHIC_REVEAL_EDGE_VALUES,
	GRAPHIC_SLIDE_DIRECTION_VALUES,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
} from '~~/shared/types/graphics';

const SQUARE = { treatment: 'square' as const, size: 0 };
const GEOMETRY = {
	topLeft: SQUARE,
	topRight: SQUARE,
	bottomRight: SQUARE,
	bottomLeft: SQUARE,
	leftSlant: 0,
	rightSlant: 0,
};

function recipe(overrides: Partial<GraphicAnimationRecipe> = {}): GraphicAnimationRecipe {
	return { duration: 400, easing: 'linear', delay: 0, ...overrides };
}

function shape(id: string, overrides: Partial<GraphicItemConfig> = {}): GraphicItemConfig {
	return {
		type: 'shape',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 100,
		height: 50,
		geometry: GEOMETRY,
		...overrides,
	} as GraphicItemConfig;
}

function group(id: string, children: GraphicItemConfig[], overrides: Partial<GraphicGroupItemConfig> = {}): GraphicItemConfig {
	return {
		type: 'group',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 400,
		height: 200,
		arrangement: 'row',
		padding: 0,
		gap: 0,
		align: 'stretch',
		justify: 'start',
		clip: false,
		geometry: GEOMETRY,
		children: children as GraphicGroupItemConfig['children'],
		...overrides,
	} as GraphicItemConfig;
}

function graphic(items: GraphicItemConfig[], animation?: BroadcastGraphicConfig['animation']): BroadcastGraphicConfig {
	return { id: 'lower-third', name: 'Lower third', items, animation };
}

describe('graphicAnimationEasedProgress', () => {
	it('starts at zero and lands exactly on one for every bounded easing', () => {
		// A recipe has to land on its owner's Graphic Resting State, not near it.
		for (const easing of GRAPHIC_ANIMATION_EASING_VALUES) {
			expect(graphicAnimationEasedProgress(easing, 0)).toBeCloseTo(0, 10);
			expect(graphicAnimationEasedProgress(easing, 1)).toBeCloseTo(1, 10);
		}
	});

	it('clamps progress outside zero to one, so a stale elapsed time cannot overshoot', () => {
		for (const easing of GRAPHIC_ANIMATION_EASING_VALUES) {
			expect(graphicAnimationEasedProgress(easing, -5)).toBeCloseTo(0, 10);
			expect(graphicAnimationEasedProgress(easing, 9999)).toBeCloseTo(1, 10);
			expect(graphicAnimationEasedProgress(easing, Number.NaN)).toBeCloseTo(0, 10);
		}
	});

	it('eases in below linear and out above it', () => {
		expect(graphicAnimationEasedProgress('ease-in', 0.5)).toBeLessThan(0.5);
		expect(graphicAnimationEasedProgress('ease-out', 0.5)).toBeGreaterThan(0.5);
		expect(graphicAnimationEasedProgress('linear', 0.5)).toBe(0.5);
		expect(graphicAnimationEasedProgress('ease-in-out', 0.5)).toBeCloseTo(0.5, 10);
	});

	it('lets a back easing overshoot the range mid-travel, which is the point of it', () => {
		expect(graphicAnimationEasedProgress('back-in', 0.2)).toBeLessThan(0);
		expect(graphicAnimationEasedProgress('back-out', 0.8)).toBeGreaterThan(1);
	});
});

describe('graphic animation vocabulary', () => {
	it('offers exactly nine Graphic Animation Origins, independent of the Graphic Anchor Point', () => {
		expect(GRAPHIC_ANIMATION_ORIGINS.map(origin => origin.value)).toEqual([...GRAPHIC_ANIMATION_ORIGIN_VALUES]);
		expect(GRAPHIC_ANIMATION_ORIGINS).toHaveLength(9);
	});

	it('defaults a scale channel origin to centre', () => {
		expect(resolveGraphicAnimationOrigin(undefined)).toMatchObject({ value: 'center', x: 0.5, y: 0.5 });
		expect(resolveGraphicAnimationOrigin('bottom-right')).toMatchObject({ x: 1, y: 1 });
	});

	it('offers exactly eight compass slide directions as canvas unit steps', () => {
		expect(GRAPHIC_SLIDE_DIRECTIONS.map(direction => direction.value)).toEqual([...GRAPHIC_SLIDE_DIRECTION_VALUES]);
		expect(GRAPHIC_SLIDE_DIRECTIONS).toHaveLength(8);
		expect(resolveGraphicSlideDirection('north')).toMatchObject({ x: 0, y: -1 });
		expect(resolveGraphicSlideDirection('south-east')).toMatchObject({ x: 1, y: 1 });
	});

	it('wipes a reveal channel from one of four edges', () => {
		expect([...GRAPHIC_REVEAL_EDGE_VALUES]).toEqual(['left', 'right', 'top', 'bottom']);
	});

	it('names the four lifecycle phases a recipe may be authored for', () => {
		expect([...GRAPHIC_ANIMATION_PHASE_VALUES]).toEqual(['enter', 'on-screen', 'update', 'exit']);
	});
});

describe('graphicAnimationStaggerOffset', () => {
	const direct = ['a', 'b', 'c', 'd'];

	it('adds ordered offsets in list order to the selected subset only', () => {
		const stagger = { order: 'list' as const, step: 100, itemIds: ['a', 'c'] };

		expect(graphicAnimationStaggerOffset(stagger, direct, 'a')).toBe(0);
		expect(graphicAnimationStaggerOffset(stagger, direct, 'c')).toBe(100);
		// Unselected siblings neither receive an offset nor consume a step.
		expect(graphicAnimationStaggerOffset(stagger, direct, 'b')).toBe(0);
		expect(graphicAnimationStaggerOffset(stagger, direct, 'd')).toBe(0);
	});

	it('reverses the walk in reverse-list order, which is how an exit reverses an entrance', () => {
		const forward = { order: 'list' as const, step: 100, itemIds: direct };
		const reverse = { order: 'reverse-list' as const, step: 100, itemIds: direct };

		expect(direct.map(id => graphicAnimationStaggerOffset(forward, direct, id))).toEqual([0, 100, 200, 300]);
		expect(direct.map(id => graphicAnimationStaggerOffset(reverse, direct, id))).toEqual([300, 200, 100, 0]);
	});

	it('ignores an id that no longer names a direct Graphic Item without leaving a gap', () => {
		const stagger = { order: 'list' as const, step: 50, itemIds: ['a', 'deleted', 'c'] };

		expect(graphicAnimationStaggerOffset(stagger, direct, 'a')).toBe(0);
		expect(graphicAnimationStaggerOffset(stagger, direct, 'c')).toBe(50);
		expect(graphicAnimationStaggerOffset(stagger, direct, 'deleted')).toBe(0);
	});

	it('offsets nothing without a stagger', () => {
		expect(graphicAnimationStaggerOffset(undefined, direct, 'a')).toBe(0);
	});
});

describe('broadcastGraphicPhaseDurationMs', () => {
	it('completes a phase immediately when nothing is authored for it', () => {
		// A missing recipe makes its owner change immediately, which is the same
		// arithmetic Cut relies on rather than a special case beside it.
		for (const phase of GRAPHIC_ANIMATION_PHASE_VALUES)
			expect(broadcastGraphicPhaseDurationMs(graphic([shape('bar')]), phase)).toBe(0);
	});

	it('completes a finite phase after its latest delayed recipe completes', () => {
		const composition = graphic(
			[
				shape('bar', { animation: { enter: recipe({ duration: 400 }) } }),
				shape('name', { animation: { enter: recipe({ duration: 300, delay: 600 }) } }),
			],
			{ enter: recipe({ duration: 200 }) },
		);

		expect(broadcastGraphicPhaseDurationMs(composition, 'enter')).toBe(900);
	});

	it('measures every delay from one shared phase start, never from another recipe', () => {
		// Two 400ms recipes, one delayed 400ms: sequential chaining would give 1200.
		const composition = graphic([
			shape('a', { animation: { enter: recipe({ duration: 400 }) } }),
			shape('b', { animation: { enter: recipe({ duration: 400, delay: 400 }) } }),
		]);

		expect(broadcastGraphicPhaseDurationMs(composition, 'enter')).toBe(800);
	});

	it('adds a stagger offset on top of each item own delay', () => {
		const composition = graphic(
			[
				shape('a', { animation: { enter: recipe({ duration: 200, delay: 100 }) } }),
				shape('b', { animation: { enter: recipe({ duration: 200, delay: 100 }) } }),
				shape('c', { animation: { enter: recipe({ duration: 200, delay: 100 }) } }),
			],
			{ stagger: { enter: { order: 'list', step: 150, itemIds: ['a', 'b', 'c'] } } },
		);

		// The last staggered item: 100 delay + 300 offset + 200 duration.
		expect(broadcastGraphicPhaseDurationMs(composition, 'enter')).toBe(600);
	});

	it('counts a Graphic Group child staggered by its group, on top of the group own offset', () => {
		const composition = graphic(
			[
				shape('bed'),
				group(
					'cluster',
					[
						shape('one', { animation: { enter: recipe({ duration: 100 }) } }),
						shape('two', { animation: { enter: recipe({ duration: 100 }) } }),
					],
					{ animation: { stagger: { enter: { order: 'list', step: 50, itemIds: ['one', 'two'] } } } },
				),
			],
			{ stagger: { enter: { order: 'list', step: 1000, itemIds: ['bed', 'cluster'] } } },
		);

		// `cluster` is second in the graphic stagger (1000), `two` second in its
		// group's (50), plus its own 100ms duration.
		expect(broadcastGraphicPhaseDurationMs(composition, 'enter')).toBe(1150);
	});

	it('never lets an on-screen recipe gate a lifecycle phase, indefinite or not', () => {
		const indefinite = graphic([], {
			'on-screen': { duration: 2000, easing: 'linear', delay: 0, pause: 500, repeat: 'indefinite' },
		});
		const finite = graphic([], {
			'on-screen': { duration: 2000, easing: 'linear', delay: 0, pause: 500, repeat: 3 },
		});

		expect(broadcastGraphicPhaseDurationMs(indefinite, 'on-screen')).toBe(0);
		expect(broadcastGraphicPhaseDurationMs(finite, 'on-screen')).toBe(0);
	});

	it('reports whether a phase has any authored recipe at all', () => {
		const bare = graphic([shape('bar')]);
		const withChild = graphic([group('cluster', [shape('one', { animation: { exit: recipe() } })])]);

		expect(broadcastGraphicHasPhaseAnimation(bare, 'enter')).toBe(false);
		expect(broadcastGraphicHasPhaseAnimation(withChild, 'exit')).toBe(true);
		expect(broadcastGraphicHasPhaseAnimation(withChild, 'enter')).toBe(false);
	});
});

describe('on-screen recipe timing', () => {
	it('counts one out-and-back cycle plus its pause', () => {
		expect(graphicOnScreenCycleMs({
			duration: 1600,
			easing: 'ease-in-out',
			delay: 0,
			pause: 400,
			repeat: 'indefinite',
		})).toBe(2000);
	});

	it('ends a plain recipe at its delay plus stagger plus duration', () => {
		expect(graphicAnimationRecipeEndMs(recipe({ duration: 400, delay: 100 }), 250)).toBe(750);
	});
});

describe('graphic animation presets', () => {
	it('initialises an editable recipe and records nothing about the preset used', () => {
		const preset = getGraphicAnimationPreset('slide-up-in')!;
		const created = preset.create();

		expect(created).toMatchObject({ slide: { direction: 'south', distanceMode: 'fixed' } });
		// A preset is a shortcut, not a persisted type: the recipe carries no preset id.
		expect(Object.keys(created)).not.toContain('presetId');
		expect(Object.keys(created)).not.toContain('preset');
	});

	it('keeps every preset inside the settled recipe bounds', () => {
		for (const preset of GRAPHIC_ANIMATION_PRESETS) {
			const created = preset.create();
			expect(created.duration).toBeGreaterThanOrEqual(MIN_GRAPHIC_ANIMATION_DURATION_MS);
			expect(created.duration).toBeLessThanOrEqual(MAX_GRAPHIC_ANIMATION_DURATION_MS);
			expect(created.delay).toBeGreaterThanOrEqual(0);
			expect(GRAPHIC_ANIMATION_EASING_VALUES).toContain(created.easing);
		}
	});

	it('offers at least one preset for every lifecycle phase', () => {
		for (const phase of GRAPHIC_ANIMATION_PHASE_VALUES)
			expect(graphicAnimationPresetsForPhase(phase).length).toBeGreaterThan(0);
	});

	it('gives every phase a default recipe that actually moves', () => {
		for (const phase of GRAPHIC_ANIMATION_PHASE_VALUES) {
			const created = createDefaultGraphicAnimationRecipe(phase);
			expect(Boolean(created.fade || created.slide || created.scale || created.reveal)).toBe(true);
			expect(created.duration).toBeGreaterThanOrEqual(MIN_GRAPHIC_ANIMATION_DURATION_MS);
		}
	});

	it('gives an on-screen default its repetition and pause', () => {
		const created = createDefaultGraphicAnimationRecipe('on-screen');

		expect(created.repeat).toBe('indefinite');
		expect(created.pause).toBeGreaterThanOrEqual(0);
	});
});

describe('lifecycle timelines', () => {
	const enter = recipe({ duration: 400 });
	const exit = recipe({ duration: 300 });
	const cycle = { duration: 1000, easing: 'linear' as const, delay: 0, pause: 500, repeat: 3 };

	it('runs each phase where the previous one ended', () => {
		const composition = graphic([], { 'enter': enter, 'on-screen': cycle, 'exit': exit });
		const timeline = broadcastGraphicAnimationTimeline(composition, GRAPHIC_ANIMATION_PHASE_VALUES);

		expect(timeline).toEqual([
			{ phase: 'enter', start: 0, duration: 400 },
			{ phase: 'on-screen', start: 400, duration: 4500 },
			{ phase: 'update', start: 4900, duration: 0 },
			{ phase: 'exit', start: 4900, duration: 300 },
		]);
		expect(graphicAnimationTimelineDurationMs(timeline)).toBe(5200);
	});

	it('keeps an unauthored phase in the timeline at zero length', () => {
		const timeline = broadcastGraphicAnimationTimeline(graphic([]), GRAPHIC_ANIMATION_PHASE_VALUES);

		expect(timeline.map(segment => segment.duration)).toEqual([0, 0, 0, 0]);
		expect(graphicAnimationTimelineDurationMs(timeline)).toBe(0);
	});

	it('bounds an indefinite on-screen recipe so a lifecycle run can reach its exit', () => {
		const indefinite = graphic([], {
			'on-screen': { duration: 1000, easing: 'linear', delay: 0, pause: 0, repeat: 'indefinite' },
		});

		// Two bounded cycles: enough to show cycling repeats without accumulating.
		expect(broadcastGraphicOnScreenRunMs(indefinite)).toBe(2000);
		// And it still never gates the on-air Graphic Playout State.
		expect(broadcastGraphicPhaseDurationMs(indefinite, 'on-screen')).toBe(0);
	});

	it('runs a finite on-screen recipe to its own end', () => {
		expect(broadcastGraphicOnScreenRunMs(graphic([], { 'on-screen': cycle }))).toBe(4500);
	});

	it('takes the longest on-screen recipe among the graphic and its items', () => {
		const composition = graphic([
			shape('a', { animation: { 'on-screen': { ...cycle, repeat: 1 } } }),
			shape('b', { animation: { 'on-screen': { ...cycle, repeat: 5 } } }),
		]);

		expect(broadcastGraphicOnScreenRunMs(composition)).toBe(7500);
	});

	it('locates an elapsed time as one phase and one elapsed time inside it', () => {
		const timeline = broadcastGraphicAnimationTimeline(
			graphic([], { enter, exit }),
			['enter', 'exit'],
		);

		expect(graphicAnimationTimelineAt(timeline, 0)).toEqual({ phase: 'enter', elapsed: 0 });
		expect(graphicAnimationTimelineAt(timeline, 399)).toEqual({ phase: 'enter', elapsed: 399 });
		expect(graphicAnimationTimelineAt(timeline, 400)).toEqual({ phase: 'exit', elapsed: 0 });
		expect(graphicAnimationTimelineAt(timeline, 600)).toEqual({ phase: 'exit', elapsed: 200 });
	});

	it('holds the final phase past the end of the timeline rather than snapping back', () => {
		const timeline = broadcastGraphicAnimationTimeline(
			graphic([], { enter, exit }),
			['enter', 'exit'],
		);

		expect(graphicAnimationTimelineAt(timeline, 9999)).toEqual({ phase: 'exit', elapsed: 9599 });
	});

	it('has no phase to be in with an empty timeline', () => {
		expect(graphicAnimationTimelineAt([], 100)).toBeNull();
	});

	it('never reports a negative elapsed time', () => {
		const timeline = broadcastGraphicAnimationTimeline(graphic([], { enter }), ['enter']);

		expect(graphicAnimationTimelineAt(timeline, -500)).toEqual({ phase: 'enter', elapsed: 0 });
		expect(graphicAnimationTimelineAt(timeline, Number.NaN)).toEqual({ phase: 'enter', elapsed: 0 });
	});
});
