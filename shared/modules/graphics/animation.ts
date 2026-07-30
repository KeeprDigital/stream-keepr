import type {
	BroadcastGraphicConfig,
	GraphicAnimation,
	GraphicAnimationEasing,
	GraphicAnimationOrigin,
	GraphicAnimationPhase,
	GraphicAnimationRecipe,
	GraphicAnimationStagger,
	GraphicContainerAnimation,
	GraphicItemConfig,
	GraphicOnScreenAnimationRecipe,
	GraphicSlideDirection,
} from '../../types/graphics';
import {
	GRAPHIC_ANIMATION_REPEAT_INDEFINITE,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
} from '../../types/graphics';

/**
 * Graphic Animation vocabulary.
 *
 * Bounded recipes, not a keyframe timeline: the shape of what an author may
 * express lives in `shared/types/graphics`, and this module is the pure meaning
 * of that shape — easing curves, the nine scale origins, the eight slide
 * directions, stagger ordering, and the timing arithmetic that decides when a
 * lifecycle phase is complete.
 *
 * ## One shared phase start
 *
 * Every recipe in the same lifecycle phase measures its delay from one shared
 * phase start, and a container's stagger adds an ordered offset on top of that
 * delay. Nothing here measures from another recipe's completion, so a phase's
 * duration is simply the latest delayed-and-staggered recipe's end — which is
 * what lets every output and Live Control project the same phase from one
 * authoritative effective start time, with no acknowledgement from anyone.
 *
 * ## Absence means immediate
 *
 * A missing recipe contributes nothing and makes its owner change immediately,
 * so a Broadcast Graphic with no authored animation has a zero-length phase and
 * is settled at its Graphic Resting State the instant its phase starts. That is
 * the same arithmetic Cut relies on, rather than a special case beside it.
 */

export interface GraphicAnimationOriginDefinition {
	value: GraphicAnimationOrigin;
	label: string;
	/** Fraction of the owner's width the origin sits at. */
	x: number;
	/** Fraction of the owner's height the origin sits at. */
	y: number;
}

export const GRAPHIC_ANIMATION_ORIGINS: readonly GraphicAnimationOriginDefinition[] = [
	{ value: 'top-left', label: 'Top left', x: 0, y: 0 },
	{ value: 'top', label: 'Top', x: 0.5, y: 0 },
	{ value: 'top-right', label: 'Top right', x: 1, y: 0 },
	{ value: 'left', label: 'Left', x: 0, y: 0.5 },
	{ value: 'center', label: 'Centre', x: 0.5, y: 0.5 },
	{ value: 'right', label: 'Right', x: 1, y: 0.5 },
	{ value: 'bottom-left', label: 'Bottom left', x: 0, y: 1 },
	{ value: 'bottom', label: 'Bottom', x: 0.5, y: 1 },
	{ value: 'bottom-right', label: 'Bottom right', x: 1, y: 1 },
];

/** A scale channel defaults to centre. */
export function resolveGraphicAnimationOrigin(
	value: GraphicAnimationOrigin | undefined,
): GraphicAnimationOriginDefinition {
	return GRAPHIC_ANIMATION_ORIGINS.find(origin => origin.value === value)
		?? GRAPHIC_ANIMATION_ORIGINS.find(origin => origin.value === 'center')!;
}

export interface GraphicSlideDirectionDefinition {
	value: GraphicSlideDirection;
	label: string;
	/** Unit step along the canvas x axis, positive to the right. */
	x: number;
	/** Unit step along the canvas y axis, positive downwards. */
	y: number;
}

/**
 * The eight compass directions, as unit steps in canvas coordinates. A diagonal
 * steps a full unit on each axis rather than a normalised one, so "north-east by
 * 100 pixels" clears 100 pixels of each edge it has to clear.
 */
