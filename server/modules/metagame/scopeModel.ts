import type { SQL } from 'drizzle-orm';
import type { BoardSelection, MetagameScope } from '~~/shared/types/enums';
import type { PlayerScope } from './scope';
import { and, eq } from 'drizzle-orm';
import { db } from 'hub:db';
import { archetypes, playerDecks, players } from '~~/server/db/schema';
import { countScopedPlayers, getPlayerScope, playerScopeWhere } from './scope';

export interface MetagameScopeQuery {
	scope: MetagameScope;
	topN?: number;
	minPoints?: number;
	playerListId?: number;
	archetypeId?: number;
	archetype?: string;
	board?: BoardSelection;
}

export interface MetagameDeckUniverse {
	board: BoardSelection;
	countDecks: () => Promise<number>;
}

export interface MetagameScopeModel {
	eventId: number;
	scope: MetagameScope;
	playerScope: PlayerScope;
	playerWhere: SQL;
	playerFilters: SQL[];
	resolvedArchetypeId: number | null | undefined;
	deckUniverse: MetagameDeckUniverse;
	countPlayers: (extraCondition?: SQL) => Promise<number>;
}

async function resolveArchetypeFilterId(eventId: number, archetypeId?: number, archetypeName?: string): Promise<number | null | undefined> {
	if (archetypeId != null)
		return archetypeId;

	const normalizedName = archetypeName?.trim();
	if (!normalizedName)
		return undefined;

	const archetype = await db.query.archetypes.findFirst({
		where: and(
			eq(archetypes.eventId, eventId),
			eq(archetypes.name, normalizedName),
		),
		columns: { id: true },
	});

	return archetype?.id ?? null;
}

export async function resolveMetagameScope(eventId: number, query: MetagameScopeQuery): Promise<MetagameScopeModel> {
	const playerScope = getPlayerScope(eventId, query.scope, query.topN, query.playerListId, query.minPoints);
	const playerWhere = playerScopeWhere(playerScope);
	const resolvedArchetypeId = await resolveArchetypeFilterId(eventId, query.archetypeId, query.archetype);
	const playerFilters: SQL[] = [playerWhere];
	if (resolvedArchetypeId != null)
		playerFilters.push(eq(players.archetypeId, resolvedArchetypeId));

	const deckUniverse: MetagameDeckUniverse = {
		board: query.board ?? 'full',
		async countDecks() {
			const deckCountRows = await db
				.selectDistinct({ deckId: playerDecks.id })
				.from(playerDecks)
				.innerJoin(players, eq(playerDecks.playerId, players.id))
				.where(and(
					...playerFilters,
					eq(playerDecks.isPrimary, true),
				));
			return deckCountRows.length;
		},
	};

	return {
		eventId,
		scope: query.scope,
		playerScope,
		playerWhere,
		playerFilters,
		resolvedArchetypeId,
		deckUniverse,
		countPlayers: extraCondition => countScopedPlayers(playerScope, extraCondition),
	};
}
