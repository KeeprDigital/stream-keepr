import type { D1PreparedStatement } from '@cloudflare/workers-types';
import type { DbBroadcastGraphicTemplate } from '~~/server/db/schema';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { asc, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { broadcastGraphicTemplates } from '~~/server/db/schema';
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
 * The exact revisions one template document references.
 *
 * Discovered by the same walk a Broadcast Graphics Screen's configuration is
 * discovered by, over a one-graphic stack: a template carries one Broadcast
 * Graphic, and its Media Graphic Items pin assets in exactly the way a placed
 * graphic's do. Sharing the walk is what guarantees a template and the copy placed
 * from it can never disagree about which assets they depend on.
 */
function templateAssetReferences(document: BroadcastGraphicConfig) {
	return broadcastGraphicsGraphicAssetReferences({ graphics: [document] });
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

	/**
	 * The reference-index statements one template write publishes.
	 *
	 * A row is inserted only for a revision that exists, and deliberately without
	 * the lifecycle and compatibility conditions the Screen write path applies: a
	 * template pins revisions an author already selected, and a revision whose asset
	 * has since been retired keeps resolving. Refusing to record it would quietly
	 * drop the template's claim on content it still depends on, which is the opposite
	 * of what the index is for.
	 */
	const referenceStatements = (
		client: typeof db.$client,
		id: string,
		document: BroadcastGraphicConfig,
		referenceVersion: string,
		now: number,
	): D1PreparedStatement[] => [
		client.prepare(`
			DELETE FROM graphic_asset_references
			WHERE owner_kind = '${OWNER_KIND}' AND owner_id = ?
				AND EXISTS (
					SELECT 1 FROM broadcast_graphic_templates
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
					SELECT 1 FROM broadcast_graphic_templates
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

	/**
	 * Adopt one installed Template Package result into the library, once.
	 *
	 * The entry takes the Installed Graphics Template's own identity, so this is
	 * idempotent on the primary key rather than on a separate marker: a repeated
	 * installation request reaches adoption again over the same Installed Graphics
	 * Template and must leave one library entry, not two.
	 *
	 * Skipping is a condition inside the insert rather than a read-then-write, and
	 * the reference statements are conditional on the stamp this insert would have
	 * made — so a skipped adoption contributes nothing at all, including no second
	 * set of Graphic Asset References that would double the usage protecting every
	 * revision the design pins.
	 *
	 * The document arrives already rewritten to exact local identities and revisions
	 * by the installation that published it, so the references this publishes are
	 * local from the first byte. It is an unlinked copy: the source identity and
	 * revision are stored beside it as provenance and nothing reads them back.
	 */
	const adoptInstalled = async (input: SaveBroadcastGraphicTemplate & {
		sourceTemplateIdentity: string;
		sourceTemplateRevision: number | null;
	}): Promise<DbBroadcastGraphicTemplate> => {
		const referenceVersion = crypto.randomUUID();
		const now = Date.now();
		const client = db.$client;

		await client.batch([
			client.prepare(`
				INSERT INTO broadcast_graphic_templates (
					id, name, description, revision, document,
					source_template_identity, source_template_revision,
					graphic_asset_reference_version, created_at, updated_at
				)
				SELECT ?, ?, ?, 1, ?, ?, ?, ?, ?, ?
				WHERE NOT EXISTS (
					SELECT 1 FROM broadcast_graphic_templates WHERE id = ?
				)
			`).bind(
				input.id,
				input.name,
				input.description,
				JSON.stringify(input.document),
				input.sourceTemplateIdentity,
				input.sourceTemplateRevision,
				referenceVersion,
				now,
				now,
				input.id,
			),
			...referenceStatements(client, input.id, input.document, referenceVersion, now),
		]);

		const adopted = await findById(input.id);
		if (!adopted)
			throw new Error('Imported Broadcast Graphic Template was not stored');
		return adopted;
	};

	const create = async (input: SaveBroadcastGraphicTemplate): Promise<DbBroadcastGraphicTemplate> => {
		const referenceVersion = crypto.randomUUID();
		const now = Date.now();
		const client = db.$client;

		await client.batch([
			client.prepare(`
				INSERT INTO broadcast_graphic_templates (
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
		const client = db.$client;

		const [updated] = await client.batch([
			client.prepare(`
				UPDATE broadcast_graphic_templates
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

	return { findAll, findById, create, adoptInstalled, update, remove };
}