export const GRAPHIC_SLIDE_DIRECTIONS: readonly GraphicSlideDirectionDefinition[] = [
	{ value: 'north', label: 'Up', x: 0, y: -1 },
	{ value: 'north-east', label: 'Up right', x: 1, y: -1 },
	{ value: 'east', label: 'Right', x: 1, y: 0 },
	{ value: 'south-east', label: 'Down right', x: 1, y: 1 },
	{ value: 'south', label: 'Down', x: 0, y: 1 },
	{ value: 'south-west', label: 'Down left', x: -1, y: 1 },
	{ value: 'west', label: 'Left', x: -1, y: 0 },
	{ value: 'north-west', label: 'Up left', x: -1, y: -1 },
];

export function resolveGraphicSlideDirection(
	value: GraphicSlideDirection | undefined,
): GraphicSlideDirectionDefinition {
	return GRAPHIC_SLIDE_DIRECTIONS.find(direction => direction.value === value)
		?? GRAPHIC_SLIDE_DIRECTIONS[0]!;
}

export const GRAPHIC_ANIMATION_PHASE_LABELS: Readonly<Record<GraphicAnimationPhase, string>> = {
	'enter': 'Enter',
	'on-screen': 'On screen',
	'update': 'Update',
	'exit': 'Exit',
};

/* ────────────────────────────────────────────────
 * Easing
 * ──────────────────────────────────────────────── */

/** The overshoot constant the back easings are conventionally defined with. */
const BACK_OVERSHOOT = 1.70158;
const BACK_IN_OUT_OVERSHOOT = BACK_OVERSHOOT * 1.525;

function clampProgress(value: number): number {
	if (!Number.isFinite(value))
		return 0;
	return Math.max(0, Math.min(1, value));
}

/**
 * One of the seven bounded easings applied to linear progress.
 *
 * A back easing deliberately leaves the zero-to-one range in the middle of its
 * travel — that overshoot is the whole point of it — while every easing still
 * starts at exactly 0 and ends at exactly 1, which is what makes a recipe land
 * on its owner's Graphic Resting State rather than near it.
 */
export function graphicAnimationEasedProgress(easing: GraphicAnimationEasing, progress: number): number {
	const t = clampProgress(progress);

	// Snapped rather than computed at the ends. A back easing's polynomial leaves
	// floating-point dust at zero and one, and "settled at the Graphic Resting
	// State" has to be exact: 2e-16 of an excursion is not a rendering difference,
	// but it is the difference between projecting nothing and projecting a frame.
	if (t <= 0)
		return 0;
	if (t >= 1)
		return 1;

	switch (easing) {
		case 'ease-in':
			return t * t;
		case 'ease-out':
			return 1 - ((1 - t) ** 2);
		case 'ease-in-out':
			return t < 0.5 ? 2 * t * t : 1 - (2 * ((1 - t) ** 2));
		case 'back-in':
			return ((BACK_OVERSHOOT + 1) * t * t * t) - (BACK_OVERSHOOT * t * t);
		case 'back-out':
			return 1 + ((BACK_OVERSHOOT + 1) * ((t - 1) ** 3)) + (BACK_OVERSHOOT * ((t - 1) ** 2));
		case 'back-in-out':
			return t < 0.5
				? (((2 * t) ** 2) * (((BACK_IN_OUT_OVERSHOOT + 1) * 2 * t) - BACK_IN_OUT_OVERSHOOT)) / 2
				: ((((((2 * t) - 2) ** 2) * (((BACK_IN_OUT_OVERSHOOT + 1) * ((2 * t) - 2)) + BACK_IN_OUT_OVERSHOOT)) + 2) / 2);
		case 'linear':
		default:
			return t;
	}
}

/* ────────────────────────────────────────────────
 * Stagger
 * ──────────────────────────────────────────────── */

/**
 * The ordered offset one direct Graphic Item's recipe delay gains from its
 * container's stagger, in milliseconds.
 *
 * The offset is counted across the *selected subset* in the stagger's own order,
 * so unselected siblings neither receive an offset nor consume a step, and an id
 * that no longer names a direct item is skipped rather than leaving a gap.
 */
