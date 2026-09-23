import type { SQL } from 'drizzle-orm';
import type { MetagameScope } from '~~/shared/types/enums';
import { and, count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { playerListMembers, playerLists, players } from '~~/server/db/schema';

/**
 * Player scope for a Metagame query.
 *
 * Uses SQL filters/subqueries instead of materialized ID arrays so large top-N
 * or Player List scopes remain safe on D1.
 */
export type PlayerScope
	= | { kind: 'all'; eventId: number }
		| { kind: 'topN'; eventId: number; topN: number }
		| { kind: 'minPoints'; eventId: number; minPoints: number }
		| { kind: 'playerList'; eventId: number; playerListId: number };

function playerListPlayerIdsSubquery(scope: Extract<PlayerScope, { kind: 'playerList' }>) {
	return db
		.select({ playerId: playerListMembers.playerId })
		.from(playerListMembers)
		.innerJoin(playerLists, eq(playerListMembers.listId, playerLists.id))
		.where(and(
			eq(playerListMembers.listId, scope.playerListId),
			eq(playerLists.eventId, scope.eventId),
		));
}

/** Returns a Drizzle WHERE condition for filtering the joined `players` table. */
export function playerScopeWhere(scope: PlayerScope): SQL {
	switch (scope.kind) {
		case 'topN':
			return and(
				eq(players.eventId, scope.eventId),
				eq(players.isActive, true),
				isNotNull(players.position),
				sql`${players.position} <= ${scope.topN}`,
			)!;

		case 'minPoints':
			return and(
				eq(players.eventId, scope.eventId),
				eq(players.isActive, true),
				isNotNull(players.points),
				sql`${players.points} >= ${scope.minPoints}`,
			)!;

		case 'playerList':
			return and(
				eq(players.eventId, scope.eventId),
				eq(players.isActive, true),
				inArray(players.id, playerListPlayerIdsSubquery(scope)),
			)!;

		case 'all':
		default:
			return and(
				eq(players.eventId, scope.eventId),
				eq(players.isActive, true),
			)!;
	}
}

export async function countScopedPlayers(scope: PlayerScope, extraCondition?: SQL) {
	const conditions = [playerScopeWhere(scope)];
	if (extraCondition)
		conditions.push(extraCondition);

	const [result] = await db
		.select({ c: count() })
		.from(players)
		.where(and(...conditions));

	return result?.c ?? 0;
}

export function getPlayerScope(
	eventId: number,
	scope: MetagameScope,
	topN?: number,
	playerListId?: number,
	minPoints?: number,
): PlayerScope {
	if (scope === 'playerList' && playerListId)
		return { kind: 'playerList', playerListId, eventId };

	if (scope === 'topN' && topN)
		return { kind: 'topN', topN, eventId };

	if (scope === 'minPoints' && minPoints != null)
		return { kind: 'minPoints', minPoints, eventId };

	return { kind: 'all', eventId };
}
