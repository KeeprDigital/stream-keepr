import type { GraphicAnimationRecipe, GraphicOnScreenAnimationRecipe } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	graphicAnimationExcursion,
	graphicAnimationLinearProgress,
	graphicClearParentDistance,
	isGraphicRestingProjection,
	resolveGraphicAnimationValues,
} from '~~/shared/modules/graphics';

const RECT = { x: 200, y: 100, width: 400, height: 80 };
const CANVAS = { width: 1920, height: 1080 };

function project(
	recipe: GraphicAnimationRecipe | GraphicOnScreenAnimationRecipe | undefined,
	phase: 'enter' | 'on-screen' | 'update' | 'exit',
	elapsed: number,
	staggerOffset = 0,
) {
	return resolveGraphicAnimationValues({ recipe, phase, elapsed, staggerOffset, rect: RECT, parent: CANVAS });
}

const LINEAR: GraphicAnimationRecipe = { duration: 400, easing: 'linear', delay: 0 };

describe('graphicAnimationLinearProgress', () => {
	it('holds at zero until the recipe delayed and staggered start', () => {
		const delayed = { duration: 400, delay: 200 };

		expect(graphicAnimationLinearProgress(delayed, 0)).toBe(0);
		expect(graphicAnimationLinearProgress(delayed, 200)).toBe(0);
		expect(graphicAnimationLinearProgress(delayed, 400)).toBe(0.5);
		expect(graphicAnimationLinearProgress(delayed, 200, 400)).toBe(0);
		expect(graphicAnimationLinearProgress(delayed, 800, 400)).toBe(0.5);
	});

	it('clamps at one rather than wrapping, so a stale elapsed time resolves to the end', () => {
		// This is the property recovery and a late-loading output both rely on:
		// projection is monotone in elapsed time and saturates, so an effective start
		// time from before a restart can only ever resolve forwards to the settled
		// end of the phase — never back to its beginning.
		expect(graphicAnimationLinearProgress(LINEAR, 400)).toBe(1);
		expect(graphicAnimationLinearProgress(LINEAR, 400_000)).toBe(1);
		expect(graphicAnimationLinearProgress(LINEAR, Number.POSITIVE_INFINITY)).toBe(1);
	});

	it('treats a zero-length recipe as already complete', () => {
		expect(graphicAnimationLinearProgress({ duration: 0, delay: 0 }, 0)).toBe(1);
	});
});

describe('graphicAnimationExcursion', () => {
	it('enters from the excursion and settles at the Graphic Resting State', () => {
		expect(graphicAnimationExcursion({ recipe: LINEAR, phase: 'enter', elapsed: 0, rect: RECT, parent: CANVAS })).toBe(1);
		expect(graphicAnimationExcursion({ recipe: LINEAR, phase: 'enter', elapsed: 200, rect: RECT, parent: CANVAS })).toBe(0.5);
		expect(graphicAnimationExcursion({ recipe: LINEAR, phase: 'enter', elapsed: 400, rect: RECT, parent: CANVAS })).toBe(0);
	});

	it('exits away from the Graphic Resting State', () => {
		expect(graphicAnimationExcursion({ recipe: LINEAR, phase: 'exit', elapsed: 0, rect: RECT, parent: CANVAS })).toBe(0);
		expect(graphicAnimationExcursion({ recipe: LINEAR, phase: 'exit', elapsed: 400, rect: RECT, parent: CANVAS })).toBe(1);
	});

	it('projects an update like an incoming rendering, from the excursion to rest', () => {
		expect(graphicAnimationExcursion({ recipe: LINEAR, phase: 'update', elapsed: 0, rect: RECT, parent: CANVAS })).toBe(1);
		expect(graphicAnimationExcursion({ recipe: LINEAR, phase: 'update', elapsed: 400, rect: RECT, parent: CANVAS })).toBe(0);
	});

	it('settles anything with no recipe immediately, in every phase', () => {
		for (const phase of ['enter', 'on-screen', 'update', 'exit'] as const)
			expect(graphicAnimationExcursion({ recipe: undefined, phase, elapsed: 0, rect: RECT, parent: CANVAS })).toBe(0);
	});
});