export function graphicAnimationStaggerOffset(
	stagger: GraphicAnimationStagger | undefined,
	directItemIds: readonly string[],
	itemId: string,
): number {
	if (!stagger || !stagger.itemIds.includes(itemId))
		return 0;

	const selected = directItemIds.filter(id => stagger.itemIds.includes(id));
	const ordered = stagger.order === 'reverse-list' ? [...selected].reverse() : selected;
	const index = ordered.indexOf(itemId);
	if (index < 0)
		return 0;

	return Math.max(0, stagger.step) * index;
}

/* ────────────────────────────────────────────────
 * Phase timing
 * ──────────────────────────────────────────────── */

/**
 * How long one cycle of an on-screen recipe takes, including its pause.
 *
 * A cycle travels to the excursion and back inside the recipe's own duration, so
 * the authored duration is the length of one complete out-and-back rather than
 * of one leg. The pause then separates that cycle from the next.
 */
export function graphicOnScreenCycleMs(recipe: GraphicOnScreenAnimationRecipe): number {
	return Math.max(0, recipe.duration) + Math.max(0, recipe.pause);
}

/**
 * When one recipe finishes, measured from its lifecycle phase's shared start.
 *
 * An on-screen recipe is deliberately not measured here: an indefinite one never
 * finishes, and even a finite one must not prevent the Graphic Playout State from
 * being on-air, so on-screen cycling is projected but never gates a phase.
 */
export function graphicAnimationRecipeEndMs(recipe: GraphicAnimationRecipe, staggerOffset = 0): number {
	return Math.max(0, recipe.delay) + Math.max(0, staggerOffset) + Math.max(0, recipe.duration);
}

/** The recipe one owner authored for one lifecycle phase, if it enabled that phase. */
export function graphicAnimationRecipe(
	animation: GraphicAnimation | undefined,
	phase: GraphicAnimationPhase,
): GraphicAnimationRecipe | undefined {
	return animation?.[phase];
}

export function graphicAnimationStagger(
	animation: GraphicContainerAnimation | undefined,
	phase: GraphicAnimationPhase,
): GraphicAnimationStagger | undefined {
	return animation?.stagger?.[phase];
}

/**
 * How long one finite lifecycle phase of a Broadcast Graphic lasts.
 *
 * A finite phase completes after its latest delayed or staggered recipe
 * completes — across the whole-graphic recipe, every top-level item, and every
 * Graphic Group child, all measured from the same shared phase start. A graphic
 * with nothing authored for the phase returns zero, which is what makes a missing
 * recipe, and Cut, complete that phase immediately.
 *
 * An on-screen phase always returns zero: it begins after enter completes and
 * never gates on-air, indefinite or not.
 */
export function broadcastGraphicPhaseDurationMs(
	graphic: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
	phase: GraphicAnimationPhase,
): number {
	if (phase === 'on-screen')
		return 0;

	const own = graphicAnimationRecipe(graphic.animation, phase);
	const topLevelIds = graphic.items.map(item => item.id);
	const graphicStagger = graphicAnimationStagger(graphic.animation, phase);

	let latest = own ? graphicAnimationRecipeEndMs(own) : 0;

	for (const item of graphic.items) {
		const offset = graphicAnimationStaggerOffset(graphicStagger, topLevelIds, item.id);
		const recipe = graphicAnimationRecipe(item.animation, phase);
		if (recipe)
			latest = Math.max(latest, graphicAnimationRecipeEndMs(recipe, offset));

		if (item.type !== 'group')
			continue;

		const childIds = item.children.map(child => child.id);
		const childStagger = graphicAnimationStagger(item.animation, phase);
		for (const child of item.children) {
			const childRecipe = graphicAnimationRecipe(child.animation, phase);
			if (!childRecipe)
				continue;
			// A child's offset is its group's stagger plus whatever offset the group
			// itself received, because both are measured from one shared phase start.
			const childOffset = offset + graphicAnimationStaggerOffset(childStagger, childIds, child.id);
			latest = Math.max(latest, graphicAnimationRecipeEndMs(childRecipe, childOffset));
		}
	}

	return latest;
}

