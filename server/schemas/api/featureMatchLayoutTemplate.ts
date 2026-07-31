import { z } from 'zod';
import {
	MAX_FEATURE_MATCH_LAYOUT_TEMPLATE_DESCRIPTION_LENGTH,
	MAX_FEATURE_MATCH_LAYOUT_TEMPLATE_NAME_LENGTH,
} from '~~/shared/types/featureMatchLayoutTemplate';
import { featureMatchLayoutConfigSchema } from './screen';

/**
 * The Feature Match Layout Template library's write surface.
 *
 * A template document is validated by exactly the schema a Screen's own Feature
 * Match Overlay configuration is validated by. That identity is what makes placing
 * safe: a document the library accepted is a document the Screen write path will
 * accept, so a placement can never fail on the validity of what it places. It is
 * also the constraint an import inherits, since a layout may have been authored on
 * another installation.
 */

const templateNameSchema = z.string().trim().min(1).max(MAX_FEATURE_MATCH_LAYOUT_TEMPLATE_NAME_LENGTH);
const templateDescriptionSchema = z.string().trim().max(MAX_FEATURE_MATCH_LAYOUT_TEMPLATE_DESCRIPTION_LENGTH);

export const featureMatchLayoutTemplateParamsSchema = z.object({
	templateId: z.string().min(1).max(100),
});

/**
 * Saving names the Screen to copy the layout from rather than carrying it in the
 * body.
 *
 * The server reads the Screen it names, so the saved document is by construction
 * the layout the Screen actually holds — a client cannot save a layout the Screen
 * never accepted. It is also where "Event identities stripped" happens in fact
 * rather than in principle: the Screen's Feature Match Slot assignment is not part
 * of the layout and is never read here.
 */
export const saveFeatureMatchLayoutTemplateSchema = z.object({
	source: z.object({
		eventId: z.number().int().positive(),
		screenId: z.number().int().positive(),
	}).strict(),
	/** Absent takes the Screen's own name. */
	name: templateNameSchema.optional(),
	description: templateDescriptionSchema.optional(),
}).strict();

/**
 * `null` clears a description; an omitted field is left as it is.
 *
 * `revision` is the revision the author was looking at, and it is **required**: an
 * omissible precondition is an inert one, and a caller with no revision to state has
 * not read the template it is revising.
 */
export const updateFeatureMatchLayoutTemplateSchema = z.object({
	name: templateNameSchema.optional(),
	description: templateDescriptionSchema.nullable().optional(),
	document: featureMatchLayoutConfigSchema.optional(),
	revision: z.number().int().positive(),
}).strict().refine(
	patch => Object.keys(patch).length > 1,
	'A template revision must change something',
);

/**
 * Placing replaces the Screen's whole Feature Match Layout.
 *
 * There is nothing to merge and nothing to choose. A Feature Match Overlay renders
 * exactly one Feature Match Layout, so placing a template is not adding a design to
 * a stack the way placing a Broadcast Graphic is — it is replacing the one layout
 * the Screen has, Frame, Source Items, composition and all. `stateVersion` is
 * required for the same reason it is on a Broadcast Graphic placement: the write is
 * a read-modify-write of the Screen, and an absent version would mean unchecked.
 */
export const placeFeatureMatchLayoutTemplateSchema = z.object({
	templateId: z.string().min(1).max(100),
	stateVersion: z.number().int().nonnegative(),
}).strict();

export type SaveFeatureMatchLayoutTemplateInput = z.infer<typeof saveFeatureMatchLayoutTemplateSchema>;
export type UpdateFeatureMatchLayoutTemplateInput = z.infer<typeof updateFeatureMatchLayoutTemplateSchema>;