describe('on-screen cycling', () => {
	const cycle: GraphicOnScreenAnimationRecipe = {
		duration: 1000,
		easing: 'linear',
		delay: 0,
		pause: 500,
		repeat: 'indefinite',
	};

	it('cycles from the Graphic Resting State to the excursion and back', () => {
		expect(project(cycle, 'on-screen', 0).opacity).toBeUndefined();
		expect(graphicAnimationExcursion({ recipe: cycle, phase: 'on-screen', elapsed: 0, rect: RECT, parent: CANVAS })).toBe(0);
		expect(graphicAnimationExcursion({ recipe: cycle, phase: 'on-screen', elapsed: 500, rect: RECT, parent: CANVAS })).toBe(1);
		expect(graphicAnimationExcursion({ recipe: cycle, phase: 'on-screen', elapsed: 999, rect: RECT, parent: CANVAS })).toBeCloseTo(0.002, 3);
	});

	it('rests through the pause between cycles', () => {
		expect(graphicAnimationExcursion({ recipe: cycle, phase: 'on-screen', elapsed: 1200, rect: RECT, parent: CANVAS })).toBe(0);
	});

	it('never accumulates motion across cycles', () => {
		const first = graphicAnimationExcursion({ recipe: cycle, phase: 'on-screen', elapsed: 500, rect: RECT, parent: CANVAS });
		const fourth = graphicAnimationExcursion({ recipe: cycle, phase: 'on-screen', elapsed: (3 * 1500) + 500, rect: RECT, parent: CANVAS });

		expect(fourth).toBe(first);
	});

	it('stops at the Graphic Resting State once a finite repetition is exhausted', () => {
		const twice = { ...cycle, repeat: 2 };

		expect(graphicAnimationExcursion({ recipe: twice, phase: 'on-screen', elapsed: 1500 + 500, rect: RECT, parent: CANVAS })).toBe(1);
		expect(graphicAnimationExcursion({ recipe: twice, phase: 'on-screen', elapsed: 3000 + 500, rect: RECT, parent: CANVAS })).toBe(0);
		expect(graphicAnimationExcursion({ recipe: twice, phase: 'on-screen', elapsed: 900_000, rect: RECT, parent: CANVAS })).toBe(0);
	});

	it('keeps an indefinite recipe cycling for as long as it is asked', () => {
		expect(graphicAnimationExcursion({ recipe: cycle, phase: 'on-screen', elapsed: (600 * 1500) + 500, rect: RECT, parent: CANVAS })).toBe(1);
	});
});

describe('channel projection', () => {
	it('leaves the Graphic Resting State untouched with no recipe', () => {
		expect(project(undefined, 'enter', 0)).toEqual({});
		expect(isGraphicRestingProjection(project(undefined, 'enter', 0))).toBe(true);
	});

	it('reduces opacity from resting towards the authored fade', () => {
		const recipe = { ...LINEAR, fade: { opacity: 0.25 } };

		expect(project(recipe, 'enter', 0).opacity).toBeCloseTo(0.25, 10);
		expect(project(recipe, 'enter', 200).opacity).toBeCloseTo(0.625, 10);
		// Settled: nothing at all, rather than an opacity of exactly one.
		expect(project(recipe, 'enter', 400)).toEqual({});
	});

	it('slides a fixed canonical pixel distance along one compass direction', () => {
		const recipe = { ...LINEAR, slide: { direction: 'north-east' as const, distanceMode: 'fixed' as const, distance: 100 } };

		expect(project(recipe, 'enter', 0).translate).toEqual({ x: 100, y: -100 });
		expect(project(recipe, 'enter', 400)).toEqual({});
	});

	it('slides far enough to clear its parent when asked, from its own position', () => {
		const east = { ...LINEAR, slide: { direction: 'east' as const, distanceMode: 'clear-parent' as const, distance: 0 } };
		const west = { ...LINEAR, slide: { direction: 'west' as const, distanceMode: 'clear-parent' as const, distance: 0 } };

		// East has to reach the parent's right edge from x=200 of a 1920 canvas.
		expect(project(east, 'exit', 400).translate).toEqual({ x: 1720, y: 0 });
		// West only has to clear its own right edge past the parent's left edge.
		expect(project(west, 'exit', 400).translate).toEqual({ x: -600, y: 0 });
	});

	it('scales uniformly about its Graphic Animation Origin, independent of any anchor', () => {
		const recipe = { ...LINEAR, scale: { factor: 0.5, origin: 'bottom-right' as const } };

		expect(project(recipe, 'enter', 0)).toMatchObject({ scale: 0.5, scaleOrigin: { x: 1, y: 1 } });
		expect(project(recipe, 'enter', 400)).toEqual({});
	});

	it('scales up to twice the resting size', () => {
		const recipe = { ...LINEAR, scale: { factor: 2, origin: 'center' as const } };

		expect(project(recipe, 'exit', 400).scale).toBe(2);
	});

	it('reveals from one edge, fully hidden at the excursion and fully visible at rest', () => {
		const recipe = { ...LINEAR, reveal: { edge: 'left' as const } };

		expect(project(recipe, 'enter', 0).reveal).toEqual({ edge: 'left', visible: 0 });
		expect(project(recipe, 'enter', 200).reveal).toEqual({ edge: 'left', visible: 0.5 });
		expect(project(recipe, 'enter', 400)).toEqual({});
	});

	it('runs every channel of one recipe simultaneously on shared timing', () => {
		const recipe = {
			...LINEAR,
			fade: { opacity: 0 },
			slide: { direction: 'south' as const, distanceMode: 'fixed' as const, distance: 40 },
			scale: { factor: 0.8, origin: 'center' as const },
			reveal: { edge: 'top' as const },
		};

		const halfway = project(recipe, 'enter', 200);

		expect(halfway.opacity).toBeCloseTo(0.5, 10);
		expect(halfway.translate).toEqual({ x: 0, y: 20 });
		expect(halfway.scale).toBeCloseTo(0.9, 10);
		expect(halfway.reveal).toEqual({ edge: 'top', visible: 0.5 });
	});

	it('holds at the excursion through a delay and a stagger offset, then travels', () => {
		const recipe = { ...LINEAR, delay: 100, fade: { opacity: 0 } };

		expect(project(recipe, 'enter', 300, 200).opacity).toBe(0);
		expect(project(recipe, 'enter', 500, 200).opacity).toBeCloseTo(0.5, 10);
		expect(project(recipe, 'enter', 700, 200)).toEqual({});
	});

	it('applies its easing to every channel of the same recipe alike', () => {
		const eased = {
			duration: 400,
			easing: 'ease-in' as const,
			delay: 0,
			fade: { opacity: 0 },
			scale: { factor: 0, origin: 'center' as const },
		};

		// ease-in at half travel is 0.25, so both channels sit a quarter of the way.
		const halfway = project(eased, 'enter', 200);
		expect(halfway.opacity).toBeCloseTo(0.25, 10);
		expect(halfway.scale).toBeCloseTo(0.25, 10);
	});
});