/** Whether a Broadcast Graphic has any recipe authored for one lifecycle phase. */
export function broadcastGraphicHasPhaseAnimation(
	graphic: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
	phase: GraphicAnimationPhase,
): boolean {
	if (graphicAnimationRecipe(graphic.animation, phase))
		return true;

	return graphic.items.some(item =>
		Boolean(graphicAnimationRecipe(item.animation, phase))
		|| (item.type === 'group' && item.children.some(child =>
			Boolean(graphicAnimationRecipe(child.animation, phase)),
		)),
	);
}

/* ────────────────────────────────────────────────
 * Defaults and presets
 * ──────────────────────────────────────────────── */

/**
 * The recipe an author gets when they enable one lifecycle phase.
 *
 * Enabling a phase must be a visible, immediately useful default rather than an
 * inert zero-motion recipe, so each phase starts as the plainest thing that
 * reads as that phase: a fade in, a gentle on-screen pulse, a cross-fade update,
 * a fade out.
 */
export function createDefaultGraphicAnimationRecipe(phase: 'on-screen'): GraphicOnScreenAnimationRecipe;
export function createDefaultGraphicAnimationRecipe(
	phase: Exclude<GraphicAnimationPhase, 'on-screen'>,
): GraphicAnimationRecipe;
export function createDefaultGraphicAnimationRecipe(
	phase: GraphicAnimationPhase,
): GraphicAnimationRecipe | GraphicOnScreenAnimationRecipe;
export function createDefaultGraphicAnimationRecipe(
	phase: GraphicAnimationPhase,
): GraphicAnimationRecipe | GraphicOnScreenAnimationRecipe {
	if (phase === 'on-screen') {
		return {
			duration: 2000,
			easing: 'ease-in-out',
			delay: 0,
			pause: 1000,
			repeat: GRAPHIC_ANIMATION_REPEAT_INDEFINITE,
			fade: { opacity: 0.6 },
		};
	}

	return {
		duration: phase === 'exit' ? 300 : 400,
		easing: phase === 'exit' ? 'ease-in' : 'ease-out',
		delay: 0,
		fade: { opacity: 0 },
	};
}

export interface GraphicAnimationPreset {
	id: string;
	label: string;
	/** The phase this preset is written for; an author may still apply it elsewhere. */
	phase: GraphicAnimationPhase;
	/** Produce the editable recipe. Nothing records that a preset was used. */
	create: () => GraphicAnimationRecipe | GraphicOnScreenAnimationRecipe;
}

/**
 * Animation presets are authoring shortcuts that initialise editable Graphic
 * Animation Recipes rather than distinct runtime concepts: applying one writes an
 * ordinary recipe and nothing remembers which preset produced it, exactly as a
 * Shape Geometry preset behaves.
 */
