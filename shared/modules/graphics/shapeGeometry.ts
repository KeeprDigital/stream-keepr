import type { ShapeCorner, ShapeCornerKey, ShapeGeometry } from '../../types/graphics';
import { SHAPE_CORNER_KEYS } from '../../types/graphics';

/**
 * Shape Geometry: one parameterised rectangle, one path.
 *
 * A Shape Geometry is a quadrilateral — a rectangle whose left and right edges
 * may slant — with each of its four corners independently left square, rounded,
 * or cut. Every consumer renders the same SVG path from the same geometry, so
 * the editor preview and every Screen Output agree by construction.
 *
 * Corner treatment is one operation on a vertex: walk `size` back along the
 * incoming edge and `size` forward along the outgoing edge, then join those two
 * points with a straight chord (cut) or a circular arc (rounded). A square
 * corner is the same operation at size zero. That keeps corners meaningful on a
 * slanted edge, where an axis-aligned border radius would not be.
 */

export interface ShapeGeometrySize {
	width: number;
	height: number;
}

const SQUARE_CORNER: ShapeCorner = { treatment: 'square', size: 0 };

/** A plain rectangle: every corner square, neither edge slanted. */
export function squareShapeGeometry(): ShapeGeometry {
	return {
		topLeft: { ...SQUARE_CORNER },
		topRight: { ...SQUARE_CORNER },
		bottomRight: { ...SQUARE_CORNER },
		bottomLeft: { ...SQUARE_CORNER },
		leftSlant: 0,
		rightSlant: 0,
	};
}

/** Every corner rounded by the same radius, neither edge slanted. */
export function roundedShapeGeometry(size: number): ShapeGeometry {
	const corner: ShapeCorner = { treatment: 'rounded', size };
	return {
		topLeft: { ...corner },
		topRight: { ...corner },
		bottomRight: { ...corner },
		bottomLeft: { ...corner },
		leftSlant: 0,
		rightSlant: 0,
	};
}

interface Point {
	x: number;
	y: number;
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value))
		return min;
	return Math.min(max, Math.max(min, value));
}

/**
 * Slants are bounded by the shape's own width: neither edge may cross the other,
 * so a pair of inward slants that would invert the shape is scaled back
 * proportionally rather than producing a self-intersecting path.
 */
function slantOffsets(width: number, geometry: ShapeGeometry) {
	const span = Math.max(0, width);
	const left = clamp(geometry.leftSlant, -span, span);
	const right = clamp(geometry.rightSlant, -span, span);

	const offsets = {
		leftTop: left > 0 ? left : 0,
		leftBottom: left < 0 ? -left : 0,
		rightTop: right > 0 ? right : 0,
		rightBottom: right < 0 ? -right : 0,
	};

	for (const edge of ['Top', 'Bottom'] as const) {
		const leftKey = `left${edge}` as const;
		const rightKey = `right${edge}` as const;
		const total = offsets[leftKey] + offsets[rightKey];
		if (total > span && total > 0) {
			const scale = span / total;
			offsets[leftKey] *= scale;
			offsets[rightKey] *= scale;
		}
	}

	return offsets;
}

/** The four vertices of the geometry, clockwise from the top-left. */
export function shapeGeometryVertices(size: ShapeGeometrySize, geometry: ShapeGeometry): Point[] {
	const span = Math.max(0, size.width);
	const rise = Math.max(0, size.height);
	const offsets = slantOffsets(span, geometry);

	return [
		{ x: offsets.leftTop, y: 0 },
		{ x: span - offsets.rightTop, y: 0 },
		{ x: span - offsets.rightBottom, y: rise },
		{ x: offsets.leftBottom, y: rise },
	];
}

function distance(from: Point, to: Point): number {
	return Math.hypot(to.x - from.x, to.y - from.y);
}

function towards(from: Point, to: Point, length: number): Point {
	const span = distance(from, to);
	if (span <= 0)
		return { x: from.x, y: from.y };
	const ratio = length / span;
	return { x: from.x + ((to.x - from.x) * ratio), y: from.y + ((to.y - from.y) * ratio) };
}

/** Two decimals is finer than a canvas pixel and keeps a path comparable in a test. */
function round(value: number): number {
	return Math.round(value * 100) / 100;
}

function coordinates(point: Point): string {
	return `${round(point.x)} ${round(point.y)}`;
}

/**
 * The SVG path of one Shape Geometry at one size, drawn clockwise from the
 * top-left corner. Every corner treatment stays inside the shape's own bounds,
 * so nothing paints outside the item's authored rectangle.
 */
