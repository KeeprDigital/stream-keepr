import type { DbTheme } from '~~/server/db/schema';
import type { EventUsingTheme } from '~~/shared/types/theme';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { events, themes } from '~~/server/db/schema';

/** A Theme delete refused because Events use it. */
export class ThemeInUseError extends Error {
	constructor(readonly events: EventUsingTheme[]) {
		super('Theme is in use');
		this.name = 'ThemeInUseError';
	}
}

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

	async function setToken(id: string, name: string, value: unknown): Promise<DbTheme | undefined> {
		const [theme] = await db.update(themes)
			.set({
				tokens: sql`json_set(${themes.tokens}, ${tokenPath(name)}, json(${JSON.stringify(value)}))`,
				revision: sql`${themes.revision} + 1`,
				updatedAt: new Date(),
			})
			.where(eq(themes.id, id))
			.returning();
		return theme;
	}

	/** Clear a token the Theme sets; a token it does not set is answered `cleared: false`, unwritten. */
	async function clearToken(id: string, name: string): Promise<{ theme: DbTheme; cleared: boolean } | undefined> {
		const path = tokenPath(name);
		const [cleared] = await db.update(themes)
			.set({
				tokens: sql`json_remove(${themes.tokens}, ${path})`,
				revision: sql`${themes.revision} + 1`,
				updatedAt: new Date(),
			})
			.where(and(eq(themes.id, id), sql`json_type(${themes.tokens}, ${path}) is not null`))
			.returning();
		if (cleared)
			return { theme: cleared, cleared: true };
		const unchanged = await findById(id);
		return unchanged && { theme: unchanged, cleared: false };
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
			const deleted = await db.delete(themes).where(eq(themes.id, id)).returning({ id: themes.id });
			return deleted.length > 0;
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
