import type { SQL } from 'drizzle-orm';
import type { BoardSelection, Game, MetagameScope, PointsSystem } from '~~/shared/types/enums';
import type { MetagameRules } from '~~/shared/types/game';
import type { PlayerScope } from './scope';
import { and, eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, events, playerDecks, players } from '~~/server/db/schema';
import { getMetagameRules } from '~~/shared/config/games';
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
	/** The Event's Card Game, whose card rules the Metagame counts by. */
	game: Game;
	/** What the Event's Metagame reads (ADR-0074). */
	rules: MetagameRules;
	/** The Event's points system: highlander points are Magic's, so an OP Metagame reads none. */
	pointsSystem: PointsSystem | null;
	/** The scope read: one the Card Game does not offer reads every Player. */
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

/** The Card Game whose card rules an Event's Metagame counts by. */
export async function readMetagameGame(eventId: number): Promise<Game> {
	const event = await db.query.events.findFirst({
		where: eq(events.id, eventId),
		columns: { game: true },
	});
	return event?.game ?? 'mtg';
}

export async function resolveMetagameScope(eventId: number, query: MetagameScopeQuery): Promise<MetagameScopeModel> {
	const event = await db.query.events.findFirst({
		where: eq(events.id, eventId),
		columns: { game: true, pointsSystem: true },
	});
	const game = event?.game ?? 'mtg';
	const rules = getMetagameRules(game);
	const scope = rules.scopes.includes(query.scope)
		? query.scope
		: 'all';
	const playerScope = getPlayerScope(eventId, scope, query.topN, query.playerListId, query.minPoints);
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
		game,
		rules,
		pointsSystem: game === 'mtg'
			? event?.pointsSystem ?? null
			: null,
		scope,
		playerScope,
		playerWhere,
		playerFilters,
		resolvedArchetypeId,
		deckUniverse,
		countPlayers: extraCondition => countScopedPlayers(playerScope, extraCondition),
	};
}
