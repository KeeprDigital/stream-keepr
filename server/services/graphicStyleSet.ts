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
 * change the Style Set, or do neither. They are issued as one D1 batch with the same
 * compare-and-swap conditions every ordinary write carries, so a concurrent edit to
 * any participant leaves the whole operation with nothing written rather than half
 * of it applied.
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
	 * The statements that rewrite one template's document as part of a library-wide
	 * operation.
	 *
	 * Each is conditional on the revision the operation read, so a template another
	 * author revised in the meantime contributes no change — and because the whole
	 * operation asserts afterwards that every statement changed exactly one row, one
	 * stale template refuses the entire deletion rather than leaving the library half
	 * rewritten. That is the "succeeds only if all template updates succeed" rule,
	 * enforced by the database rather than by ordering.
	 *
	 * The Graphic Asset References a template publishes are deliberately untouched: a
	 * Style Set carries no media, so no rewrite here can change which asset revisions
	 * a template pins.
	 */
	const templateRewriteStatements = (
		client: typeof db.$client,
		rewrites: readonly GraphicsTemplateRewrite[],
		styleSetId: string | null,
	) => rewrites.map(rewrite => client.prepare(`
		UPDATE broadcast_graphic_templates
		SET document = ?, revision = revision + 1, style_set_id = ?, style_set_revision = ?, updated_at = ?
		WHERE id = ? AND revision = ?
	`).bind(
		JSON.stringify(rewrite.document),
		rewrite.document.styleSet?.styleSetId ?? styleSetId,
		rewrite.document.styleSet?.revision ?? null,
		Date.now(),
		rewrite.id,
		rewrite.revision,
	));

	/** Every statement wrote exactly the one row it was aimed at. */
	function allApplied(results: readonly { meta: { changes?: number } }[]): boolean {
		return results.every(result => result.meta.changes === 1);
	}

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
		const results = await client.batch([
			client.prepare(`
				UPDATE graphic_style_sets
				SET draft = ?,
					published = ?,
					revision = CASE WHEN published IS NULL THEN revision ELSE revision + 1 END,
					draft_revision = draft_revision + 1,
					updated_at = ?
				WHERE id = ? AND draft_revision = ?
			`).bind(
				JSON.stringify(options.draft),
				options.published === null ? null : JSON.stringify(options.published),
				now,
				id,
				options.draftRevision,
			),
			...templateRewriteStatements(client, options.rewrites, id),
		]);

		if (!allApplied(results)) {
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
		const results = await client.batch([
			// The same rewrite statements every library-wide operation uses. Each detached
			// document carries no Style Set link, so they write a null link back — which is
			// the whole difference between deleting a Style Set and deleting one entry.
			...templateRewriteStatements(client, options.rewrites, null),
			client.prepare(`DELETE FROM graphic_style_sets WHERE id = ? AND draft_revision = ?`)
				.bind(id, options.draftRevision),
		]);

		return allApplied(results);
	};

	return { findAll, findById, linkedTemplates, create, update, publish, deleteEntry, remove };
}