export const GRAPHIC_ANIMATION_PRESETS: readonly GraphicAnimationPreset[] = [
	{
		id: 'fade-in',
		label: 'Fade in',
		phase: 'enter',
		create: () => ({ duration: 400, easing: 'ease-out', delay: 0, fade: { opacity: 0 } }),
	},
	{
		id: 'slide-up-in',
		label: 'Slide up in',
		phase: 'enter',
		create: () => ({
			duration: 500,
			easing: 'back-out',
			delay: 0,
			fade: { opacity: 0 },
			slide: { direction: 'south', distanceMode: 'fixed', distance: 60 },
		}),
	},
	{
		id: 'wipe-in',
		label: 'Wipe in from left',
		phase: 'enter',
		create: () => ({ duration: 450, easing: 'ease-in-out', delay: 0, reveal: { edge: 'left' } }),
	},
	{
		id: 'pop-in',
		label: 'Pop in',
		phase: 'enter',
		create: () => ({
			duration: 350,
			easing: 'back-out',
			delay: 0,
			fade: { opacity: 0 },
			scale: { factor: 0.8, origin: 'center' },
		}),
	},
	{
		id: 'slide-in-off-canvas',
		label: 'Slide in past the edge',
		phase: 'enter',
		create: () => ({
			duration: 600,
			easing: 'ease-out',
			delay: 0,
			slide: { direction: 'west', distanceMode: 'clear-parent', distance: 0 },
		}),
	},
	{
		id: 'pulse',
		label: 'Pulse',
		phase: 'on-screen',
		create: () => ({
			duration: 1600,
			easing: 'ease-in-out',
			delay: 0,
			pause: 2000,
			repeat: GRAPHIC_ANIMATION_REPEAT_INDEFINITE,
			fade: { opacity: 0.55 },
		}),
	},
	{
		id: 'breathe',
		label: 'Breathe',
		phase: 'on-screen',
		create: () => ({
			duration: 2400,
			easing: 'ease-in-out',
			delay: 0,
			pause: 0,
			repeat: GRAPHIC_ANIMATION_REPEAT_INDEFINITE,
			scale: { factor: 1.04, origin: 'center' },
		}),
	},
	{
		id: 'cross-fade',
		label: 'Cross fade',
		phase: 'update',
		create: () => ({ duration: 300, easing: 'linear', delay: 0, fade: { opacity: 0 } }),
	},
	{
		id: 'update-wipe',
		label: 'Wipe across',
		phase: 'update',
		create: () => ({ duration: 400, easing: 'ease-in-out', delay: 0, reveal: { edge: 'left' } }),
	},
	{
		id: 'fade-out',
		label: 'Fade out',
		phase: 'exit',
		create: () => ({ duration: 300, easing: 'ease-in', delay: 0, fade: { opacity: 0 } }),
	},
	{
		id: 'slide-down-out',
		label: 'Slide down out',
		phase: 'exit',
		create: () => ({
			duration: 400,
			easing: 'ease-in',
			delay: 0,
			fade: { opacity: 0 },
			slide: { direction: 'south', distanceMode: 'fixed', distance: 60 },
		}),
	},
	{
		id: 'wipe-out',
		label: 'Wipe out to right',
		phase: 'exit',
		create: () => ({ duration: 400, easing: 'ease-in-out', delay: 0, reveal: { edge: 'right' } }),
	},
];

export function getGraphicAnimationPreset(id: string): GraphicAnimationPreset | undefined {
	return GRAPHIC_ANIMATION_PRESETS.find(preset => preset.id === id);
}

/** The presets offered for one lifecycle phase. */
export function graphicAnimationPresetsForPhase(phase: GraphicAnimationPhase): GraphicAnimationPreset[] {
	return GRAPHIC_ANIMATION_PRESETS.filter(preset => preset.phase === phase);
}

/** Clamp an authored duration into the settled bounds, for editor controls. */
export function clampGraphicAnimationDuration(value: number): number {
	return Math.max(
		MIN_GRAPHIC_ANIMATION_DURATION_MS,
		Math.min(MAX_GRAPHIC_ANIMATION_DURATION_MS, Math.round(value)),
	);
}

/** Every Graphic Item that may own a Graphic Animation, groups before their children. */
export function graphicAnimationOwners(
	graphic: Pick<BroadcastGraphicConfig, 'items'>,
): GraphicItemConfig[] {
	return graphic.items.flatMap(item => item.type === 'group' ? [item, ...item.children] : [item]);
}

/* ────────────────────────────────────────────────
 * Deterministic phase projection
 * ──────────────────────────────────────────────── */

/**
 * What one Graphic Animation Recipe does to its owner at one instant, expressed
 * relative to that owner's Graphic Resting State.
 *
 * An absent field means "unchanged from resting", which is why an owner with no
 * recipe, a phase that has not reached its delay yet, and a phase that has
 * finished all resolve to the same empty projection rather than to three
 * different ones.
 */
export interface GraphicAnimationValues {
	/** Multiplier on the owner's resting opacity. Graphic and item fades multiply. */
	opacity?: number;
	/** Offset from the owner's resting position, in canvas pixels. */
	translate?: { x: number; y: number };
	/** Uniform scale factor about `scaleOrigin`. */
	scale?: number;
	/** The scale origin, as fractions of the owner's own bounds. */
	scaleOrigin?: { x: number; y: number };
	/** The wipe: the edge it travels from, and the fraction visible from that edge. */
	reveal?: { edge: GraphicRevealEdge; visible: number };
}