describe('graphicClearParentDistance', () => {
	it('measures the shortest travel that leaves the parent bounds', () => {
		expect(graphicClearParentDistance(RECT, CANVAS, 'north')).toBe(180);
		expect(graphicClearParentDistance(RECT, CANVAS, 'south')).toBe(980);
		expect(graphicClearParentDistance(RECT, CANVAS, 'east')).toBe(1720);
		expect(graphicClearParentDistance(RECT, CANVAS, 'west')).toBe(600);
	});

	it('takes the nearer axis for a diagonal, because leaving either one clears', () => {
		expect(graphicClearParentDistance(RECT, CANVAS, 'north-east')).toBe(180);
		expect(graphicClearParentDistance(RECT, CANVAS, 'south-west')).toBe(600);
	});

	it('never asks for a negative distance from an item already outside its parent', () => {
		const outside = { x: -900, y: -900, width: 10, height: 10 };

		expect(graphicClearParentDistance(outside, CANVAS, 'north')).toBe(0);
		expect(graphicClearParentDistance(outside, CANVAS, 'west')).toBe(0);
	});
});

describe('a settled phase is indistinguishable from the Graphic Resting State', () => {
	const busy: GraphicAnimationRecipe = {
		duration: 400,
		easing: 'back-out',
		delay: 100,
		fade: { opacity: 0 },
		slide: { direction: 'south-west', distanceMode: 'clear-parent', distance: 0 },
		scale: { factor: 1.9, origin: 'top-right' },
		reveal: { edge: 'bottom' },
	};

	it('projects nothing once an enter has completed, however long ago', () => {
		// The recovery invariant, as a property of the projection rather than a
		// promise about it: an effective start time from before a restart produces the
		// same empty projection as no animation at all, so recovery settles a
		// target-on-air graphic at its resting state instead of replaying its entrance.
		for (const elapsed of [500, 5_000, 86_400_000])
			expect(project(busy, 'enter', elapsed)).toEqual({});

		expect(project(busy, 'enter', 500)).toEqual(project(undefined, 'enter', 0));
	});

	it('projects nothing before an exit has begun', () => {
		expect(project(busy, 'exit', 0)).toEqual({});
	});

	it('projects nothing once a finite on-screen repetition is exhausted', () => {
		const cycles = { ...busy, delay: 0, pause: 0, repeat: 2 } as GraphicOnScreenAnimationRecipe;

		expect(project(cycles, 'on-screen', 800)).toEqual({});
		expect(project(cycles, 'on-screen', 86_400_000)).toEqual({});
	});
});
