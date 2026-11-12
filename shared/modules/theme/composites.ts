import type { GraphicAnimationRecipe, ShapeGeometry } from '../../types/graphics';
import type { ThemeBackgroundLayer } from './background';
import type { ThemeTokenReference } from './tokens';
import { z } from 'zod';
import {
	GRAPHIC_ANIMATION_EASING_VALUES,
	GRAPHIC_ANIMATION_ORIGIN_VALUES,
	GRAPHIC_REVEAL_EDGE_VALUES,
	GRAPHIC_SLIDE_DIRECTION_VALUES,
	GRAPHIC_SLIDE_DISTANCE_MODE_VALUES,
	MAX_GRAPHIC_ANIMATION_DELAY_MS,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MAX_GRAPHIC_ANIMATION_SCALE,
	MAX_GRAPHIC_FILL_STOPS,
	MAX_GRAPHIC_SLIDE_DISTANCE_PX,
	MAX_SHAPE_GEOMETRY_PX,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_FILL_STOPS,
	SHAPE_CORNER_TREATMENT_VALUES,
} from '../../types/graphics';

/**
 * The composite Theme Token types Graphic Items bind to (#829): Graphic Fill,
 * Graphic Surface Style, Shape Geometry and Graphic Animation Recipe. Each has
 * the shape of the Graphic Item property it fills, so a binding paints it whole.
 *
 * A colour inside a stored fill or surface is a literal: a write admits nothing
 * else. A shipped default may name a colour Foundation Token instead, so
 * changing the accent reaches every surface nobody has set, and a value stored
 * before writes were literal-only may too. Either reads through the token's own
 * precedence (`resolveThemeTokens`); after resolution every colour is a literal.
 */

/**
 * A colour inside a composite token as a default declares it, or as a read
 * meets it: a literal, or a colour Foundation Token it names.
 */
export type ThemeColor = string | ThemeTokenReference;

/** A Graphic Fill whose colours are `C`: as a default declares them, or literals once resolved or written. */
export type ThemeFill<C = ThemeColor>
	= | { type: 'solid'; color: C }
		| { type: 'linear-gradient'; angle: number; stops: Array<{ color: C; position: number; opacity: number }> };

/** A Graphic Surface Style whose colours are `C`. */
export interface ThemeSurfaceStyle<C = ThemeColor> {
	fill: ThemeFill<C>;
	fillOpacity: number;
	outline?: { color: C; width: number };
	glow?: { color: C; size: number; opacity: number };
}

/** What each composite token type holds. */
export interface ThemeCompositeValueTypes {
	'fill': ThemeFill;
	'surface-style': ThemeSurfaceStyle;
	'shape-geometry': ShapeGeometry;
	'animation-recipe': GraphicAnimationRecipe;
}

export type ThemeCompositeTokenType = keyof ThemeCompositeValueTypes;

const finite = z.number().finite();
const unit = finite.min(0).max(1);
export const literalColorSchema = z.string().min(1).max(500);
/** A composite colour as a read accepts it: the literal a write stores, or the former stored reference. */
export const themeColorSchema = z.union([
	literalColorSchema,
	z.object({
		token: z.string().min(1).max(100),
	}).strict(),
]);

/** The gradient form of a Graphic Fill, its stops' colours validated by `colorSchema`. */
export function linearGradientFillSchema<C extends z.ZodType>(colorSchema: C) {
	return z.object({
		type: z.literal('linear-gradient'),
		angle: finite.min(-360).max(360),
		stops: z.array(z.object({
			color: colorSchema,
			position: unit,
			opacity: unit,
		}).strict()).min(MIN_GRAPHIC_FILL_STOPS).max(MAX_GRAPHIC_FILL_STOPS),
	}).strict();
}

function fillSchema<C extends z.ZodType>(colorSchema: C) {
	return z.discriminatedUnion('type', [
		z.object({
			type: z.literal('solid'),
			color: colorSchema,
		}).strict(),
		linearGradientFillSchema(colorSchema),
	]);
}

function surfaceStyleSchema<C extends z.ZodType>(colorSchema: C) {
	return z.object({
		fill: fillSchema(colorSchema),
		fillOpacity: unit,
		outline: z.object({
			color: colorSchema,
			width: finite.min(0).max(500),
		}).strict().optional(),
		glow: z.object({
			color: colorSchema,
			size: finite.min(0).max(500),
			opacity: unit,
		}).strict().optional(),
	}).strict();
}

const shapeCornerSchema = z.object({
	treatment: z.enum(SHAPE_CORNER_TREATMENT_VALUES),
	size: finite.min(0).max(MAX_SHAPE_GEOMETRY_PX),
}).strict();
const shapeSlantSchema = finite.min(-MAX_SHAPE_GEOMETRY_PX).max(MAX_SHAPE_GEOMETRY_PX);

const themeShapeGeometrySchema = z.object({
	topLeft: shapeCornerSchema,
	topRight: shapeCornerSchema,
	bottomRight: shapeCornerSchema,
	bottomLeft: shapeCornerSchema,
	leftSlant: shapeSlantSchema,
	rightSlant: shapeSlantSchema,
}).strict();