export interface GraphicAnimationProjectionInput {
	recipe: GraphicAnimationRecipe | GraphicOnScreenAnimationRecipe | undefined;
	phase: GraphicAnimationPhase;
	/**
	 * Milliseconds since this phase's one authoritative effective start time. Every
	 * output and Live Control is handed the same number for the same instant, which
	 * is what makes them agree without talking to each other.
	 */
	elapsed: number;
	/** The ordered offset this owner's container added to its delay. */
	staggerOffset?: number;
	/** The owner's Graphic Resting State rectangle. */
	rect: { x: number; y: number; width: number; height: number };
	/** The bounds a `clear-parent` slide has to leave. */
	parent: { width: number; height: number };
}

/**
 * The distance an owner must travel in one direction to leave its parent's bounds.
 *
 * Leaving on either axis puts the owner outside its parent's rectangle, so a
 * diagonal takes the smaller of the two requirements: it is the shortest travel
 * that actually clears, and overshooting would make a diagonal exit read as
 * slower than a straight one at the same duration.
 */
export function graphicClearParentDistance(
	rect: { x: number; y: number; width: number; height: number },
	parent: { width: number; height: number },
	direction: GraphicSlideDirection,
): number {
	const step = resolveGraphicSlideDirection(direction);
	const requirements: number[] = [];

	if (step.x > 0)
		requirements.push(Math.max(0, parent.width - rect.x));
	if (step.x < 0)
		requirements.push(Math.max(0, rect.x + rect.width));
	if (step.y > 0)
		requirements.push(Math.max(0, parent.height - rect.y));
	if (step.y < 0)
		requirements.push(Math.max(0, rect.y + rect.height));

	return requirements.length === 0 ? 0 : Math.min(...requirements);
}

/**
 * How far through its own travel one recipe is at `elapsed`, before easing.
 *
 * Zero until the recipe's delayed-and-staggered start, then linear to one, then
 * one forever. Clamping at one rather than wrapping is what makes a late-loading
 * output — or a recovery reading a start time from before a restart — resolve to
 * the end of the phase instead of replaying it.
 */
export function graphicAnimationLinearProgress(
	recipe: Pick<GraphicAnimationRecipe, 'duration' | 'delay'>,
	elapsed: number,
	staggerOffset = 0,
): number {
	const start = Math.max(0, recipe.delay) + Math.max(0, staggerOffset);
	const duration = Math.max(0, recipe.duration);
	// A recipe with no travel is already complete, which is the same arithmetic a
	// missing recipe and Cut rely on. An unreadable elapsed time is treated as the
	// beginning rather than guessed at; an unboundedly large one saturates below.
	if (duration <= 0)
		return 1;
	if (Number.isNaN(elapsed) || elapsed <= start)
		return 0;
	if (elapsed >= start + duration)
		return 1;
	return (elapsed - start) / duration;
}

/**
 * Where an on-screen cycle sits: the fraction of the excursion currently applied.
 *
 * A cycle travels out and back inside the recipe's duration and then pauses, and
 * the excursion is never accumulated — every cycle starts and ends at the Graphic
 * Resting State. Once a finite repetition is exhausted the owner stays at rest,
 * so an on-screen recipe cannot leave a graphic parked off its resting state.
 */
function onScreenExcursion(recipe: GraphicOnScreenAnimationRecipe, elapsed: number, staggerOffset: number): number {
	const start = Math.max(0, recipe.delay) + Math.max(0, staggerOffset);
	const duration = Math.max(0, recipe.duration);
	const cycle = graphicOnScreenCycleMs(recipe);
	if (!Number.isFinite(elapsed) || elapsed <= start || cycle <= 0 || duration <= 0)
		return 0;

	const since = elapsed - start;
	const index = Math.floor(since / cycle);
	if (recipe.repeat !== GRAPHIC_ANIMATION_REPEAT_INDEFINITE && index >= Math.max(0, recipe.repeat))
		return 0;

	const withinCycle = since - (index * cycle);
	if (withinCycle >= duration)
		return 0;

	// Out and back: the first half travels to the excursion, the second returns.
	const travel = withinCycle / duration;
	return travel <= 0.5 ? travel * 2 : (1 - travel) * 2;
}

