import { z } from 'zod';
import { GRAPHIC_FONT_IDS } from '~~/shared/modules/graphics';
import { MEDIA_GRAPHIC_ITEM_FIT_VALUES } from '~~/shared/types/graphicItem';
import {
	GRAPHIC_ANIMATION_EASING_VALUES,
	GRAPHIC_ANIMATION_ORIGIN_VALUES,
	GRAPHIC_ANIMATION_REPEAT_INDEFINITE,
	GRAPHIC_FONT_STYLE_VALUES,
	GRAPHIC_REVEAL_EDGE_VALUES,
	GRAPHIC_SLIDE_DIRECTION_VALUES,
	GRAPHIC_SLIDE_DISTANCE_MODE_VALUES,
	GRAPHIC_TEXT_TRANSFORM_VALUES,
	MAX_GRAPHIC_ANIMATION_DELAY_MS,
	MAX_GRAPHIC_ANIMATION_DURATION_MS,
	MAX_GRAPHIC_ANIMATION_PAUSE_MS,
	MAX_GRAPHIC_ANIMATION_REPEAT,
	MAX_GRAPHIC_ANIMATION_SCALE,
	MAX_GRAPHIC_FILL_STOPS,
	MAX_GRAPHIC_MEDIA_PLAYBACK_RATE,
	MAX_GRAPHIC_SLIDE_DISTANCE_PX,
	MIN_GRAPHIC_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_ANIMATION_REPEAT,
	MIN_GRAPHIC_FILL_STOPS,
	MIN_GRAPHIC_MEDIA_PLAYBACK_RATE,
	SHAPE_CORNER_TREATMENT_VALUES,
} from '~~/shared/types/graphics';
import {
	GRAPHIC_STYLE_ENTRY_SCHEMA_VERSION,
	GRAPHIC_STYLE_UPDATE_DECISION_VALUES,
	MAX_GRAPHIC_STYLE_SET_DESCRIPTION_LENGTH,
	MAX_GRAPHIC_STYLE_SET_ENTRIES,
	MAX_GRAPHIC_STYLE_SET_ENTRY_NAME_LENGTH,
	MAX_GRAPHIC_STYLE_SET_NAME_LENGTH,
} from '~~/shared/types/graphicStyleSet';

/**
 * The Graphic Style Set library's write surface.
 *
 * Every preset is bounded by the same numbers the property it produces is bounded
 * by. That is not a nicety: a Style Set entry's whole purpose is to be written into
 * a graphics document, so an entry outside the document's bounds would publish
 * cleanly and then make every template that referenced it unwritable. The bounds are
 * imported from the shared vocabulary for exactly that reason — one number, one
 * place, both schemas.
 *
 * Colour is a reference rather than a value in every preset that involves one, so
 * these schemas check entry ids where the item schemas check CSS colours. Whether
 * those ids resolve is not a shape question and is not asked here: a draft is edited
 * into existence in pieces and is referentially broken for most of that time.
 * Publish is what proves it whole.
 */

const finiteNumberSchema = z.number().finite();
const opacitySchema = finiteNumberSchema.min(0).max(1);
const nonNegativePixelSchema = finiteNumberSchema.nonnegative().max(10000);
const pixelPositionSchema = finiteNumberSchema.min(-10000).max(10000);
const cssColorSchema = z.string().min(1).max(500);

export const graphicStyleSetIdSchema = z.string().min(1).max(100);
const entryIdSchema = z.string().min(1).max(100);

const styleSetNameSchema = z.string().trim().min(1).max(MAX_GRAPHIC_STYLE_SET_NAME_LENGTH);
const styleSetDescriptionSchema = z.string().trim().max(MAX_GRAPHIC_STYLE_SET_DESCRIPTION_LENGTH);
const entryNameSchema = z.string().trim().min(1).max(MAX_GRAPHIC_STYLE_SET_ENTRY_NAME_LENGTH);

const paletteValueSchema = z.object({ color: cssColorSchema }).strict();

