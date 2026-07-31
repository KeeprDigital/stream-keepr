import type { DbBroadcastGraphicTemplate, DbGraphicStyleSet } from '~~/server/db/schema';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { GraphicStyleSetEntry } from '~~/shared/types/graphicStyleSet';
import { asc, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { broadcastGraphicTemplates, graphicStyleSets } from '~~/server/db/schema';

/**
 * Storage for the installation's Graphic Style Set library.
 *
 * Two things make this more than a table with JSON in it.
 *
 * **The draft is guarded, the published revision is produced.** Every draft write
 * compare-and-swaps on `draft_revision`, so two authors with the library open are
 * ordered by the database rather than by luck. Publishing is a separate write that
 * copies the draft into `published` and advances `revision` — the number a linked
 * template records as its provenance.
 *
 * **Some operations span the library.** Deleting an entry other templates reference,
 * and deleting a whole Style Set, both have to rewrite every affected template *and*
 * change the Style Set, or do neither. They are issued as one D1 batch whose first
 * statement carries *every* participant's compare-and-swap condition and stamps
 * `operation_version`, with every later statement guarded on that stamp, so a
 * concurrent edit to any participant leaves the whole operation with nothing written
 * rather than half of it applied.
 */

export interface SaveGraphicStyleSet {
	id: string;
	name: string;
	description: string | null;
	draft: GraphicStyleSetEntry[];
}

export interface GraphicStyleSetPatch {
	name?: string;
	description?: string | null;
	draft?: GraphicStyleSetEntry[];
	/** The draft revision the writer read. The write is refused unless it is still current. */
	draftRevision: number;
}

/** A draft revision the writer did not expect: someone else edited the draft first. */
export class GraphicStyleSetRevisionConflict extends Error {
	constructor(readonly currentDraftRevision: number) {
		super(`Graphic Style Set is at draft revision ${currentDraftRevision}`);
		this.name = 'GraphicStyleSetRevisionConflict';
	}
}

/** One template a library-wide operation rewrites, with the revision it was read at. */
export interface GraphicsTemplateRewrite {
	id: string;
	document: BroadcastGraphicConfig;
	revision: number;
}

export function graphicStyleSetService() {
	const findAll = async (): Promise<DbGraphicStyleSet[]> => {
		return await db.select().from(graphicStyleSets).orderBy(asc(graphicStyleSets.name));
	};

	const findById = async (id: string): Promise<DbGraphicStyleSet | undefined> => {
		return await db.query.graphicStyleSets.findFirst({ where: eq(graphicStyleSets.id, id) });
	};

	/**
	 * Every Broadcast Graphic Template linked to this Style Set.
	 *
	 * Read from the denormalised column rather than by walking documents, which is what
	 * makes one publish cost the number of *linked* templates rather than the size of
	 * the whole library.
	 */
	const linkedTemplates = async (styleSetId: string): Promise<DbBroadcastGraphicTemplate[]> => {
		return await db
			.select()
			.from(broadcastGraphicTemplates)
			.where(eq(broadcastGraphicTemplates.styleSetId, styleSetId))
			.orderBy(asc(broadcastGraphicTemplates.name));
	};

	const create = async (input: SaveGraphicStyleSet): Promise<DbGraphicStyleSet> => {
		const now = new Date();
		await db.insert(graphicStyleSets).values({
			id: input.id,
			name: input.name,
			description: input.description,
			revision: 0,
			draftRevision: 1,
			draft: input.draft,
			published: null,
			publishedAt: null,
			createdAt: now,
			updatedAt: now,
		});

		const created = await findById(input.id);
		if (!created)
			throw new Error('Graphic Style Set was not stored');
		return created;
	};

	/**
	 * One accepted draft edit.
	 *
	 * Compare-and-swap in the `UPDATE` itself rather than a read-then-write, so two
	 * writers arriving at the same instant are ordered by the database and exactly one
	 * wins. Nothing here touches `published`: a draft edit is invisible to every
	 * linked template until an author publishes.
	 */
	const update = async (
		id: string,
		patch: GraphicStyleSetPatch,
	): Promise<DbGraphicStyleSet | undefined> => {
		const existing = await findById(id);
		if (!existing)
			return undefined;

		const client = db.$client;
		const [updated] = await client.batch([
			client.prepare(`
				UPDATE graphic_style_sets
				SET name = ?, description = ?, draft = ?, draft_revision = draft_revision + 1, updated_at = ?
				WHERE id = ? AND draft_revision = ?
			`).bind(
				patch.name ?? existing.name,
				patch.description === undefined ? existing.description : patch.description,
				JSON.stringify(patch.draft ?? existing.draft),
				Date.now(),
				id,
				patch.draftRevision,
			),
		]);

		if (updated?.meta.changes !== 1) {
			const current = await findById(id);
			if (!current)
				return undefined;
			throw new GraphicStyleSetRevisionConflict(current.draftRevision);
		}

		return await findById(id);
	};

	/**
	 * Publish the working draft as a new revision.
	 *
	 * The caller has already validated the draft and worked out which templates it
	 * affects; this only performs the write, still conditional on the draft revision
	 * the author reviewed. A publish that raced a draft edit would otherwise publish
	 * entries nobody validated.
	 */
	const publish = async (id: string, draftRevision: number): Promise<DbGraphicStyleSet | undefined> => {
		const existing = await findById(id);
		if (!existing)
			return undefined;

		const client = db.$client;
		const now = Date.now();
		const [updated] = await client.batch([
			client.prepare(`
				UPDATE graphic_style_sets
				SET published = draft,
					revision = revision + 1,
					draft_revision = draft_revision + 1,
					published_at = ?,
					updated_at = ?
				WHERE id = ? AND draft_revision = ?
			`).bind(now, now, id, draftRevision),
		]);

		if (updated?.meta.changes !== 1) {
			const current = await findById(id);
			if (!current)
				return undefined;
			throw new GraphicStyleSetRevisionConflict(current.draftRevision);
		}

		return await findById(id);
	};

	/**
	 * Create one Graphic Style Set already published at the entries and revision given.
	 *
	 * The only writer of this is a `.skstyle` installation, and it is separate from
	 * {@link create} because the two disagree about the one thing that matters: an
	 * authored Style Set starts at revision zero and becomes publishable, while an
	 * imported one arrives *already published* and preserves the revision its package
	 * declared. That preservation is the whole mechanism by which a later package of the
	 * same Style Set can be recognised as a newer revision of this one rather than as an
	 * unrelated import.
	 *
	 * The draft is seeded with the same entries, so the Style Set opens with no
	 * unpublished changes and the first thing an author does to it is an edit rather
	 * than a reconciliation.
	 *
	 * Conditional on the identity being free, for the same reason
	 * {@link republishFromPackage} is conditional on a revision: preflight decided this
	 * identity was unheld, and a concurrent install of the same package — or an author
	 * creating a Style Set — could claim it before this statement runs. An unconditional
	 * insert would answer that race with a primary-key violation, which is the modelled
	 * conflict escaping as a crash. Resolves undefined instead, and the caller reports
	 * the conflict its sibling dispositions already report.
	 */
	const createPublished = async (input: {
		id: string;
		name: string;
		description: string | null;
		revision: number;
		entries: GraphicStyleSetEntry[];
	}): Promise<DbGraphicStyleSet | undefined> => {
		const client = db.$client;
		const now = Date.now();
		const entries = JSON.stringify(input.entries);
		// `WHERE NOT EXISTS` rather than `INSERT OR IGNORE`, which would swallow every
		// other constraint this row has as silently as it swallows a taken identity.
		const [inserted] = await client.batch([
			client.prepare(`
				INSERT INTO graphic_style_sets
					(id, name, description, revision, draft_revision, draft, published, published_at, created_at, updated_at)
				SELECT ?, ?, ?, ?, 1, ?, ?, ?, ?, ?
				WHERE NOT EXISTS (SELECT 1 FROM graphic_style_sets WHERE id = ?)
			`).bind(
				input.id,
				input.name,
				input.description,
				input.revision,
				entries,
				entries,
				now,
				now,
				now,
				input.id,
			),
		]);

		if (inserted?.meta.changes !== 1)
			return undefined;

		const created = await findById(input.id);
		if (!created)
			throw new Error('Graphic Style Set was not stored');
		return created;
	};

	/**
	 * Publish packaged entries over an installed Graphic Style Set at an exact revision.
	 *
	 * Conditional on both revisions the proposal was decided against. The published
	 * revision is the one the author was told they were updating from, and the draft
	 * revision is what makes a concurrent draft edit refuse the write rather than have
	 * it discarded — an import that overwrote somebody's working draft would be
	 * field-merging two Style Sets by omission.
	 *
	 * `revision` is set to the packaged revision rather than incremented, so the two
	 * installations stay on the same numbering and a third package can still be
	 * recognised against either of them. Nothing else is written: every linked template
	 * is offered the change as an available style update to review, exactly as an
	 * ordinary publish leaves them.
	 */
	const republishFromPackage = async (input: {
		id: string;
		revision: number;
		entries: GraphicStyleSetEntry[];
		expectedRevision: number;
		expectedDraftRevision: number;
	}): Promise<DbGraphicStyleSet | undefined> => {
		const client = db.$client;
		const now = Date.now();
		const [updated] = await client.batch([
			client.prepare(`
				UPDATE graphic_style_sets
				SET draft = ?,
					published = ?,
					revision = ?,
					draft_revision = draft_revision + 1,
					published_at = ?,
					updated_at = ?
				WHERE id = ? AND revision = ? AND draft_revision = ?
			`).bind(
				JSON.stringify(input.entries),
				JSON.stringify(input.entries),
				input.revision,
				now,
				now,
				input.id,
				input.expectedRevision,
				input.expectedDraftRevision,
			),
		]);

		// A write that matched nothing wrote nothing. The Style Set moved under the
		// report, so the caller reports a conflict rather than retrying blind.
		if (updated?.meta.changes !== 1)
			return undefined;

		return await findById(input.id);
	};

	/**
	 * The precondition, stated on the operation's *first* statement, that every
	 * template it is about to rewrite is still at the revision it was read at.
	 *
	 * It lives here rather than on each template's own statement because a conditional
	 * `UPDATE` matching no row is not an error and does not roll a D1 batch back. A
	 * per-statement condition would therefore let a stale template be skipped while
	 * everything else in the batch committed — for a Style Set deletion, a template
	 * left referencing entries that exist nowhere, whose every future save is then
	 * refused. Asserting all of it up front is what makes the stamp meaningful.
	 */
	const templatePreconditions = (rewrites: readonly GraphicsTemplateRewrite[]) =>
		rewrites.map(() => `
			AND EXISTS (SELECT 1 FROM broadcast_graphic_templates WHERE id = ? AND revision = ?)
		`).join('');

	const templatePreconditionBindings = (rewrites: readonly GraphicsTemplateRewrite[]) =>
		rewrites.flatMap(rewrite => [rewrite.id, rewrite.revision]);

	/**
	 * The statements that rewrite one template's document as part of a library-wide
	 * operation.
	 *
	 * Each is conditional on the stamp the operation's first statement wrote, and that
	 * statement only wrote it if every participant — the Style Set row and every one of
	 * these templates — was still at the revision the operation read. So a template
	 * another author revised in the meantime makes all of these no-ops rather than
	 * leaving the library half rewritten. That is the "succeeds only if all template
	 * updates succeed" rule, enforced by the database rather than by ordering.
	 *
	 * The revision each statement also carries is the same fact stated twice, and it
	 * stays because a rewrite that ever ran against an unexpected revision should write
	 * nothing on its own terms too.
	 *
	 * The Graphic Asset References a template publishes are deliberately untouched: a
	 * Style Set carries no media, so no rewrite here can change which asset revisions
	 * a template pins.
	 */
	const templateRewriteStatements = (
		client: typeof db.$client,
		rewrites: readonly GraphicsTemplateRewrite[],
		/** The link a rewritten document that carries none falls back to: null detaches. */
		linkedStyleSetId: string | null,
		operation: { styleSetId: string; version: string },
	) => rewrites.map(rewrite => client.prepare(`
		UPDATE broadcast_graphic_templates
		SET document = ?, revision = revision + 1, style_set_id = ?, style_set_revision = ?, updated_at = ?
		WHERE id = ? AND revision = ?
			AND EXISTS (
				SELECT 1 FROM graphic_style_sets WHERE id = ? AND operation_version = ?
			)
	`).bind(
		JSON.stringify(rewrite.document),
		rewrite.document.styleSet?.styleSetId ?? linkedStyleSetId,
		rewrite.document.styleSet?.revision ?? null,
		Date.now(),
		rewrite.id,
		rewrite.revision,
		operation.styleSetId,
		operation.version,
	));

	/**
	 * Delete one entry from a Style Set and rewrite every template it reached, as one
	 * operation.
	 *
	 * The entry is removed from the draft *and* from the published entries. Leaving it
	 * published would keep every linked template resolving against something the
	 * author has deleted, so the deletion would not have happened as far as any
	 * template was concerned. That is also why this advances the published revision:
	 * it changes what the published Style Set contains.
	 */
	const deleteEntry = async (
		id: string,
		options: {
			draftRevision: number;
			draft: GraphicStyleSetEntry[];
			published: GraphicStyleSetEntry[] | null;
			rewrites: readonly GraphicsTemplateRewrite[];
		},
	): Promise<DbGraphicStyleSet | undefined> => {
		const existing = await findById(id);
		if (!existing)
			return undefined;

		const client = db.$client;
		const now = Date.now();
		const operation = { styleSetId: id, version: crypto.randomUUID() };
		const [changed] = await client.batch([
			client.prepare(`
				UPDATE graphic_style_sets
				SET draft = ?,
					published = ?,
					revision = CASE WHEN published IS NULL THEN revision ELSE revision + 1 END,
					draft_revision = draft_revision + 1,
					operation_version = ?,
					updated_at = ?
				WHERE id = ? AND draft_revision = ?
					${templatePreconditions(options.rewrites)}
			`).bind(
				JSON.stringify(options.draft),
				options.published === null ? null : JSON.stringify(options.published),
				operation.version,
				now,
				id,
				options.draftRevision,
				...templatePreconditionBindings(options.rewrites),
			),
			...templateRewriteStatements(client, options.rewrites, id, operation),
		]);

		// Nothing written means a precondition failed — this row's draft revision or one
		// of the templates'. Every rewrite behind it is conditional on the stamp this
		// statement never made, so the whole deletion wrote nothing.
		if (changed?.meta.changes !== 1) {
			const current = await findById(id);
			throw new GraphicStyleSetRevisionConflict(current?.draftRevision ?? options.draftRevision);
		}

		return await findById(id);
	};

	/**
	 * Delete a whole Style Set, detaching every template linked to it in the same
	 * operation.
	 *
	 * Detaching is not a cascade: each template gets a real new revision whose document
	 * carries the values it was already rendering, with the provenance removed. A
	 * cascade that nulled the column would leave every template's items referencing
	 * entries that no longer exist anywhere.
	 */
	const remove = async (
		id: string,
		options: { draftRevision: number; rewrites: readonly GraphicsTemplateRewrite[] },
	): Promise<boolean> => {
		const client = db.$client;
		const operation = { styleSetId: id, version: crypto.randomUUID() };
		const results = await client.batch([
			// Every precondition the whole operation has, on one statement, before anything
			// is written. The row is about to be deleted, so this changes nothing else about
			// it — it exists to stamp, and to refuse.
			client.prepare(`
				UPDATE graphic_style_sets
				SET operation_version = ?, updated_at = ?
				WHERE id = ? AND draft_revision = ?
					${templatePreconditions(options.rewrites)}
			`).bind(
				operation.version,
				Date.now(),
				id,
				options.draftRevision,
				...templatePreconditionBindings(options.rewrites),
			),
			// The same rewrite statements every library-wide operation uses. Each detached
			// document carries no Style Set link, so they write a null link back — which is
			// the whole difference between deleting a Style Set and deleting one entry.
			...templateRewriteStatements(client, options.rewrites, null, operation),
			// Guarded on the stamp rather than on the draft revision, so the deletion cannot
			// commit behind template rewrites that did not happen. This is the corruption the
			// stamp exists to prevent: a deleted Style Set whose templates still reference its
			// entries would leave every one of them unable to be saved again.
			client.prepare(`DELETE FROM graphic_style_sets WHERE id = ? AND operation_version = ?`)
				.bind(id, operation.version),
		]);

		return results.at(-1)?.meta.changes === 1;
	};

	return {
		findAll,
		findById,
		linkedTemplates,
		create,
		createPublished,
		republishFromPackage,
		update,
		publish,
		deleteEntry,
		remove,
	};
}
