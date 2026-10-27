import type { GraphicFill, GraphicFillKind, GraphicFillStop } from '../../types/graphics';
import { MAX_GRAPHIC_FILL_STOPS, MIN_GRAPHIC_FILL_STOPS } from '../../types/graphics';

/**
 * Graphic Fill edits: one vocabulary and one set of rules for every place a fill
 * is authored.
 *
 * A Graphic Item's own fill and a Theme's fill token are the same Graphic Fill,
 * possibly with a different colour vocabulary. The rules here never read the
 * colour, so both take these edits, and the one fill fields control emits them
 * for both. Only a host's mapping to and from what it stores knows which
 * vocabulary it is.
 */

/** One author change to a Graphic Fill. `color` is in the host's own vocabulary. */
export type GraphicFillEdit
	= | { kind: 'fill-kind'; fillKind: GraphicFillKind }
		| { kind: 'solid-fill'; color: string }
		| { kind: 'gradient-angle'; angle: number }
		| { kind: 'gradient-stop'; index: number; patch: Partial<GraphicFillStop> }
		| { kind: 'stop-count'; delta: 1 | -1 };

export interface ApplyGraphicFillEditOptions {
	/**
	 * What a new gradient's end stop starts as. Absent, it is the fill's own colour,
	 * because a host may have no neutral colour to offer.
	 */
	gradientEndColor?: string;
}

function currentFillColor(fill: GraphicFill): string {
	return fill.type === 'solid'
		? fill.color
		: (fill.stops[0]?.color ?? '');
}

/**
 * Apply one edit to a Graphic Fill, returning the next fill.
 *
 * Switching kind keeps the colour the author was already working with, so it is
 * never a reset; a fill already of that kind is returned as it is. A gradient
 * holds two to four stops, so the bounds are the vocabulary's rather than any
 * editor's; a new stop copies the last one, at the end. An edit for the other kind
 * of fill changes nothing.
 */
export function applyGraphicFillEdit(
	fill: GraphicFill,
	edit: GraphicFillEdit,
	options: ApplyGraphicFillEditOptions = {},
): GraphicFill {
	switch (edit.kind) {
		case 'fill-kind': {
			if (fill.type === edit.fillKind)
				return fill;
			const color = currentFillColor(fill);
			return edit.fillKind === 'solid'
				? { type: 'solid', color }
				: {
						type: 'linear-gradient',
						angle: 90,
						stops: [
							{ color, position: 0, opacity: 1 },
							{ color: options.gradientEndColor ?? color, position: 1, opacity: 1 },
						],
					};
		}
		case 'solid-fill':
			return fill.type === 'solid'
				? { type: 'solid', color: edit.color }
				: fill;
		case 'gradient-angle':
			return fill.type === 'linear-gradient'
				? { ...fill, angle: edit.angle }
				: fill;
		case 'gradient-stop':
			if (fill.type !== 'linear-gradient')
				return fill;
			return {
				...fill,
				stops: fill.stops.map((stop, index) => index === edit.index
					? {
							...stop,
							...edit.patch,
						}
					: stop),
			};
		case 'stop-count': {
			if (fill.type !== 'linear-gradient')
				return fill;
			if (edit.delta === 1 && fill.stops.length < MAX_GRAPHIC_FILL_STOPS) {
				return {
					...fill,
					stops: [
						...fill.stops,
						{
							...fill.stops[fill.stops.length - 1]!,
							position: 1,
						},
					],
				};
			}
			if (edit.delta === -1 && fill.stops.length > MIN_GRAPHIC_FILL_STOPS) {
				return {
					...fill,
					stops: fill.stops.slice(0, -1),
				};
			}
			return fill;
		}
	}
}