const typographyValueSchema = z.object({
	fontId: z.enum(GRAPHIC_FONT_IDS),
	fontSize: finiteNumberSchema.positive().max(600),
	fontWeight: finiteNumberSchema.int().min(1).max(1000),
	fontStyle: z.enum(GRAPHIC_FONT_STYLE_VALUES),
	textTransform: z.enum(GRAPHIC_TEXT_TRANSFORM_VALUES),
	letterSpacing: finiteNumberSchema.min(-20).max(100),
	lineHeight: finiteNumberSchema.positive().max(10),
	colorEntryId: entryIdSchema,
}).strict();

const fillValueSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('solid'), colorEntryId: entryIdSchema }).strict(),
	z.object({
		type: z.literal('linear-gradient'),
		angle: finiteNumberSchema.min(-360).max(360),
		stops: z.array(z.object({
			colorEntryId: entryIdSchema,
			position: opacitySchema,
			opacity: opacitySchema,
		}).strict()).min(MIN_GRAPHIC_FILL_STOPS).max(MAX_GRAPHIC_FILL_STOPS),
	}).strict(),
]);

const surfaceStyleValueSchema = z.object({
	fillEntryId: entryIdSchema.optional(),
	fillOpacity: opacitySchema,
	outline: z.object({
		colorEntryId: entryIdSchema,
		width: nonNegativePixelSchema.max(500),
	}).strict().optional(),
	glow: z.object({
		colorEntryId: entryIdSchema,
		size: nonNegativePixelSchema.max(500),
		opacity: opacitySchema,
	}).strict().optional(),
}).strict();

const shapeGeometryValueSchema = z.object({
	topLeft: z.object({ treatment: z.enum(SHAPE_CORNER_TREATMENT_VALUES), size: nonNegativePixelSchema }).strict(),
	topRight: z.object({ treatment: z.enum(SHAPE_CORNER_TREATMENT_VALUES), size: nonNegativePixelSchema }).strict(),
	bottomRight: z.object({ treatment: z.enum(SHAPE_CORNER_TREATMENT_VALUES), size: nonNegativePixelSchema }).strict(),
	bottomLeft: z.object({ treatment: z.enum(SHAPE_CORNER_TREATMENT_VALUES), size: nonNegativePixelSchema }).strict(),
	leftSlant: pixelPositionSchema,
	rightSlant: pixelPositionSchema,
}).strict();

const mediaTreatmentValueSchema = z.object({
	fit: z.enum(MEDIA_GRAPHIC_ITEM_FIT_VALUES),
	focalPosition: z.object({ horizontal: opacitySchema, vertical: opacitySchema }).strict(),
	opacity: opacitySchema,
	clipGeometryEntryId: entryIdSchema.optional(),
	playbackRate: finiteNumberSchema
		.min(MIN_GRAPHIC_MEDIA_PLAYBACK_RATE)
		.max(MAX_GRAPHIC_MEDIA_PLAYBACK_RATE)
		.optional(),
	loop: z.boolean().optional(),
}).strict();

const animationRecipeValueSchema = z.object({
	duration: finiteNumberSchema
		.min(MIN_GRAPHIC_ANIMATION_DURATION_MS)
		.max(MAX_GRAPHIC_ANIMATION_DURATION_MS),
	easing: z.enum(GRAPHIC_ANIMATION_EASING_VALUES),
	delay: finiteNumberSchema.nonnegative().max(MAX_GRAPHIC_ANIMATION_DELAY_MS).optional(),
	fade: z.object({ opacity: opacitySchema }).strict().optional(),
	slide: z.object({
		direction: z.enum(GRAPHIC_SLIDE_DIRECTION_VALUES),
		distanceMode: z.enum(GRAPHIC_SLIDE_DISTANCE_MODE_VALUES),
		distance: finiteNumberSchema.nonnegative().max(MAX_GRAPHIC_SLIDE_DISTANCE_PX),
	}).strict().optional(),
	scale: z.object({
		factor: finiteNumberSchema.min(0).max(MAX_GRAPHIC_ANIMATION_SCALE),
		origin: z.enum(GRAPHIC_ANIMATION_ORIGIN_VALUES),
	}).strict().optional(),
	reveal: z.object({ edge: z.enum(GRAPHIC_REVEAL_EDGE_VALUES) }).strict().optional(),
	pause: finiteNumberSchema.nonnegative().max(MAX_GRAPHIC_ANIMATION_PAUSE_MS).optional(),
	repeat: z.union([
		finiteNumberSchema.int().min(MIN_GRAPHIC_ANIMATION_REPEAT).max(MAX_GRAPHIC_ANIMATION_REPEAT),
		z.literal(GRAPHIC_ANIMATION_REPEAT_INDEFINITE),
	]).optional(),
}).strict();