/**
 * How much of a recipe's excursion is applied at `elapsed`, from zero (settled at
 * the Graphic Resting State) to one (fully excursed).
 *
 * Enter and update travel *from* the excursion to rest, so they start at one.
 * Exit travels away from rest, so it starts at zero. On-screen cycles between the
 * two. Every phase therefore has exactly one settled end, and none of them can
 * leave the owner somewhere it was never authored to be.
 */
export function graphicAnimationExcursion(input: GraphicAnimationProjectionInput): number {
	const recipe = input.recipe;
	if (!recipe)
		return 0;

	if (input.phase === 'on-screen')
		return onScreenExcursion(recipe as GraphicOnScreenAnimationRecipe, input.elapsed, input.staggerOffset ?? 0);

	const eased = graphicAnimationEasedProgress(
		recipe.easing,
		graphicAnimationLinearProgress(recipe, input.elapsed, input.staggerOffset ?? 0),
	);

	return input.phase === 'exit' ? eased : 1 - eased;
}

/**
 * One owner's Graphic Animation, projected to the values it applies at `elapsed`.
 *
 * Pure and total: the same inputs always produce the same output, with no clock,
 * no DOM, and no state of its own. That is what lets the editor's Graphic
 * Animation Preview and every Screen Output resolve identical motion from
 * identical numbers, and what makes phase projection testable without rendering
 * anything.
 */
export function resolveGraphicAnimationValues(input: GraphicAnimationProjectionInput): GraphicAnimationValues {
	const recipe = input.recipe;
	if (!recipe)
		return {};

	const excursion = graphicAnimationExcursion(input);
	// A settled phase is indistinguishable from no animation at all. That is the
	// property recovery rests on: a Broadcast Graphic whose effective start time is
	// already past its phase duration projects the *same empty values* as one that
	// was never animated, so it is settled at its Graphic Resting State rather than
	// merely close to it — and no output can tell the two apart.
	if (excursion === 0)
		return {};

	const values: GraphicAnimationValues = {};

	if (recipe.fade) {
		// The resting end of a fade is full opacity; the excursion end is the
		// authored reduction. Composition with other fades is multiplicative, which
		// nesting gives for free.
		const from = Math.max(0, Math.min(1, recipe.fade.opacity));
		values.opacity = 1 + ((from - 1) * excursion);
	}

	if (recipe.slide) {
		const step = resolveGraphicSlideDirection(recipe.slide.direction);
		const distance = recipe.slide.distanceMode === 'clear-parent'
			? graphicClearParentDistance(input.rect, input.parent, recipe.slide.direction)
			: Math.max(0, recipe.slide.distance);
		values.translate = {
			x: step.x * distance * excursion,
			y: step.y * distance * excursion,
		};
	}

	if (recipe.scale) {
		const origin = resolveGraphicAnimationOrigin(recipe.scale.origin);
		const factor = Math.max(0, recipe.scale.factor);
		values.scale = 1 + ((factor - 1) * excursion);
		values.scaleOrigin = { x: origin.x, y: origin.y };
	}

	if (recipe.reveal)
		values.reveal = { edge: recipe.reveal.edge, visible: 1 - excursion };

	return values;
}

/** Whether a projection leaves its owner exactly at its Graphic Resting State. */
export function isGraphicRestingProjection(values: GraphicAnimationValues): boolean {
	return values.opacity === undefined
		&& values.translate === undefined
		&& values.scale === undefined
		&& values.reveal === undefined;
}

/* ────────────────────────────────────────────────
 * Lifecycle timelines
 * ──────────────────────────────────────────────── */

/**
 * How many cycles a bounded run gives an indefinite on-screen recipe.
 *
 * An indefinite recipe never finishes, and a full-lifecycle Graphic Animation
 * Preview has to reach the exit phase, so the on-screen segment is bounded here
 * rather than by asking the author to change their recipe. Two cycles is enough to
 * show that cycling repeats without accumulating motion.
 */