const themeAnimationRecipeSchema = z.object({
	duration: finite.min(MIN_GRAPHIC_ANIMATION_DURATION_MS).max(MAX_GRAPHIC_ANIMATION_DURATION_MS),
	easing: z.enum(GRAPHIC_ANIMATION_EASING_VALUES),
	delay: finite.min(0).max(MAX_GRAPHIC_ANIMATION_DELAY_MS),
	fade: z.object({ opacity: unit }).strict().optional(),
	slide: z.object({
		direction: z.enum(GRAPHIC_SLIDE_DIRECTION_VALUES),
		distanceMode: z.enum(GRAPHIC_SLIDE_DISTANCE_MODE_VALUES),
		distance: finite.min(0).max(MAX_GRAPHIC_SLIDE_DISTANCE_PX),
	}).strict().optional(),
	scale: z.object({
		factor: finite.min(0).max(MAX_GRAPHIC_ANIMATION_SCALE),
		origin: z.enum(GRAPHIC_ANIMATION_ORIGIN_VALUES),
	}).strict().optional(),
	reveal: z.object({
		edge: z.enum(GRAPHIC_REVEAL_EDGE_VALUES),
	}).strict().optional(),
}).strict();

type CompositeSchemas = { [T in ThemeCompositeTokenType]: z.ZodType };

function compositeSchemas(colorSchema: z.ZodType): CompositeSchemas {
	return {
		'fill': fillSchema(colorSchema),
		'surface-style': surfaceStyleSchema(colorSchema),
		'shape-geometry': themeShapeGeometrySchema,
		'animation-recipe': themeAnimationRecipeSchema,
	};
}

/** What a write may store for a composite token of `type`: every colour a literal. */
export const THEME_COMPOSITE_VALUE_SCHEMAS = compositeSchemas(literalColorSchema);

/**
 * What a read accepts for a composite token of `type`: what a write stores,
 * and a colour naming a colour Foundation Token, as a value stored before
 * writes were literal-only may.
 */
export const STORED_THEME_COMPOSITE_VALUE_SCHEMAS = compositeSchemas(themeColorSchema);

/** Maps every colour of a fill, or answers undefined when one does. */
function mapFill<C, D>(fill: ThemeFill<C>, map: (color: C) => D | undefined): ThemeFill<D> | undefined {
	if (fill.type === 'solid') {
		const color = map(fill.color);
		return color === undefined
			? undefined
			: { type: 'solid', color };
	}
	const stops = [];
	for (const stop of fill.stops) {
		const color = map(stop.color);
		if (color === undefined)
			return undefined;
		stops.push({ ...stop, color });
	}
	return { ...fill, stops };
}

/** Maps every colour of a surface, or answers undefined when one does. */
function mapSurface<C, D>(surface: ThemeSurfaceStyle<C>, map: (color: C) => D | undefined): ThemeSurfaceStyle<D> | undefined {
	const fill = mapFill(surface.fill, map);
	if (fill === undefined)
		return undefined;
	const next: ThemeSurfaceStyle<D> = { fill, fillOpacity: surface.fillOpacity };
	if (surface.outline) {
		const color = map(surface.outline.color);
		if (color === undefined)
			return undefined;
		next.outline = { ...surface.outline, color };
	}
	if (surface.glow) {
		const color = map(surface.glow.color);
		if (color === undefined)
			return undefined;
		next.glow = { ...surface.glow, color };
	}
	return next;
}

/** Maps a Background Layer stack's colour layers, or answers undefined when one does (#831). */
function mapBackground<C, D>(layers: ThemeBackgroundLayer<C>[], map: (color: C) => D | undefined): ThemeBackgroundLayer<D>[] | undefined {
	const mapped: ThemeBackgroundLayer<D>[] = [];
	for (const layer of layers) {
		if (layer.type !== 'color') {
			mapped.push(layer);
			continue;
		}
		const color = map(layer.color);
		if (color === undefined)
			return undefined;
		mapped.push({ ...layer, color });
	}
	return mapped;
}

/**
 * A composite value with every colour it names resolved to a literal by
 * `resolveColor`, or undefined when one names nothing `resolveColor` can read,
 * so the read falls through to the next source. A value of any other type
 * holds no colours and is returned as it is.
 */
export function resolveThemeCompositeColors<V>(type: string, value: V, resolveColor: (name: string) => string | undefined): V | undefined {
	const read = (color: ThemeColor) => typeof color === 'string'
		? color
		: resolveColor(color.token);
	if (type === 'fill')
		return mapFill(value as ThemeFill, read) as V | undefined;
	if (type === 'surface-style')
		return mapSurface(value as ThemeSurfaceStyle, read) as V | undefined;
	if (type === 'backgroundLayers')
		return mapBackground(value as ThemeBackgroundLayer[], read) as V | undefined;
	return value;
}