/**
 * One entry, discriminated by kind.
 *
 * `schemaVersion` is accepted rather than assumed so a `.skstyle` package (#76) can
 * hand this schema what it carried, and is pinned to what this build reads: an entry
 * from a newer version is refused here rather than misread. It is not defaulted,
 * because a writer that does not state which shape its value is in has not said
 * enough for the value to be interpreted.
 */
const entryBase = {
	id: entryIdSchema,
	name: entryNameSchema,
	schemaVersion: z.literal(GRAPHIC_STYLE_ENTRY_SCHEMA_VERSION),
};

export const graphicStyleSetEntrySchema = z.discriminatedUnion('kind', [
	z.object({ ...entryBase, kind: z.literal('palette'), value: paletteValueSchema }).strict(),
	z.object({ ...entryBase, kind: z.literal('typography'), value: typographyValueSchema }).strict(),
	z.object({ ...entryBase, kind: z.literal('fill'), value: fillValueSchema }).strict(),
	z.object({ ...entryBase, kind: z.literal('surface-style'), value: surfaceStyleValueSchema }).strict(),
	z.object({ ...entryBase, kind: z.literal('media-treatment'), value: mediaTreatmentValueSchema }).strict(),
	z.object({ ...entryBase, kind: z.literal('shape-geometry'), value: shapeGeometryValueSchema }).strict(),
	z.object({ ...entryBase, kind: z.literal('animation-recipe'), value: animationRecipeValueSchema }).strict(),
]);

/**
 * A whole draft.
 *
 * Written whole rather than as a stream of entry operations. A draft is one JSON
 * document and its edits are unordered — an author adds a palette colour, renames a
 * preset, and deletes an unused one in any sequence — so a per-entry API would need
 * its own concurrency story on top of the one the Style Set already has. The
 * `revision` compare-and-swap on the write is that story.
 */
export const graphicStyleSetDraftSchema = z.array(graphicStyleSetEntrySchema)
	.max(
		MAX_GRAPHIC_STYLE_SET_ENTRIES,
		`A Graphic Style Set must not contain more than ${MAX_GRAPHIC_STYLE_SET_ENTRIES} entries`,
	)
	// Every reference, every template link, and every rename addresses an entry by id
	// alone, so a duplicate would make which one resolves undecided.
	.refine(
		entries => new Set(entries.map(entry => entry.id)).size === entries.length,
		'Graphic Style Set entry ids must be unique within one Style Set',
	);

/**
 * The frozen snapshot a `.skstyle` package carries.
 *
 * Read through the same entry schema every authored draft goes through, and not a
 * second copy of it. That identity is the point: a snapshot this accepts is one this
 * installation can store and publish, so an import cannot produce a Graphic Style Set
 * that fails the first time an author opens it. Its `revision` is positive because a
 * package only ever carries published entries — revision zero means never published,
 * and there would be nothing to freeze.
 */
export const graphicStyleSetSnapshotSchema = z.object({
	id: graphicStyleSetIdSchema,
	name: styleSetNameSchema,
	description: styleSetDescriptionSchema.nullable(),
	revision: z.number().int().positive(),
	entries: graphicStyleSetDraftSchema,
}).strict();

