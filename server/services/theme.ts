import type { DbTheme } from '~~/server/db/schema';
import type { EventUsingTheme } from '~~/shared/types/theme';
import type { ScreenGraphicAssetReference } from '~~/shared/utils/graphicsAssetReferences';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { events, themes } from '~~/server/db/schema';
import {
	boundGraphicAssetReferenceFacts,
	jsonElementGraphicAssetRevisionResolution,
	REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE,
} from '~~/server/modules/graphic-asset-reference-resolution';

/** A Theme delete refused because Events use it. */
export class ThemeInUseError extends Error {
	constructor(readonly events: EventUsingTheme[]) {
		super('Theme is in use');
		this.name = 'ThemeInUseError';
	}
}

/**
 * A token write refused because a Graphic Asset Revision its value names
 * stopped being selectable before the commit (ADR-0034's fence, ADR-0050).
 */
export class ThemeAssetReferenceConflict extends Error {
	constructor() {
		super('A Graphic Asset Revision this value names is not selectable');
		this.name = 'ThemeAssetReferenceConflict';
	}
}

/** The owner kind a Theme's Graphic Asset References are indexed under. */
export const THEME_REFERENCE_OWNER_KIND = 'theme';

/** The JSON path of one token in the stored map. A token name is a vocabulary name, so it needs no escaping. */
function tokenPath(name: string): string {
	return `$."${name}"`;
}

/**
 * Storage for the installation's Theme library.
 *
 * A token write is one statement that edits only its own key of the stored map
 * and advances the revision, so two writers setting different tokens of one
 * Theme never lose each other's value, and two setting the same token are
 * ordered by the database: the last write wins (ADR-0049).
 */