export const GRAPHIC_ANIMATION_BOUNDED_ONSCREEN_CYCLES = 2;

export interface GraphicAnimationTimelineSegment {
	phase: GraphicAnimationPhase;
	/** Offset of this segment from the start of the timeline. */
	start: number;
	/** How long this segment runs. */
	duration: number;
}

/**
 * How long a bounded on-screen segment runs for one Broadcast Graphic.
 *
 * The longest on-screen recipe among the graphic and its items decides it: a
 * finite repetition runs to its own end, and an indefinite one is bounded. This is
 * a *preview and choreography* length only — it never gates the on-air Graphic
 * Playout State, which is why `broadcastGraphicPhaseDurationMs` reports zero for
 * the same phase.
 */
export function broadcastGraphicOnScreenRunMs(
	graphic: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
	boundedCycles = GRAPHIC_ANIMATION_BOUNDED_ONSCREEN_CYCLES,
): number {
	const owners: (GraphicAnimation | undefined)[] = [
		graphic.animation,
		...graphic.items.flatMap(item => item.type === 'group'
			? [item.animation, ...item.children.map(child => child.animation)]
			: [item.animation]),
	];

	let longest = 0;
	for (const animation of owners) {
		const recipe = animation?.['on-screen'];
		if (!recipe)
			continue;
		const cycles = recipe.repeat === GRAPHIC_ANIMATION_REPEAT_INDEFINITE
			? Math.max(1, boundedCycles)
			: Math.max(1, recipe.repeat);
		longest = Math.max(longest, Math.max(0, recipe.delay) + (cycles * graphicOnScreenCycleMs(recipe)));
	}

	return longest;
}

/** The length of one phase in a run: finite phases from their recipes, on-screen bounded. */
export function broadcastGraphicPhaseRunMs(
	graphic: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
	phase: GraphicAnimationPhase,
): number {
	return phase === 'on-screen'
		? broadcastGraphicOnScreenRunMs(graphic)
		: broadcastGraphicPhaseDurationMs(graphic, phase);
}

/**
 * One run of the given phases, back to back.
 *
 * Each phase starts where the previous one ended, which is what makes a full
 * lifecycle read the way an operator will see it: enter completes, then on-screen
 * cycling begins, then exit. Within a phase, every recipe still measures its own
 * delay from that phase's single start.
 *
 * A phase with nothing authored is kept at zero length rather than dropped, so a
 * caller stepping through phases sees the same list whatever is authored.
 */
export function broadcastGraphicAnimationTimeline(
	graphic: Pick<BroadcastGraphicConfig, 'items' | 'animation'>,
	phases: readonly GraphicAnimationPhase[],
): GraphicAnimationTimelineSegment[] {
	let start = 0;
	return phases.map((phase) => {
		const duration = broadcastGraphicPhaseRunMs(graphic, phase);
		const segment = { phase, start, duration };
		start += duration;
		return segment;
	});
}

export function graphicAnimationTimelineDurationMs(
	segments: readonly GraphicAnimationTimelineSegment[],
): number {
	return segments.reduce((total, segment) => total + segment.duration, 0);
}

/**
 * Where one elapsed time falls in a timeline, as a phase and an elapsed time
 * within it.
 *
 * Past the end of the timeline this returns the final phase saturated, not null:
 * the caller decides whether to stop, loop, or hold, and holding must show the
 * last phase settled rather than snapping back to the Graphic Resting State of the
 * first. An empty timeline has no phase to be in, which is the only null.
 */
export function graphicAnimationTimelineAt(
	segments: readonly GraphicAnimationTimelineSegment[],
	elapsed: number,
): { phase: GraphicAnimationPhase; elapsed: number } | null {
	if (segments.length === 0)
		return null;

	const position = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
	let consumed = 0;

	for (const segment of segments) {
		if (position < consumed + segment.duration)
			return { phase: segment.phase, elapsed: position - consumed };
		consumed += segment.duration;
	}

	const last = segments[segments.length - 1]!;
	return { phase: last.phase, elapsed: position - (consumed - last.duration) };
}