export function shapeGeometryPath(size: ShapeGeometrySize, geometry: ShapeGeometry): string {
	const vertices = shapeGeometryVertices(size, geometry);
	// A live Screen Output degrades to a square corner rather than failing to
	// paint: the wire schema requires all four, so this only covers a caller that
	// bypassed it.
	const corners = SHAPE_CORNER_KEYS.map((key: ShapeCornerKey) => geometry[key] ?? SQUARE_CORNER);

	const segments = vertices.map((vertex, index) => {
		const previous = vertices[(index + 3) % 4]!;
		const next = vertices[(index + 1) % 4]!;
		const corner = corners[index]!;
		// Half of each adjacent edge is the most one corner may consume, so two
		// neighbouring treatments can never overrun each other.
		const treatmentSize = corner.treatment === 'square'
			? 0
			: clamp(corner.size, 0, Math.min(distance(vertex, previous), distance(vertex, next)) / 2);

		return {
			treatment: corner.treatment,
			size: treatmentSize,
			entry: towards(vertex, previous, treatmentSize),
			exit: towards(vertex, next, treatmentSize),
		};
	});

	const commands = [`M ${coordinates(segments[0]!.entry)}`];
	let current = segments[0]!.entry;

	// A square corner's entry, vertex, and exit are the same point, so skip any
	// line that would not move: the path of a plain rectangle stays four lines.
	function lineTo(point: Point) {
		if (coordinates(point) === coordinates(current))
			return;
		commands.push(`L ${coordinates(point)}`);
		current = point;
	}

	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index]!;
		if (segment.treatment === 'rounded' && segment.size > 0) {
			commands.push(`A ${round(segment.size)} ${round(segment.size)} 0 0 1 ${coordinates(segment.exit)}`);
			current = segment.exit;
		}
		else {
			lineTo(segment.exit);
		}

		lineTo(segments[(index + 1) % segments.length]!.entry);
	}

	// `Z` closes the path, so an explicit line back to the start is noise.
	if (commands[commands.length - 1] === `L ${coordinates(segments[0]!.entry)}`)
		commands.pop();
	commands.push('Z');

	return commands.join(' ');
}

/** True when the geometry is an unmodified rectangle, so nothing needs clipping. */
export function isRectangularShapeGeometry(geometry: ShapeGeometry): boolean {
	return geometry.leftSlant === 0
		&& geometry.rightSlant === 0
		&& SHAPE_CORNER_KEYS.every((key) => {
			const corner = geometry[key];
			return corner.treatment === 'square' || corner.size <= 0;
		});
}

/** A one-line description of a geometry for the authoring tree. */
export function shapeGeometrySummary(geometry: ShapeGeometry): string {
	const parts: string[] = [];
	const treatments = new Set(
		SHAPE_CORNER_KEYS
			.filter(key => geometry[key].treatment !== 'square' && geometry[key].size > 0)
			.map(key => geometry[key].treatment),
	);
	if (treatments.has('rounded'))
		parts.push('rounded');
	if (treatments.has('cut'))
		parts.push('cut');
	if (geometry.leftSlant !== 0 || geometry.rightSlant !== 0)
		parts.push('slanted');
	return parts.length > 0 ? parts.join(' • ') : 'rectangle';
}

/* ────────────────────────────────────────────────
 * Presets
 * ──────────────────────────────────────────────── */

export const SHAPE_GEOMETRY_PRESET_IDS = ['rectangle', 'rule', 'slanted-edge', 'corner-cut'] as const;
export type ShapeGeometryPresetId = typeof SHAPE_GEOMETRY_PRESET_IDS[number];

export interface ShapeGeometryPresetResult {
	geometry: ShapeGeometry;
	/** A preset may also propose a height, which the author is free to change afterwards. */
	height?: number;
}

export interface ShapeGeometryPreset {
	id: ShapeGeometryPresetId;
	label: string;
	icon: string;
	apply: (size: ShapeGeometrySize) => ShapeGeometryPresetResult;
}

/** A rule is a thin bed; four canvas pixels reads as a line at broadcast sizes. */
export const GRAPHIC_RULE_PRESET_HEIGHT = 4;

/**
 * Authoring shortcuts. Each one initialises the same Shape Geometry rather than
 * persisting a distinct shape type, so nothing downstream branches on a preset.
 */
const PRESETS: readonly ShapeGeometryPreset[] = [
	{
		id: 'rectangle',
		label: 'Rectangle',
		icon: 'i-lucide-square',
		apply: () => ({ geometry: squareShapeGeometry() }),
	},
	{
		id: 'rule',
		label: 'Rule',
		icon: 'i-lucide-minus',
		apply: () => ({ geometry: squareShapeGeometry(), height: GRAPHIC_RULE_PRESET_HEIGHT }),
	},
	{
		id: 'slanted-edge',
		label: 'Slanted edge',
		icon: 'i-lucide-flag-triangle-right',
		apply: size => ({
			geometry: { ...squareShapeGeometry(), rightSlant: Math.round(Math.max(0, size.height) * 0.6) },
		}),
	},
	{
		id: 'corner-cut',
		label: 'Corner cut',
		icon: 'i-lucide-scissors',
		apply: (size) => {
			const cut = Math.round(Math.min(Math.max(0, size.width), Math.max(0, size.height)) * 0.3);
			return {
				geometry: {
					...squareShapeGeometry(),
					topRight: { treatment: 'cut', size: cut },
					bottomLeft: { treatment: 'cut', size: cut },
				},
			};
		},
	},
];

export const SHAPE_GEOMETRY_PRESETS = PRESETS;

export function getShapeGeometryPreset(id: ShapeGeometryPresetId): ShapeGeometryPreset {
	return PRESETS.find(preset => preset.id === id) ?? PRESETS[0]!;
}
