import { z } from 'zod';
import {
	GRAPHIC_FONT_STYLE_VALUES,
	GRAPHIC_TEXT_TRANSFORM_VALUES,
	MAX_GRAPHIC_FONT_SIZE,
	MAX_GRAPHIC_FONT_WEIGHT,
	MAX_GRAPHIC_LETTER_SPACING,
	MAX_GRAPHIC_LINE_HEIGHT,
	MAX_SHAPE_GEOMETRY_PX,
	MIN_GRAPHIC_FONT_WEIGHT,
	MIN_GRAPHIC_LETTER_SPACING,
	SHAPE_CORNER_TREATMENT_VALUES,
} from '~~/shared/types/graphics';

/**
 * Graphic values a Screen's graphics document and a Graphic Style Set both store.
 *
 * A Graphic Style Set Entry exists to be written into a graphics document, so its
 * value must be bounded exactly as the property it produces. One schema here, rather
 * than one per write surface, makes that true by construction instead of by
 * matching numbers — and keeps the Style Set schema from importing the Screen's.
 */

const finiteNumberSchema = z.number().finite();

const shapeCornerSchema = z.object({
	treatment: z.enum(SHAPE_CORNER_TREATMENT_VALUES),
	size: finiteNumberSchema.nonnegative().max(MAX_SHAPE_GEOMETRY_PX),
}).strict();
const shapeSlantSchema = finiteNumberSchema.min(-MAX_SHAPE_GEOMETRY_PX).max(MAX_SHAPE_GEOMETRY_PX);

export const shapeGeometrySchema = z.object({
	topLeft: shapeCornerSchema,
	topRight: shapeCornerSchema,
	bottomRight: shapeCornerSchema,
	bottomLeft: shapeCornerSchema,
	leftSlant: shapeSlantSchema,
	rightSlant: shapeSlantSchema,
}).strict();

/**
 * The bounded typography fields every typography owner shares.
 *
 * Fields rather than a schema: base typography, a Graphic Placeholder Style, and a
 * typography Graphic Style Set Entry differ by design in which font they may name,
 * whether colour is a value or a palette reference, which fields lay out the whole
 * block, and what is optional. Each composes its own object from these.
 */
export const graphicTypographyFields = {
	fontSize: finiteNumberSchema.positive().max(MAX_GRAPHIC_FONT_SIZE),
	fontWeight: finiteNumberSchema.int().min(MIN_GRAPHIC_FONT_WEIGHT).max(MAX_GRAPHIC_FONT_WEIGHT),
	fontStyle: z.enum(GRAPHIC_FONT_STYLE_VALUES),
	textTransform: z.enum(GRAPHIC_TEXT_TRANSFORM_VALUES),
	letterSpacing: finiteNumberSchema.min(MIN_GRAPHIC_LETTER_SPACING).max(MAX_GRAPHIC_LETTER_SPACING),
	lineHeight: finiteNumberSchema.positive().max(MAX_GRAPHIC_LINE_HEIGHT),
};
