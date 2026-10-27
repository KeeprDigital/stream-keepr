import type { DbBroadcastGraphicTemplate } from '~~/server/db/schema';
import type { IndexedGraphicAssetReferenceFacts } from '~~/server/modules/graphic-asset-reference-resolution';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { asc, eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { broadcastGraphicTemplates } from '~~/server/db/schema';
import {
	boundGraphicAssetReferenceFacts,
	jsonElementGraphicAssetRevisionResolution,
	REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE,
} from '~~/server/modules/graphic-asset-reference-resolution';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

/**
 * Storage for the installation's Broadcast Graphic Template library.
 *
 * Every write does two things at once: it stores the template and it republishes
 * the exact Graphic Asset Revisions that template references. They belong in one
 * operation for the same reason a Screen's do — a template whose document names a
 * revision the reference index does not know about is a template whose assets the
 * library believes nothing uses, and the Graphics Asset Library's retention is
 * entitled to act on that belief. The reference index is the authoritative record
 * of exact-revision usage, and a graphics Template is one of the artifacts the
 * glossary names as holding references, alongside Screens and placed graphics.
 *
 * Atomicity comes from the same one-shot token the Screen write path uses:
 * the row write stamps `graphic_asset_reference_version`, and every reference
 * statement in the batch is conditional on still reading it. A concurrent write
 * therefore either wins outright or contributes nothing, and no interleaving can
 * leave one template's document paired with another write's references.
 *
 * Every write, whatever it changes, also requires every reference the stored
 * document holds to resolve: an existing revision of an active Graphic Asset whose
 * kind fits its slot (#614). The route asks the library first, but the catalogue
 * can change before the commit, so the row write carries the rule itself and the
 * index insert reads the same rule from the same bound array. A template is stored
 * with every one of its references indexed, or not at all.
 */

const OWNER_KIND = 'broadcast-graphic-template';

export interface SaveBroadcastGraphicTemplate {
	id: string;
	name: string;
	description: string | null;
	document: BroadcastGraphicConfig;
}

export interface BroadcastGraphicTemplatePatch {
	name?: string;
	description?: string | null;
	document?: BroadcastGraphicConfig;
	/** The revision the writer read. The write is refused unless it is still current. */
	revision: number;
}

/** A revision the writer did not expect: someone else revised the template first. */
export class BroadcastGraphicTemplateRevisionConflict extends Error {
	constructor(readonly currentRevision: number) {
		super(`Broadcast Graphic Template is at revision ${currentRevision}`);
		this.name = 'BroadcastGraphicTemplateRevisionConflict';
	}
}

/**
 * A reference the template's document holds stopped resolving before the write
 * committed: its revision is gone, its asset was retired or trashed, or it is not
 * the kind its slot needs. The route checked it moments earlier, so the catalogue
 * moved underneath the save.
 */
export class BroadcastGraphicTemplateReferenceConflict extends Error {
	constructor() {
		super('A Graphic Asset Revision this Broadcast Graphic Template references can no longer be referenced');
		this.name = 'BroadcastGraphicTemplateReferenceConflict';
	}
}

/**
 * The exact revisions one template document references.
 *
 * Discovered by the same walk a Broadcast Graphics Screen's configuration is
 * discovered by, over a one-graphic stack: a template carries one Broadcast
 * Graphic, and its Media Graphic Items pin assets in exactly the way a placed
 * graphic's do. Sharing the walk is what guarantees a template and the copy placed
 * from it can never disagree about which assets they depend on.
 */
function templateAssetReferences(document: BroadcastGraphicConfig) {
	return broadcastGraphicsGraphicAssetReferences({
		graphics: [document],
	});
}

/**
 * The reference facts one template write is refused on and indexes.
 *
 * No reference is allowed to be retired, unlike a Screen's unchanged one: a
 * template has no retained-reference path (ADR-0034), so every write states every
 * reference as if it were new.
 */
function broadcastGraphicTemplateReferenceFacts(
	document: BroadcastGraphicConfig,
): IndexedGraphicAssetReferenceFacts[] {
	return templateAssetReferences(document).map(item => ({
		...item,
		id: crypto.randomUUID(),
		allowRetired: false,
	}));
}

/**
 * The reference-index statements one template write publishes.
 *
 * The insert reads the same bound array the row write's precondition reads, under
 * the same resolution rule, so the row commits only when every reference resolves
 * and then every reference is indexed. Both statements are conditional on the
 * stamp the row write makes, so they are no-ops whenever it did not commit.
 */
function broadcastGraphicTemplateIndexStatements(
	client: typeof db.$client,
	id: string,
	/** `broadcastGraphicTemplateReferenceFacts`, as `boundGraphicAssetReferenceFacts` encodes them. */
	referenceFacts: string,
	now: number,
	referenceVersion: string,
): D1PreparedStatement[] {
	const condition = {
		sql: 'EXISTS (SELECT 1 FROM broadcast_graphic_templates WHERE id = ? AND graphic_asset_reference_version = ?)',
		params: [id, referenceVersion],
	};
	return [
		client.prepare(`
			DELETE FROM graphic_asset_references
			WHERE owner_kind = '${OWNER_KIND}' AND owner_id = ?
				AND ${condition.sql}
		`).bind(id, ...condition.params),
		client.prepare(`
			INSERT INTO graphic_asset_references (
				id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
				event_id, created_at, updated_at
			)
			SELECT
				json_extract(item.value, '$.id'),
				json_extract(item.value, '$.assetId'),
				json_extract(item.value, '$.revisionId'),
				'${OWNER_KIND}', ?, json_extract(item.value, '$.ownerSlot'), NULL, ?, ?
			FROM json_each(?) AS item
			WHERE EXISTS (
				SELECT 1
				${jsonElementGraphicAssetRevisionResolution('item')}
			)
				AND ${condition.sql}
		`).bind(id, now, now, referenceFacts, ...condition.params),
	];
}

export function broadcastGraphicTemplateService() {
	const findAll = async (): Promise<DbBroadcastGraphicTemplate[]> => {
		return await db
			.select()
			.from(broadcastGraphicTemplates)
			.orderBy(asc(broadcastGraphicTemplates.name));
	};

	const findById = async (id: string): Promise<DbBroadcastGraphicTemplate | undefined> => {
		return await db.query.broadcastGraphicTemplates.findFirst({
			where: eq(broadcastGraphicTemplates.id, id),
		});
	};

	const referenceStatements = (
		client: typeof db.$client,
		id: string,
		referenceFacts: string,
		referenceVersion: string,
		now: number,
	): D1PreparedStatement[] => broadcastGraphicTemplateIndexStatements(
		client,
		id,
		referenceFacts,
		now,
		referenceVersion,
	);

	const create = async (input: SaveBroadcastGraphicTemplate): Promise<DbBroadcastGraphicTemplate> => {
		const referenceVersion = crypto.randomUUID();
		const now = Date.now();
		const referenceFacts = boundGraphicAssetReferenceFacts(broadcastGraphicTemplateReferenceFacts(input.document));
		const client = db.$client;

		const [inserted] = await client.batch([
			client.prepare(`
				INSERT INTO broadcast_graphic_templates (
					id, name, description, revision, document,
					graphic_asset_reference_version, created_at, updated_at
				)
				SELECT ?, ?, ?, 1, ?, ?, ?, ?
				WHERE 1 = 1
					${REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE}
			`).bind(
				input.id,
				input.name,
				input.description,
				JSON.stringify(input.document),
				referenceVersion,
				now,
				now,
				referenceFacts,
			),
			...referenceStatements(client, input.id, referenceFacts, referenceVersion, now),
		]);

		if (inserted?.meta.changes !== 1)
			throw new BroadcastGraphicTemplateReferenceConflict();

		const created = await findById(input.id);
		if (!created)
			throw new Error('Broadcast Graphic Template was not stored');
		return created;
	};

	/**
	 * One accepted edit: the merged fields, and the revision it earns.
	 *
	 * The revision advances for a name or description change as much as for a
	 * document change, because a library entry is what an author browses and its
	 * revision is what a Template Package's provenance names.
	 *
	 * The write is compare-and-swap: it applies only while the stored revision is still
	 * the one the writer read. The condition lives in the `UPDATE` itself rather than in
	 * a read-then-write, so two writers arriving at the same instant are ordered by the
	 * database and exactly one of them wins. There is no unconditional path — a caller
	 * that cannot state the revision it read has not read the template.
	 */
	const update = async (
		id: string,
		patch: BroadcastGraphicTemplatePatch,
	): Promise<DbBroadcastGraphicTemplate | undefined> => {
		const existing = await findById(id);
		if (!existing)
			return undefined;

		const document = patch.document ?? existing.document;
		const referenceVersion = crypto.randomUUID();
		const now = Date.now();
		const referenceFacts = boundGraphicAssetReferenceFacts(broadcastGraphicTemplateReferenceFacts(document));
		const client = db.$client;

		const [updated] = await client.batch([
			client.prepare(`
				UPDATE broadcast_graphic_templates
				SET name = ?, description = ?, document = ?, revision = revision + 1,
					graphic_asset_reference_version = ?, updated_at = ?
				WHERE id = ? AND revision = ?
					${REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE}
			`).bind(
				patch.name ?? existing.name,
				patch.description === undefined
					? existing.description
					: patch.description,
				JSON.stringify(document),
				referenceVersion,
				now,
				id,
				patch.revision,
				referenceFacts,
			),
			...referenceStatements(client, id, referenceFacts, referenceVersion, now),
		]);

		// Nothing written means a precondition failed. Its reference rows are
		// untouched, because every one of them is conditional on the stamp this write
		// never made. A revision that still stands means a reference refused it, not
		// another session — told apart so the author is not sent to re-read a template
		// nobody else changed.
		if (updated?.meta.changes !== 1) {
			const current = await findById(id);
			if (!current)
				return undefined;
			if (current.revision === patch.revision)
				throw new BroadcastGraphicTemplateReferenceConflict();
			throw new BroadcastGraphicTemplateRevisionConflict(current.revision);
		}

		return await findById(id);
	};

	/**
	 * Remove a template from the library.
	 *
	 * Its Graphic Asset References go with it, and nothing else does: copies already
	 * placed on Screens are independent Broadcast Graphics with their own authored
	 * references, so deleting the design they came from cannot reach them.
	 */
	const remove = async (id: string): Promise<boolean> => {
		const client = db.$client;
		const results = await client.batch([
			client.prepare(`
				DELETE FROM graphic_asset_references
				WHERE owner_kind = '${OWNER_KIND}' AND owner_id = ?
			`).bind(id),
			client.prepare(`DELETE FROM broadcast_graphic_templates WHERE id = ?`).bind(id),
		]);
		return results[1]?.meta.changes === 1;
	};

	return {
		findAll,
		findById,
		create,
		update,
		remove,
	};
}
