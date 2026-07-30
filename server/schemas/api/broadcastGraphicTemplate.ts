import { z } from 'zod';
import {
	MAX_BROADCAST_GRAPHIC_TEMPLATE_DESCRIPTION_LENGTH,
	MAX_BROADCAST_GRAPHIC_TEMPLATE_NAME_LENGTH,
} from '~~/shared/types/broadcastGraphicTemplate';
import { broadcastGraphicConfigSchema } from './screen';

/**
 * The Broadcast Graphic Template library's write surface.
 *
 * A template document is validated by exactly the schema a Screen's authored stack
 * is validated by — the same Graphic Item vocabulary, the same per-graphic caps,
 * the same Graphic Item id uniqueness. That identity is what makes placement safe:
 * a document the library accepted is a document the Screen's own write path will
 * accept, so a placement can never fail on the validity of what it is placing.
 *
 * It is also the constraint an import inherits. A template document may have been
 * authored on another installation, so every bound this schema states is a bound on
 * what can be brought in — most sharply the Graphic Item id length, which is why
 * tightening it stops being free once templates exist.
 */

const templateNameSchema = z.string().trim().min(1).max(MAX_BROADCAST_GRAPHIC_TEMPLATE_NAME_LENGTH);
const templateDescriptionSchema = z.string().trim().max(MAX_BROADCAST_GRAPHIC_TEMPLATE_DESCRIPTION_LENGTH);

export const broadcastGraphicTemplateParamsSchema = z.object({
	templateId: z.string().min(1).max(100),
});

/**
 * Saving names the placed Broadcast Graphic to copy rather than carrying its
 * composition in the body.
 *
 * The server reads the Screen it names, so the saved document is by construction
 * the configuration the Screen actually holds — a client cannot save a composition
 * the Screen never accepted, and there is no second copy of the Graphic Item
 * vocabulary on the way in.
 */
export const saveBroadcastGraphicTemplateSchema = z.object({
	source: z.object({
		eventId: z.number().int().positive(),
		screenId: z.number().int().positive(),
		graphicId: z.string().min(1).max(100),
	}).strict(),
	/** Absent takes the Broadcast Graphic's own name. */
	name: templateNameSchema.optional(),
	description: templateDescriptionSchema.optional(),
}).strict();

/**
 * `null` clears a description; an omitted field is left as it is.
 *
 * `revision` is the revision the author was looking at, and it is how a library
 * write gets optimistic concurrency without pretending to be an editing session. A
 * template revision is a single-shot write — rename, describe, replace the document
 * — so the control it needs is compare-and-swap, not a lease: two authors who both
 * open the library and rename the same entry must not silently overwrite each other,
 * and the second one should be told to look again. Omitting it accepts the write
 * unconditionally, for a caller that has no revision to state.
 */
export const updateBroadcastGraphicTemplateSchema = z.object({
	name: templateNameSchema.optional(),
	description: templateDescriptionSchema.nullable().optional(),
	document: broadcastGraphicConfigSchema.optional(),
	revision: z.number().int().positive().optional(),
}).strict().refine(
	patch => Object.keys(patch).length > 0,
	'A template revision must change something',
);

export const placeBroadcastGraphicTemplateSchema = z.object({
	templateId: z.string().min(1).max(100),
	/**
	 * The Screen state version the author was looking at, so a placement built on a
	 * stale stack is refused rather than silently discarding a concurrent change.
	 */
	stateVersion: z.number().int().nonnegative().optional(),
}).strict();

export type SaveBroadcastGraphicTemplateInput = z.infer<typeof saveBroadcastGraphicTemplateSchema>;
export type UpdateBroadcastGraphicTemplateInput = z.infer<typeof updateBroadcastGraphicTemplateSchema>;