export function themeService() {
	async function findAll(): Promise<DbTheme[]> {
		return await db.select().from(themes).orderBy(asc(themes.name), asc(themes.id));
	}

	async function findById(id: string): Promise<DbTheme | undefined> {
		const [theme] = await db.select().from(themes).where(eq(themes.id, id));
		return theme;
	}

	async function create(input: { id: string; name: string }): Promise<DbTheme> {
		const [theme] = await db.insert(themes).values({ ...input, tokens: {} }).returning();
		return theme!;
	}

	async function rename(id: string, name: string): Promise<DbTheme | undefined> {
		const [theme] = await db.update(themes)
			.set({
				name,
				updatedAt: new Date(),
			})
			.where(eq(themes.id, id))
			.returning();
		return theme;
	}

	/**
	 * Write one token and its Graphic Asset Reference index together: the
	 * token's own slots are replaced by `references`, which must each resolve
	 * in the statement that commits, or nothing is written (ADR-0050). A clear
	 * passes no value and releases every reference the token held.
	 */
	async function writeToken(
		id: string,
		name: string,
		value: { set: unknown } | null,
		references: readonly ScreenGraphicAssetReference[],
	): Promise<{ theme: DbTheme; written: boolean } | undefined> {
		const path = tokenPath(name);
		const referenceVersion = crypto.randomUUID();
		const now = Date.now();
		const boundFacts = boundGraphicAssetReferenceFacts(references.map(item => ({
			...item,
			id: crypto.randomUUID(),
			allowRetired: false,
		})));
		const client = db.$client;
		const versionGuard = `
			AND EXISTS (
				SELECT 1 FROM themes WHERE id = ? AND graphic_asset_reference_version = ?
			)
		`;
		const [written] = await client.batch([
			value
				? client.prepare(`
					UPDATE themes
					SET tokens = json_set(tokens, ?, json(?)), revision = revision + 1,
						graphic_asset_reference_version = ?, updated_at = ?
					WHERE id = ?
						${REQUIRED_GRAPHIC_ASSET_REFERENCES_RESOLVE}
				`).bind(path, JSON.stringify(value.set), referenceVersion, now, id, boundFacts)
				// A token the Theme does not set is cleared already: nothing is written.
				: client.prepare(`
					UPDATE themes
					SET tokens = json_remove(tokens, ?), revision = revision + 1,
						graphic_asset_reference_version = ?, updated_at = ?
					WHERE id = ? AND json_type(tokens, ?) IS NOT NULL
				`).bind(path, referenceVersion, now, id, path),
			// Scoped to this token's own slots, so a write never releases another token's references.
			client.prepare(`
				DELETE FROM graphic_asset_references
				WHERE owner_kind = '${THEME_REFERENCE_OWNER_KIND}' AND owner_id = ?
					AND (owner_slot = ? OR owner_slot LIKE ?)
					${versionGuard}
			`).bind(id, name, `${name}.%`, id, referenceVersion),
			...(references.length === 0
				? []
				: [
						client.prepare(`
							INSERT INTO graphic_asset_references (
								id, asset_id, revision_id, owner_kind, owner_id, owner_slot,
								event_id, created_at, updated_at
							)
							SELECT
								json_extract(item.value, '$.id'),
								json_extract(item.value, '$.assetId'),
								json_extract(item.value, '$.revisionId'),
								'${THEME_REFERENCE_OWNER_KIND}', ?, json_extract(item.value, '$.ownerSlot'), NULL, ?, ?
							FROM json_each(?) AS item
							WHERE EXISTS (
								SELECT 1
								${jsonElementGraphicAssetRevisionResolution('item')}
							)
								${versionGuard}
						`).bind(id, now, now, boundFacts, id, referenceVersion),
					]),
		]);
		const theme = await findById(id);
		if (!theme)
			return undefined;
		if (written?.meta.changes === 1)
			return { theme, written: true };
		// The Theme stands, so a set was refused by a reference that stopped resolving.
		if (value)
			throw new ThemeAssetReferenceConflict();
		return { theme, written: false };
	}

	async function setToken(id: string, name: string, value: unknown, references: readonly ScreenGraphicAssetReference[] = []): Promise<DbTheme | undefined> {
		return (await writeToken(id, name, { set: value }, references))?.theme;
	}

	/** Clear a token the Theme sets; a token it does not set is answered `cleared: false`, unwritten. */
	async function clearToken(id: string, name: string): Promise<{ theme: DbTheme; cleared: boolean } | undefined> {
		const result = await writeToken(id, name, null, []);
		return result && { theme: result.theme, cleared: result.written };
	}

	async function eventsUsing(id: string): Promise<EventUsingTheme[]> {
		return await db.select({ id: events.id, name: events.name })
			.from(events)
			.where(eq(events.themeId, id))
			.orderBy(asc(events.name), asc(events.id));
	}

	/**
	 * Delete a Theme no Event uses. The check names the Events that do; the
	 * foreign key refuses an Event that selected the Theme since the check, so a
	 * Theme never disappears from under an Event.
	 */
	async function remove(id: string): Promise<boolean> {
		const users = await eventsUsing(id);
		if (users.length)
			throw new ThemeInUseError(users);
		try {
			// Its Graphic Asset References go with it, in the same commit.
			const client = db.$client;
			const [, deleted] = await client.batch([
				client.prepare(`
					DELETE FROM graphic_asset_references
					WHERE owner_kind = '${THEME_REFERENCE_OWNER_KIND}' AND owner_id = ?
						AND NOT EXISTS (SELECT 1 FROM events WHERE theme_id = ?)
				`).bind(id, id),
				client.prepare('DELETE FROM themes WHERE id = ?').bind(id),
			]);
			return (deleted?.meta.changes ?? 0) > 0;
		}
		catch (error) {
			const raced = await eventsUsing(id);
			if (raced.length)
				throw new ThemeInUseError(raced);
			throw error;
		}
	}

	return {
		findAll,
		findById,
		create,
		rename,
		setToken,
		clearToken,
		eventsUsing,
		remove,
	};
}
