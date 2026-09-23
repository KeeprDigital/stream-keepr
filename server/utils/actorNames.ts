import type { GraphicsActorNaming } from '~~/shared/types/graphicsAsset';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '~~/server/db';
import {
	isLocalDeveloperSessionId,
	isLocalDeveloperUserId,
	LOCAL_DEVELOPER_USER_NAME,
} from '~~/shared/utils/localDeveloperAuth';
import { chunkArray, SAFE_INARRAY_SIZE } from './db';

/**
 * What an administrator surface calls an actor that resolves to no user.
 *
 * ADR-0010 leaves anonymous-era rows exactly as they are: a Graphics Ingestion
 * Operation started before the cutover, and every Evidence entry written for
 * one, names a Graphics Author Session that no longer exists and never had a
 * person attached. That is an accurate record of the era, so it is labelled
 * rather than rewritten — a sentinel written back over `initiated_by` could
 * collide on the `(initiated_by, idempotency_key)` unique index, and would
 * falsify the record besides.
 */
export const ANONYMOUS_ERA_ACTOR_NAME = 'anonymous era';

/**
 * The shape of the identity the retired Graphics Author Session issued.
 *
 * `crypto.randomUUID()`, and it is what separates the two kinds of unresolved
 * actor an administrator reading can meet. Better Auth issues 32-character
 * alphanumeric ids with no dashes, so a dashed UUID that names no user is an
 * anonymous-era author rather than a deleted one; anything else unresolved is a
 * named machine actor — `graphics-administrator` for an admin-token action,
 * `graphics-retention-policy` for a sweep — whose spelling ADR-0010 keeps.
 *
 * **This is narrower than #398's wording, and deliberately.** The ticket says the
 * fallback applies "when the id resolves to no user", which would also cover a
 * userId whose account has gone. That case does not exist here: this
 * installation bans and revokes rather than deleting, so nothing removes a `user`
 * row, and calling such an id 'anonymous era' would be a false claim about *when*
 * the work was done. It renders as the id — visibly odd, which is the right
 * amount of odd for a state nothing can currently produce. A ticket that adds
 * account deletion is the one that owes this a third label and `CONTEXT.md` the
 * word for it.
 */
const ANONYMOUS_ERA_ACTOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What to call each of these actors, resolved when the reading is taken (#398).
 *
 * Every administrator surface that shows who did something shows a userId
 * underneath, and a userId is not a name. Resolving here rather than storing a
 * name beside the id is ADR-0010's decision and it buys one thing: a person who
 * is renamed is renamed everywhere, including in evidence written years ago,
 * because the ledger records who acted and never what they were called at the
 * time.
 *
 * The answer covers **every** actor asked about, so a caller renders
 * `names[actor]` and never has to know which kind it is holding — a directory
 * User, the development-only Local Developer User, a machine actor, or an
 * identity from before this installation had people. Directory names resolve
 * when read so renames flow into old evidence; the synthetic local identity has
 * no directory row and therefore keeps its one fixed, conspicuous name.
 * Unresolvable is not an error: the ledger only grows, and an account deleted
 * after writing evidence must not take the page it appears on down with it.
 *
 * Reads are chunked at `SAFE_INARRAY_SIZE` because a page of the ledger is
 * bounded at 500 entries and D1 binds at most 100 parameters per statement.
 */
export async function graphicsActorNames(actors: Iterable<string>): Promise<Record<string, string>> {
	const asked = [...new Set(actors)].filter(actor => actor.length > 0);
	if (asked.length === 0)
		return {};

	const found = new Map<string, string>();
	const directoryActors = asked.filter((actor) => {
		if (!isLocalDeveloperUserId(actor))
			return true;
		found.set(actor, LOCAL_DEVELOPER_USER_NAME);
		return false;
	});
	for (const chunk of chunkArray(directoryActors, SAFE_INARRAY_SIZE)) {
		const rows = await db
			.select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
			.from(schema.user)
			.where(inArray(schema.user.id, chunk));

		for (const row of rows) {
			// A blank name is possible — the first-admin bootstrap takes one and an
			// admin-created account may carry an empty string — and an empty label
			// would read as a surface that failed rather than as a person with no
			// name. The address is the next most identifying thing this
			// installation holds, and these are administrator surfaces: an
			// administrator reading the ledger may act on the account behind an
			// entry, so identifying it beats prettiness.
			found.set(row.id, row.name.trim() || row.email);
		}
	}

	return Object.fromEntries(asked.map(actor => [
		actor,
		found.get(actor) ?? (ANONYMOUS_ERA_ACTOR.test(actor) ? ANONYMOUS_ERA_ACTOR_NAME : actor),
	]));
}

/**
 * One administrator reading, with every identity in it named (#398).
 *
 * The three readings that carry actors — the cockpit, one queue inspection, and
 * a page of the ledger — each ended in the same two lines, and only the middle
 * of them differed: which identities the payload holds. This leaves the routes
 * that one expression, which is the part that is genuinely theirs.
 */
export async function withActorNames<Reading>(
	reading: Reading,
	actors: Iterable<string>,
): Promise<Reading & GraphicsActorNaming> {
	return { ...reading, actorNames: await graphicsActorNames(actors) };
}

/**
 * What to call the person whose browser holds a Graphics Authoring Lease (#398).
 *
 * A lease is held by a session id, and a session id is neither a name nor
 * something an editor may be handed — it is another browser's credential
 * identifier. So the resolution happens here, where the session table is, and
 * only the name crosses to the client.
 *
 * **This does not fall back to the address, and `graphicsActorNames` above
 * does.** The same-looking rule is deliberately two rules, because the readers
 * are not alike: that one answers an administrator inspecting the ledger, who
 * may need to act on the account behind an entry, while this one answers a
 * colleague's editor. Publishing somebody's email address to every author in the
 * installation to say who has a Screen open is a wider disclosure than the
 * sentence needs, and the sentence has an honest shorter form.
 *
 * `null` rather than a placeholder for a nameless holder, an ended session, or a
 * deleted user: a holder nobody can name is still a holder, and the surface that
 * shows this says so in its own words rather than being handed an invented one.
 */
export async function sessionHolderName(sessionId: string): Promise<string | null> {
	if (isLocalDeveloperSessionId(sessionId))
		return LOCAL_DEVELOPER_USER_NAME;

	const [holder] = await db
		.select({ name: schema.user.name })
		.from(schema.session)
		.innerJoin(schema.user, eq(schema.session.userId, schema.user.id))
		.where(eq(schema.session.id, sessionId))
		.limit(1);

	return holder?.name.trim() || null;
}