export const graphicStyleSetParamsSchema = z.object({
	styleSetId: graphicStyleSetIdSchema,
});

export const graphicStyleSetEntryParamsSchema = z.object({
	styleSetId: graphicStyleSetIdSchema,
	entryId: entryIdSchema,
});

export const createGraphicStyleSetSchema = z.object({
	name: styleSetNameSchema,
	description: styleSetDescriptionSchema.optional(),
	/** An initial draft, so an editor can create a populated Style Set in one step. */
	draft: graphicStyleSetDraftSchema.optional(),
}).strict();

/**
 * `revision` here is the *draft* revision, not the published one.
 *
 * A Style Set is edited by more than one author over a show week, and two of them
 * with the library open must not silently overwrite each other. It is required for
 * the same reason a template's is: an omissible precondition is an inert one.
 */
export const updateGraphicStyleSetSchema = z.object({
	name: styleSetNameSchema.optional(),
	description: styleSetDescriptionSchema.nullable().optional(),
	draft: graphicStyleSetDraftSchema.optional(),
	draftRevision: z.number().int().nonnegative(),
}).strict().refine(
	patch => Object.keys(patch).length > 1,
	'A Graphic Style Set write must change something',
);

export const publishGraphicStyleSetSchema = z.object({
	/** The draft revision the author reviewed, so a concurrent edit is not published blind. */
	draftRevision: z.number().int().nonnegative(),
}).strict();

/**
 * Deleting a whole Graphic Style Set.
 *
 * The draft revision alone, because there is no mode to choose between: replacing one
 * Style Set with another would mean matching entries across two independently authored
 * sets, so detaching every linked template is the only thing this can mean. It is still
 * a precondition rather than a formality — the deletion rewrites every one of those
 * templates, and a draft edit in between is somebody else's work.
 */
export const deleteGraphicStyleSetSchema = z.object({
	draftRevision: z.number().int().nonnegative(),
}).strict();

/**
 * Deleting one entry, and what happens to everything that references it.
 *
 * The mode is required and unguessable: replacing and detaching produce different
 * templates, and a default would pick one of them for an author who did not say.
 */
export const deleteGraphicStyleSetEntrySchema = z.discriminatedUnion('mode', [
	z.object({
		mode: z.literal('replace'),
		replacementEntryId: entryIdSchema,
		draftRevision: z.number().int().nonnegative(),
	}).strict(),
	z.object({
		mode: z.literal('detach'),
		draftRevision: z.number().int().nonnegative(),
	}).strict(),
]);

/**
 * Applying a Graphic Style Set update to one template.
 *
 * `decisions` names only the slots the author decided to keep as a local override;
 * everything else inherits. There is deliberately no "leave this one alone" — an
 * author cannot end up with inherited references spread across a mixture of Style
 * Set revisions, so every slot moves together in one new template revision.
 *
 * Both revisions are required, and `styleSetRevision` is the one that makes the
 * review mean anything. `decisions` is keyed by slot and says nothing about slots the
 * author never saw, so applying against a Style Set republished since the review
 * would take the default — inherit — for every one of them. That is precisely the
 * silent mutation the review exists to prevent, so the revision the author read is a
 * precondition rather than a hint.
 */
export const applyGraphicStyleUpdateSchema = z.object({
	revision: z.number().int().positive(),
	/** The Graphic Style Set's published revision, as the author reviewed it. */
	styleSetRevision: z.number().int().positive(),
	decisions: z.record(
		z.string().min(1).max(200),
		z.enum(GRAPHIC_STYLE_UPDATE_DECISION_VALUES),
	).optional(),
}).strict();

export type CreateGraphicStyleSetInput = z.infer<typeof createGraphicStyleSetSchema>;
export type UpdateGraphicStyleSetInput = z.infer<typeof updateGraphicStyleSetSchema>;
export type DeleteGraphicStyleSetEntryInput = z.infer<typeof deleteGraphicStyleSetEntrySchema>;
