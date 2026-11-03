/**
 * Dragging a number field's label to change its value: one displayed step of the
 * field per 2px of horizontal drag, ten with Shift, a tenth with Alt, held inside
 * the field's bounds.
 *
 * Pure. Each pointer move is applied to the scrub so far, so changing a modifier
 * mid-drag changes the rate from there on rather than re-reading the whole drag,
 * and the pixels short of a whole step carry into the next move.
 */

/** Horizontal pixels of drag per step. */
export const NUMBER_SCRUB_PX_PER_STEP = 2;

export interface NumberScrub {
	/** The value the scrub has reached, inside the field's bounds. */
	value: number;
	/** Drag in pixels not yet worth a whole step. */
	remainderPx: number;
}

/** A field's inclusive bounds, either of which may be open. */
export interface NumberScrubBounds {
	min?: number;
	max?: number;
}

export interface NumberScrubMove extends NumberScrubBounds {
	/** Horizontal pixels moved since the last move. */
	dx: number;
	/** The field's displayed step. */
	step: number;
	shiftKey: boolean;
	altKey: boolean;
}

/** A scrub from the field's value, brought inside its bounds. */
export function startNumberScrub(value: number, bounds: NumberScrubBounds = {}): NumberScrub {
	return {
		value: clamp(value, bounds),
		remainderPx: 0,
	};
}

export function scrubNumber(scrub: NumberScrub, move: NumberScrubMove): NumberScrub {
	const px = scrub.remainderPx + move.dx;
	const steps = Math.trunc(px / NUMBER_SCRUB_PX_PER_STEP);
	const increment = move.step * (move.shiftKey
		? 10
		: move.altKey
			? 0.1
			: 1);
	const precision = Math.max(decimalPlaces(increment), decimalPlaces(scrub.value));
	const next = Number((scrub.value + steps * increment).toFixed(precision));
	return {
		value: clamp(next, move),
		remainderPx: px - steps * NUMBER_SCRUB_PX_PER_STEP,
	};
}

function clamp(value: number, { min, max }: NumberScrubBounds): number {
	return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));
}

/** Decimal places worth keeping: float noise such as 0.30000000000000004 is cut at ten. */
function decimalPlaces(value: number): number {
	const [, fraction = ''] = String(Number(value.toFixed(10))).split('.');
	return fraction.length;
}
