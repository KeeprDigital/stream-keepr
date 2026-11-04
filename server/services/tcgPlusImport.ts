import type { DbPlayer } from '~~/server/db/schema';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { players, tcgPlusImportedDeckLists } from '~~/server/db/schema';
import { chunkJsonRows, selectForInsert } from '~~/server/utils/db';

/**
 * Storage of a TCG+ Import (ADR-0074): its Players, upserted by Bandai member
 * number as their `tcgplus` Provenance, and the Deck List it last brought each.
 */

/** A Player as the export names them, with the Deck List it brings. */
export interface TcgPlusPlayerSnapshot {
	memberNumber: string;
	nickname: string;
	deckList: {
		leaderNumber: string | null;
		entries: Array<{ number: string; quantity: number }>;
	};
}

export interface TcgPlusReconcileAnswer {
	/** Every Player the export names, as written. */
	players: DbPlayer[];
	created: number;
	/** Players already imported whose Nickname changed, or who were inactive. */
	updated: number;
	/** Imported Players missing from the export, now inactive. */
	deactivated: number;
}

const TCGPLUS_SOURCE = 'tcgplus';

function importedPlayerId(eventId: number) {
	return sql`(select ${players.id} from ${players}
		where ${players.eventId} = ${eventId}
			and ${players.externalSource} = ${TCGPLUS_SOURCE}
			and ${players.externalId} = json_extract(value, '$.memberNumber'))`;
}

export function tcgPlusImportService() {
	/**
	 * Writes one export's Players in one batch. A Player is matched by their
	 * member number and only their Nickname, activity and last-seen time are
	 * written; an operator's name is never touched, nor is a Player added by
	 * hand. Imported Players the export misses are marked inactive.
	 */
	const reconcile = async (eventId: number, snapshot: readonly TcgPlusPlayerSnapshot[], seenAt: Date): Promise<TcgPlusReconcileAnswer> => {
		const seenAtMs = seenAt.getTime();
		const playerPayloads = chunkJsonRows(snapshot.map(({ memberNumber, nickname }) => ({ memberNumber, nickname })));
		const deckPayloads = chunkJsonRows(snapshot.map(({ memberNumber, deckList }) => ({ memberNumber, ...deckList })));

		const existing = playerPayloads.map(payload => db.select({ id: players.id })
			.from(players)
			.where(and(
				eq(players.eventId, eventId),
				eq(players.externalSource, TCGPLUS_SOURCE),
				sql`${players.externalId} in (select json_extract(value, '$.memberNumber') from json_each(${payload}))`,
			)));
		// A Player's revision moves only when the import changes what they hold.
		const changed = sql`"players"."nickname" is not excluded.nickname or "players"."is_active" is not 1`;
		const upserts = playerPayloads.map(payload => db.insert(players)
			.select(selectForInsert(players, {
				id: sql`null`,
				eventId: sql`${eventId}`,
				name: sql`''`,
				nickname: sql`json_extract(value, '$.nickname')`,
				pronouns: sql`null`,
				externalId: sql`json_extract(value, '$.memberNumber')`,
				externalSource: sql`${TCGPLUS_SOURCE}`,
				externalStatus: sql`null`,
				isActive: sql`1`,
				lastSeenAt: sql`${seenAtMs}`,
				wins: sql`null`,
				losses: sql`null`,
				draws: sql`null`,
				position: sql`null`,
				points: sql`null`,
				archetypeId: sql`null`,
				lgs: sql`null`,
				gameData: sql`null`,
				manuallyEditedFields: sql`null`,
				createdAt: sql`${seenAtMs}`,
				updatedAt: sql`${seenAtMs}`,
			}, sql`from json_each(${payload}) where true`))
			.onConflictDoUpdate({
				target: [players.eventId, players.externalId, players.externalSource],
				set: {
					nickname: sql.raw('excluded.nickname'),
					isActive: true,
					lastSeenAt: seenAt,
					updatedAt: sql`case when ${changed} then ${seenAtMs} else "players"."updated_at" end`,
				},
			})
			.returning());
		const deactivate = db.update(players)
			.set({ isActive: false, updatedAt: seenAt })
			.where(and(
				eq(players.eventId, eventId),
				eq(players.externalSource, TCGPLUS_SOURCE),
				eq(players.isActive, true),
				or(isNull(players.lastSeenAt), ne(players.lastSeenAt, seenAt)),
			))
			.returning({ id: players.id });
		const keepDeckLists = deckPayloads.map(payload => db.insert(tcgPlusImportedDeckLists)
			.select(selectForInsert(tcgPlusImportedDeckLists, {
				playerId: importedPlayerId(eventId),
				leaderCardNumber: sql`json_extract(value, '$.leaderNumber')`,
				entries: sql`json_extract(value, '$.entries')`,
				importedAt: sql`${seenAtMs}`,
			}, sql`from json_each(${payload}) where true`))
			.onConflictDoUpdate({
				target: tcgPlusImportedDeckLists.playerId,
				set: {
					leaderCardNumber: sql.raw('excluded.leader_card_number'),
					entries: sql.raw('excluded.entries'),
					importedAt: seenAt,
				},
			}));

		const queries = [
			...existing,
			...upserts,
			deactivate,
			...keepDeckLists,
		];
		const results = await db.batch(queries as [typeof queries[0], ...typeof queries]);
		const existingIds = new Set((results.slice(0, existing.length).flat() as Array<{ id: number }>).map(row => row.id));
		const written = results.slice(existing.length, existing.length + upserts.length).flat() as DbPlayer[];
		const deactivated = results[existing.length + upserts.length] as Array<{ id: number }>;
		const created = written.filter(player => !existingIds.has(player.id)).length;
		const updated = written.filter(player => existingIds.has(player.id) && player.updatedAt.getTime() === seenAtMs).length;
		return {
			players: written,
			created,
			updated,
			deactivated: deactivated.length,
		};
	};

	/** The Deck List the last import brought the Player, or `null` for a Player it never named. */
	const findImportedDeckList = async (eventId: number, playerId: number) => {
		const [row] = await db.select({ leaderNumber: tcgPlusImportedDeckLists.leaderCardNumber, entries: tcgPlusImportedDeckLists.entries })
			.from(tcgPlusImportedDeckLists)
			.innerJoin(players, eq(players.id, tcgPlusImportedDeckLists.playerId))
			.where(and(eq(players.eventId, eventId), eq(players.id, playerId)));
		return row ?? null;
	};

	return { reconcile, findImportedDeckList };
}
