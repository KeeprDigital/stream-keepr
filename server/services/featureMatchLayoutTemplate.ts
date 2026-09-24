import type { DbFeatureMatchLayoutTemplate } from '~~/server/db/schema';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { asc, eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { featureMatchLayoutTemplates } from '~~/server/db/schema';
import { featureMatchLayoutGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

/**
 * Storage for the installation's Feature Match Layout Template library.
 *
 * The mirror of the Broadcast Graphic Template store, and deliberately the same
 * shape: every write stores the layout and republishes the exact Graphic Asset
 * Revisions it references, in one batch made atomic by the one-shot
 * `graphic_asset_reference_version` token. A template whose document names a
 * revision the reference index does not know about is a template whose assets the
 * Graphics Asset Library believes nothing uses, and its retention is entitled to act
 * on that belief.
 *
 * What differs is only what a layout is. There is no Graphic Style Set link to
 * denormalise, because nothing in a Feature Match Layout is a linked Style Set
 * property today, and the reference walk is the Feature Match Overlay one — the
 * Frame's background image as well as the composition's Media Graphic Items.
 */

const OWNER_KIND = 'feature-match-layout-template';

export interface SaveFeatureMatchLayoutTemplate {
	id: string;
	name: string;
	description: string | null;
	document: FeatureMatchLayoutConfig;
}

export interface FeatureMatchLayoutTemplatePatch {
	name?: string;
	description?: string | null;
	document?: FeatureMatchLayoutConfig;
	/** The revision the writer read. The write is refused unless it is still current. */
	revision: number;
}

/** A revision the writer did not expect: someone else revised the template first. */
export class FeatureMatchLayoutTemplateRevisionConflict extends Error {
	constructor(readonly currentRevision: number) {
		super(`Feature Match Layout Template is at revision ${currentRevision}`);
		this.name = 'FeatureMatchLayoutTemplateRevisionConflict';
	}
}

/**
 * The exact revisions one layout references.
 *
 * Discovered by the same walk a Feature Match Overlay Screen's configuration is
 * discovered by, so a template and the layout placed from it can never disagree
 * about which assets they depend on. Slots keep the `layout.` prefix that walk
 * publishes under: this store's rows are scoped by owner kind, so the prefix costs
 * nothing here and re-deriving it under a different name would make the two sets of
 * rows for one design incomparable.
 */
function templateAssetReferences(document: FeatureMatchLayoutConfig) {
	return featureMatchLayoutGraphicAssetReferences(document);
}

export function featureMatchLayoutTemplateService() {
	const findAll = async (): Promise<DbFeatureMatchLayoutTemplate[]> => {
		return await db
			.select()
			.from(featureMatchLayoutTemplates)
			.orderBy(asc(featureMatchLayoutTemplates.name));
	};

	const findById = async (id: string): Promise<DbFeatureMatchLayoutTemplate | undefined> => {
		return await db.query.featureMatchLayoutTemplates.findFirst({
			where: eq(featureMatchLayoutTemplates.id, id),
		});
	};

	/**
	 * The reference-index statements one template write publishes.
	 *
	 * A row is inserted only for a revision that exists, and deliberately without the
	 * lifecycle and compatibility conditions the Screen write path applies: a template
	 * pins revisions an author already selected, and a revision whose asset has since
	 * been retired keeps resolving.
	 */
	const referenceStatements = (
		client: typeof db.$client,
		id: string,
		document: FeatureMatchLayoutConfig,
		referenceVersion: string,
		now: number,
	): D1PreparedStatement[] => [
		client.prepare(`
			DELETE FROM graphic_asset_references
			WHERE owner_kind = '${OWNER_KIND}' AND owner_id = ?
				AND EXISTS (
					SELECT 1 FROM feature_match_layout_templates
					WHERE id = ? AND graphic_asset_reference_version = ?
				)
		`).bind(id, id, referenceVersion),
		...templateAssetReferences(document).map(item => client.prepare(`
			INSERT INTO graphic_asset_references (
				id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
				event_id, created_at, updated_at
			)
			SELECT ?, ?, ?, '${OWNER_KIND}', ?, ?, NULL, ?, ?
			FROM graphic_asset_revisions revision
			WHERE revision.id = ? AND revision.asset_id = ?
				AND EXISTS (
					SELECT 1 FROM feature_match_layout_templates
					WHERE id = ? AND graphic_asset_reference_version = ?
				)
		`).bind(
			crypto.randomUUID(),
			item.reference.assetId,
			item.reference.revisionId,
			id,
			item.ownerSlot,
			now,
			now,
			item.reference.revisionId,
			item.reference.assetId,
			id,
			referenceVersion,
		)),
	];

	const create = async (input: SaveFeatureMatchLayoutTemplate): Promise<DbFeatureMatchLayoutTemplate> => {
		const referenceVersion = crypto.randomUUID();
		const now = Date.now();
		const client = db.$client;

		await client.batch([
			client.prepare(`
				INSERT INTO feature_match_layout_templates (
					id, name, description, revision, document,
					graphic_asset_reference_version, created_at, updated_at
				)
				VALUES (?, ?, ?, 1, ?, ?, ?, ?)
			`).bind(
				input.id,
				input.name,
				input.description,
				JSON.stringify(input.document),
				referenceVersion,
				now,
				now,
			),
			...referenceStatements(client, input.id, input.document, referenceVersion, now),
		]);

		const created = await findById(input.id);
		if (!created)
			throw new Error('Feature Match Layout Template was not stored');
		return created;
	};

	/**
	 * One accepted edit: the merged fields, and the revision it earns.
	 *
	 * Compare-and-swap in the `UPDATE` itself rather than a read-then-write, so two
	 * writers arriving at the same instant are ordered by the database and exactly one
	 * of them wins. There is no unconditional path — a caller that cannot state the
	 * revision it read has not read the template.
	 */
	const update = async (
		id: string,
		patch: FeatureMatchLayoutTemplatePatch,
	): Promise<DbFeatureMatchLayoutTemplate | undefined> => {
		const existing = await findById(id);
		if (!existing)
			return undefined;

		const document = patch.document ?? existing.document;
		const referenceVersion = crypto.randomUUID();
		const now = Date.now();
		const client = db.$client;

		const [updated] = await client.batch([
			client.prepare(`
				UPDATE feature_match_layout_templates
				SET name = ?, description = ?, document = ?, revision = revision + 1,
					graphic_asset_reference_version = ?, updated_at = ?
				WHERE id = ? AND revision = ?
			`).bind(
				patch.name ?? existing.name,
				patch.description === undefined ? existing.description : patch.description,
				JSON.stringify(document),
				referenceVersion,
				now,
				id,
				patch.revision,
			),
			...referenceStatements(client, id, document, referenceVersion, now),
		]);

		// Nothing written means the precondition failed: the template is still there,
		// at a revision this writer did not expect. Its reference rows are untouched,
		// because every one of them is conditional on the stamp this write never made.
		if (updated?.meta.changes !== 1) {
			const current = await findById(id);
			if (!current)
				return undefined;
			throw new FeatureMatchLayoutTemplateRevisionConflict(current.revision);
		}

		return await findById(id);
	};

	/**
	 * Remove a template from the library.
	 *
	 * Its Graphic Asset References go with it, and nothing else does: a layout already
	 * placed on a Screen is an independent copy with its own authored references, so
	 * deleting the design it came from cannot reach it.
	 */
	const remove = async (id: string): Promise<boolean> => {
		const client = db.$client;
		const results = await client.batch([
			client.prepare(`
				DELETE FROM graphic_asset_references
				WHERE owner_kind = '${OWNER_KIND}' AND owner_id = ?
			`).bind(id),
			client.prepare(`DELETE FROM feature_match_layout_templates WHERE id = ?`).bind(id),
		]);
		return results[1]?.meta.changes === 1;
	};

	return { findAll, findById, create, update, remove };
}
