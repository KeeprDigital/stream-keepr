import type { MetagameScopeModel } from '~~/server/modules/metagame/scopeModel';
import type { MetagameCardBoardFilter, MetagameScope } from '~~/shared/types/enums';
import type {
	ArchetypeBreakdownResponse,
	ArchetypeDetailResponse,
	ArchetypePlayerEntry,
	CardArchetypeEntry,
	CardBreakdownEntry,
	CardBreakdownResponse,
	CardCoOccurrenceEntry,
	CardDetailResponse,
	CardPlayerEntry,
	CardResponse,
	MetagameSummaryResponse,
	TokenRequirementsResponse,
	TokenSourceCardEntry,
} from '~~/shared/types/metagame';
import type { DeckTokenRequirement } from '~~/shared/utils/deckTokens';
import { and, asc, count, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from 'hub:db';
import { archetypeCards, archetypes, cards, playerDeckCards, playerDecks, players } from '~~/server/db/schema';
import { hasReviewedPlayerDeckDetails } from '~~/server/mappers/playerDeck';
import { buildArchetypeBreakdownEntries, compareArchetypeBreakdownEntries, groupClassifiedPlayersByArchetype } from '~~/server/modules/metagame/archetypes';
import { compareCardBreakdownEntries, isEligibleMetagameCard, toCardBreakdownEntry } from '~~/server/modules/metagame/cards';
import { resolveMetagameScope } from '~~/server/modules/metagame/scopeModel';
import { archetypeCardService } from '~~/server/services/archetypeCard';
import { buildMetagameFacts } from '~~/server/services/metagameFacts';
import { computeMetagameWinRate } from '~~/server/services/metagameMetrics';

// ─── Helpers ────────────────────────────────────────────────────

function mapCardRow(row: {
	id: number;
	name: string;
	game: string;
	scryfallId: string | null;
	oracleId?: string | null;
	cardType: string | null;
	colors: string | null;
	cmc: number | null;
	manaCost: string | null;
}): CardResponse {
	return {
		id: row.id,
		name: row.name,
		game: row.game,
		scryfallId: row.scryfallId,
		oracleId: row.oracleId ?? null,
		cardType: row.cardType,
		colors: row.colors,
		cmc: row.cmc,
		manaCost: row.manaCost,
	};
}

function tokenKey(token: DeckTokenRequirement): string {
	return token.name.trim().toLowerCase();
}

function sourceCardKey(card: TokenSourceCardEntry): string {
	return String(card.id);
}

// ─── Service ────────────────────────────────────────────────────

export function createMetagameReadModelImplementation() {
	// ── Archetype breakdown ────────────────────────────────────────

	/**
	 * Core archetype-breakdown computation over an already-resolved scope and
	 * player count. Shared by the public `getArchetypeBreakdown` (which resolves
	 * its own scope/count) and `getSummary` (which resolves them once and
	 * threads them through, avoiding a duplicate scope/count round-trip).
	 */
	async function computeArchetypeBreakdown(
		eventId: number,
		metagameScope: MetagameScopeModel,
		totalPlayers: number,
		sortBy: 'count' | 'winRate' | 'metaShare' = 'metaShare',
	): Promise<ArchetypeBreakdownResponse> {
		const scope = metagameScope.scope;

		if (totalPlayers === 0) {
			return { entries: [], totalPlayers: 0, classifiedPlayers: 0, scope };
		}

		// Players with archetypes assigned (classified)
		const classifiedRows = await db
			.select({
				archetypeId: players.archetypeId,
				wins: players.wins,
				losses: players.losses,
				points: players.points,
				position: players.position,
			})
			.from(players)
			.where(and(
				metagameScope.playerWhere,
				isNotNull(players.archetypeId),
			));

		const classifiedPlayers = classifiedRows.length;

		if (classifiedPlayers === 0) {
			return { entries: [], totalPlayers, classifiedPlayers: 0, scope };
		}

		const groups = groupClassifiedPlayersByArchetype(classifiedRows);

		// Fetch only the archetypes that have classified players
		const archetypeIds = [...groups.keys()];
		const archetypeRows = await db
			.select()
			.from(archetypes)
			.where(and(
				eq(archetypes.eventId, eventId),
				inArray(archetypes.id, archetypeIds),
			));
		// Fetch key cards for all archetypes in one call
		const keyCardRowsByArchetypeId = await archetypeCardService().getKeyCardsByArchetypeIds(archetypeIds);
		const keyCardsByArchetypeId = new Map(
			[...keyCardRowsByArchetypeId.entries()].map(([archetypeId, keyCards]) => [archetypeId, keyCards.map(mapCardRow)]),
		);

		const entries = buildArchetypeBreakdownEntries(groups, archetypeRows, classifiedPlayers, keyCardsByArchetypeId);
		entries.sort((a, b) => compareArchetypeBreakdownEntries(sortBy, a, b));

		return { entries, totalPlayers, classifiedPlayers, scope };
	}

	async function getArchetypeBreakdown(
		eventId: number,
		scope: MetagameScope,
		sortBy: 'count' | 'winRate' | 'metaShare' = 'metaShare',
		topN?: number,
		playerListId?: number,
	): Promise<ArchetypeBreakdownResponse> {
		const metagameScope = await resolveMetagameScope(eventId, { scope, topN, playerListId });
		const totalPlayers = await metagameScope.countPlayers();

		return computeArchetypeBreakdown(eventId, metagameScope, totalPlayers, sortBy);
	}

	// ── Card breakdown ─────────────────────────────────────────────

	/**
	 * Core card-breakdown computation over an already-resolved scope and deck
	 * count. Shared by the public `getCardBreakdown` and by callers (e.g.
	 * `getSummary`, `getArchetypeDetail`) that already hold a resolved scope for
	 * the same filters and would otherwise re-resolve it.
	 */
	async function computeCardBreakdown(
		eventId: number,
		metagameScope: MetagameScopeModel,
		totalDecks: number,
		sortBy: 'inclusionRate' | 'avgCopies' | 'totalCopies' = 'inclusionRate',
		limit: number = 50,
	): Promise<CardBreakdownResponse> {
		const scope = metagameScope.scope;
		const board = metagameScope.deckUniverse.board;

		if (metagameScope.resolvedArchetypeId === null || totalDecks === 0) {
			return { entries: [], totalDecks: 0, scope };
		}

		// Aggregate card data
		const aggRows = await db
			.select({
				cardId: playerDeckCards.cardId,
				name: cards.name,
				cardType: cards.cardType,
				scryfallId: cards.scryfallId,
				colors: cards.colors,
				cmc: cards.cmc,
				manaCost: cards.manaCost,
				totalCopies: sql<number>`sum(${playerDeckCards.quantity})`,
				mainboardCount: sql<number>`sum(case when ${playerDeckCards.compartment} = 'mainboard' then ${playerDeckCards.quantity} else 0 end)`,
				sideboardCount: sql<number>`sum(case when ${playerDeckCards.compartment} = 'sideboard' then ${playerDeckCards.quantity} else 0 end)`,
				mainboardDeckCount: sql<number>`count(distinct case when ${playerDeckCards.compartment} = 'mainboard' then ${playerDeckCards.deckId} end)`,
				sideboardDeckCount: sql<number>`count(distinct case when ${playerDeckCards.compartment} = 'sideboard' then ${playerDeckCards.deckId} end)`,
				deckCount: sql<number>`count(distinct ${playerDeckCards.deckId})`,
			})
			.from(playerDeckCards)
			.innerJoin(cards, eq(playerDeckCards.cardId, cards.id))
			.innerJoin(playerDecks, eq(playerDeckCards.deckId, playerDecks.id))
			.innerJoin(players, eq(playerDecks.playerId, players.id))
			.where(and(
				...metagameScope.playerFilters,
				eq(playerDecks.isPrimary, true),
			))
			.groupBy(playerDeckCards.cardId, cards.name, cards.cardType, cards.scryfallId, cards.colors, cards.cmc, cards.manaCost);

		const entries: CardBreakdownEntry[] = aggRows
			.map(row => toCardBreakdownEntry(row, totalDecks, board))
			.filter(entry => entry.totalCopies > 0 && isEligibleMetagameCard(entry.cardType));

		entries.sort((a, b) => compareCardBreakdownEntries(sortBy, a, b));

		return { entries: entries.slice(0, limit), totalDecks, scope };
	}

	async function getCardBreakdown(
		eventId: number,
		scope: MetagameScope,
		sortBy: 'inclusionRate' | 'avgCopies' | 'totalCopies' = 'inclusionRate',
		limit: number = 50,
		topN?: number,
		playerListId?: number,
		archetypeId?: number,
		board: MetagameCardBoardFilter = 'both',
		archetypeName?: string,
	): Promise<CardBreakdownResponse> {
		const metagameScope = await resolveMetagameScope(eventId, { scope, topN, playerListId, archetypeId, archetype: archetypeName, board });
		if (metagameScope.resolvedArchetypeId === null) {
			return { entries: [], totalDecks: 0, scope };
		}

		const totalDecks = await metagameScope.deckUniverse.countDecks();

		return computeCardBreakdown(eventId, metagameScope, totalDecks, sortBy, limit);
	}

	// ── Summary dashboard ──────────────────────────────────────────

	async function getSummary(
		eventId: number,
		scope: MetagameScope,
		topN?: number,
		playerListId?: number,
	): Promise<MetagameSummaryResponse> {
		// Resolve scope and player/deck counts ONCE and thread them through the
		// archetype/card breakdown computations below, instead of letting each
		// independently re-resolve the same scope and re-count players/decks.
		const metagameScope = await resolveMetagameScope(eventId, { scope, topN, playerListId });
		const totalPlayers = await metagameScope.countPlayers();

		const totalArchetypesRow = await db
			.select({ c: count() })
			.from(archetypes)
			.where(eq(archetypes.eventId, eventId));
		const totalArchetypes = totalArchetypesRow[0]?.c ?? 0;

		const archetypeBreakdown = await computeArchetypeBreakdown(eventId, metagameScope, totalPlayers, 'metaShare');
		// classifiedPlayers is derived from the archetype breakdown's own row
		// scan rather than a separate count query over the same population.
		const classifiedCount = archetypeBreakdown.classifiedPlayers;

		const totalDecks = await metagameScope.deckUniverse.countDecks();
		const cardBreakdown = await computeCardBreakdown(eventId, metagameScope, totalDecks, 'inclusionRate', Number.MAX_SAFE_INTEGER);
		const facts = buildMetagameFacts({
			totalPlayers,
			classifiedPlayers: classifiedCount,
			totalDecks: cardBreakdown.totalDecks,
			archetypes: archetypeBreakdown.entries,
			cards: cardBreakdown.entries,
		});

		return {
			totalPlayers,
			classifiedPlayers: classifiedCount,
			totalDecks: cardBreakdown.totalDecks,
			totalArchetypes,
			scopedArchetypeCount: archetypeBreakdown.entries.length,
			scope,
			facts,
			topArchetypes: archetypeBreakdown.entries.slice(0, 5),
			topCards: cardBreakdown.entries.slice(0, 10),
		};
	}

	// ── Token requirements ─────────────────────────────────────────

	async function getTokenRequirements(
		eventId: number,
		scope: MetagameScope,
		topN?: number,
		playerListId?: number,
	): Promise<TokenRequirementsResponse> {
		const metagameScope = await resolveMetagameScope(eventId, { scope, topN, playerListId });
		const totalDecks = await metagameScope.deckUniverse.countDecks();

		if (totalDecks === 0) {
			return { entries: [], totalDecks: 0, scope };
		}

		const rows = await db
			.select({
				deckId: playerDeckCards.deckId,
				cardId: cards.id,
				cardName: cards.name,
				cardScryfallId: cards.scryfallId,
				cardType: cards.cardType,
				deckTokens: cards.deckTokens,
			})
			.from(playerDeckCards)
			.innerJoin(cards, eq(playerDeckCards.cardId, cards.id))
			.innerJoin(playerDecks, eq(playerDeckCards.deckId, playerDecks.id))
			.innerJoin(players, eq(playerDecks.playerId, players.id))
			.where(and(
				...metagameScope.playerFilters,
				eq(playerDecks.isPrimary, true),
			));

		const tokenMap = new Map<string, {
			token: DeckTokenRequirement;
			deckIds: Set<number>;
			sourceCards: Map<string, TokenSourceCardEntry>;
		}>();

		for (const row of rows) {
			const sourceCard: TokenSourceCardEntry = {
				id: row.cardId,
				name: row.cardName,
				scryfallId: row.cardScryfallId,
				cardType: row.cardType,
			};

			for (const token of row.deckTokens ?? []) {
				const trimmedName = token.name.trim();
				if (!trimmedName)
					continue;

				const normalizedToken: DeckTokenRequirement = {
					id: token.id,
					scryfallId: token.scryfallId,
					name: trimmedName,
					typeLine: token.typeLine,
					uri: token.uri,
				};
				const key = tokenKey(normalizedToken);
				const entry = tokenMap.get(key) ?? {
					token: normalizedToken,
					deckIds: new Set<number>(),
					sourceCards: new Map<string, TokenSourceCardEntry>(),
				};

				entry.deckIds.add(row.deckId);
				entry.sourceCards.set(sourceCardKey(sourceCard), sourceCard);
				tokenMap.set(key, entry);
			}
		}

		const entries = [...tokenMap.values()]
			.map(entry => ({
				...entry.token,
				deckCount: entry.deckIds.size,
				sourceCardCount: entry.sourceCards.size,
				sourceCards: [...entry.sourceCards.values()].sort((a, b) => a.name.localeCompare(b.name)),
			}))
			.sort((a, b) => b.deckCount - a.deckCount || b.sourceCardCount - a.sourceCardCount || a.name.localeCompare(b.name));

		return { entries, totalDecks, scope };
	}

	// ── Archetype detail ───────────────────────────────────────────

	async function getArchetypeDetail(
		eventId: number,
		archetypeId: number,
		scope: MetagameScope,
		topN?: number,
		playerListId?: number,
		board: MetagameCardBoardFilter = 'both',
	): Promise<ArchetypeDetailResponse | null> {
		const arch = await db.query.archetypes.findFirst({
			where: and(eq(archetypes.id, archetypeId), eq(archetypes.eventId, eventId)),
		});

		if (!arch)
			return null;

		const metagameScope = await resolveMetagameScope(eventId, { scope, topN, playerListId, archetypeId, board });

		// Players in this archetype (within scope)
		const archPlayerRows = await db
			.select({
				id: players.id,
				name: players.name,
				position: players.position,
				points: players.points,
				wins: players.wins,
				losses: players.losses,
				draws: players.draws,
				deckColors: playerDecks.colors,
				deckName: playerDecks.name,
				deckArchetypeId: playerDecks.archetypeId,
				deckReviewedAt: playerDecks.reviewedAt,
			})
			.from(players)
			.leftJoin(playerDecks, and(
				eq(playerDecks.playerId, players.id),
				eq(playerDecks.isPrimary, true),
			))
			.where(and(
				metagameScope.playerWhere,
				eq(players.archetypeId, archetypeId),
			))
			.orderBy(asc(players.position));

		const playerCount = archPlayerRows.length;
		const archPlayerIds = archPlayerRows.map(p => p.id);

		// Stats
		const totalWins = archPlayerRows.reduce((s, p) => s + (p.wins ?? 0), 0);
		const totalLosses = archPlayerRows.reduce((s, p) => s + (p.losses ?? 0), 0);
		const withPosition = archPlayerRows.filter(p => p.position != null);

		// Key cards
		const keyCardRows = await archetypeCardService().getKeyCards(archetypeId);
		const keyCards = keyCardRows.map(mapCardRow);

		// Card breakdown for this archetype's players — reuses the scope already
		// resolved above instead of having getCardBreakdown re-resolve it.
		const cardBreakdown = archPlayerIds.length > 0
			? await computeCardBreakdown(eventId, metagameScope, await metagameScope.deckUniverse.countDecks(), 'inclusionRate', 200)
			: { entries: [], totalDecks: 0, scope };

		// Total classified players in scope (denominator for metaShare)
		const classifiedCount = await metagameScope.countPlayers(isNotNull(players.archetypeId));

		const archPlayers: ArchetypePlayerEntry[] = archPlayerRows.map((p) => {
			const reviewed = hasReviewedPlayerDeckDetails(
				{ archetypeId: p.deckArchetypeId, reviewedAt: p.deckReviewedAt },
				arch,
			);
			return {
				id: p.id,
				name: p.name,
				deckName: reviewed ? arch.name : p.deckName ?? null,
				position: p.position,
				points: p.points,
				wins: p.wins,
				losses: p.losses,
				draws: p.draws,
				colors: reviewed ? arch.colors : p.deckColors ?? null,
			};
		});

		return {
			id: arch.id,
			name: arch.name,
			colors: arch.colors,
			keyCards,
			playerCount,
			metaShare: classifiedCount > 0 ? Math.round((playerCount / classifiedCount) * 10000) / 100 : 0,
			winRate: computeMetagameWinRate(totalWins, totalLosses),
			avgPosition: withPosition.length > 0
				? Math.round((withPosition.reduce((s, p) => s + (p.position ?? 0), 0) / withPosition.length) * 10) / 10
				: null,
			cardBreakdown: cardBreakdown.entries,
			players: archPlayers,
		};
	}

	// ── Card detail ────────────────────────────────────────────────

	async function getCardDetail(
		eventId: number,
		cardId: number,
		scope: MetagameScope,
		topN?: number,
		playerListId?: number,
	): Promise<CardDetailResponse | null> {
		const card = await db.query.cards.findFirst({ where: eq(cards.id, cardId) });
		if (!card)
			return null;

		const metagameScope = await resolveMetagameScope(eventId, { scope, topN, playerListId });

		// Decks containing this card — join players for scope filtering
		const deckRows = await db
			.select({
				deckId: playerDeckCards.deckId,
				playerId: playerDecks.playerId,
				quantity: playerDeckCards.quantity,
				compartment: playerDeckCards.compartment,
			})
			.from(playerDeckCards)
			.innerJoin(playerDecks, eq(playerDeckCards.deckId, playerDecks.id))
			.innerJoin(players, eq(playerDecks.playerId, players.id))
			.where(and(
				metagameScope.playerWhere,
				eq(playerDeckCards.cardId, cardId),
				eq(playerDecks.isPrimary, true),
			));

		const totalDecksWithCard = new Set(deckRows.map(r => r.deckId)).size;
		const totalCopies = deckRows.reduce((s, r) => s + r.quantity, 0);
		const mainboardCount = deckRows.filter(r => r.compartment === 'mainboard').reduce((s, r) => s + r.quantity, 0);
		const sideboardCount = deckRows.filter(r => r.compartment === 'sideboard').reduce((s, r) => s + r.quantity, 0);

		const totalDecks = await metagameScope.deckUniverse.countDecks();

		const inclusionRate = totalDecks > 0 ? Math.round((totalDecksWithCard / totalDecks) * 10000) / 100 : 0;
		const avgCopies = totalDecksWithCard > 0 ? Math.round((totalCopies / totalDecksWithCard) * 100) / 100 : 0;

		// Players who run this card
		const playerRowsWithCard = await db
			.select({
				id: players.id,
				name: players.name,
				position: players.position,
				points: players.points,
				wins: players.wins,
				losses: players.losses,
				draws: players.draws,
				quantity: playerDeckCards.quantity,
				compartment: playerDeckCards.compartment,
			})
			.from(playerDeckCards)
			.innerJoin(playerDecks, eq(playerDeckCards.deckId, playerDecks.id))
			.innerJoin(players, eq(playerDecks.playerId, players.id))
			.where(and(
				metagameScope.playerWhere,
				eq(playerDeckCards.cardId, cardId),
				eq(playerDecks.isPrimary, true),
			))
			.orderBy(asc(players.position));

		const cardPlayers: CardPlayerEntry[] = playerRowsWithCard.map(r => ({
			id: r.id,
			name: r.name,
			position: r.position,
			points: r.points,
			wins: r.wins,
			losses: r.losses,
			draws: r.draws,
			quantity: r.quantity,
			compartment: r.compartment as 'mainboard' | 'sideboard',
		}));

		// Archetypes that run this card — JOIN playerDeckCards directly to avoid
		// materialising a playerIdsWithCard array (could exceed D1 variable limit)
		const archEntries: CardArchetypeEntry[] = [];

		if (deckRows.length > 0) {
			const archetypeCountRows = await db
				.select({
					archetypeId: players.archetypeId,
					archetypeName: archetypes.name,
					archetypeColors: archetypes.colors,
					deckCount: sql<number>`count(distinct ${playerDecks.id})`,
				})
				.from(players)
				.innerJoin(archetypes, eq(players.archetypeId, archetypes.id))
				.innerJoin(playerDecks, and(
					eq(playerDecks.playerId, players.id),
					eq(playerDecks.isPrimary, true),
				))
				.innerJoin(playerDeckCards, and(
					eq(playerDeckCards.deckId, playerDecks.id),
					eq(playerDeckCards.cardId, cardId),
				))
				.where(and(
					metagameScope.playerWhere,
					isNotNull(players.archetypeId),
				))
				.groupBy(players.archetypeId, archetypes.name, archetypes.colors)
				.orderBy(desc(sql`count(distinct ${players.id})`));

			// Check which archetypes have this as a key card
			const keyCardArchRows = await db
				.select({ archetypeId: archetypeCards.archetypeId })
				.from(archetypeCards)
				.where(eq(archetypeCards.cardId, cardId));
			const keyCardArchSet = new Set(keyCardArchRows.map(r => r.archetypeId));

			// Total scoped player count per archetype (denominator for inclusion rate)
			const archetypeTotalCountRows = await db
				.select({
					archetypeId: players.archetypeId,
					totalCount: count(),
				})
				.from(players)
				.where(and(
					metagameScope.playerWhere,
					isNotNull(players.archetypeId),
				))
				.groupBy(players.archetypeId);
			const archetypeTotalCountMap = new Map(
				archetypeTotalCountRows.map(r => [r.archetypeId, r.totalCount]),
			);

			for (const row of archetypeCountRows) {
				if (!row.archetypeId)
					continue;
				const totalInArch = archetypeTotalCountMap.get(row.archetypeId) ?? 0;
				archEntries.push({
					id: row.archetypeId,
					name: row.archetypeName,
					colors: row.archetypeColors,
					isKeyCard: keyCardArchSet.has(row.archetypeId),
					inclusionRate: totalInArch > 0 ? Math.round((row.deckCount / totalInArch) * 10000) / 100 : 0,
					deckCount: row.deckCount,
				});
			}
		}

		// Co-occurrence: top 10 cards alongside this card.
		// Self-join on playerDeckCards (aliased) to find players who also have
		// the target card — avoids materialising a large playerIdsWithCard array.
		const pdc2 = alias(playerDeckCards, 'pdc2');
		const coOccurrenceRows = await db
			.select({
				cardId: playerDeckCards.cardId,
				name: cards.name,
				cardType: cards.cardType,
				scryfallId: cards.scryfallId,
				manaCost: cards.manaCost,
				cmc: cards.cmc,
				colors: cards.colors,
				coOccurrenceCount: sql<number>`count(distinct ${playerDeckCards.deckId})`,
			})
			.from(playerDeckCards)
			.innerJoin(cards, eq(playerDeckCards.cardId, cards.id))
			.innerJoin(pdc2, and(
				eq(pdc2.deckId, playerDeckCards.deckId),
				eq(pdc2.cardId, cardId),
			))
			.innerJoin(playerDecks, eq(playerDeckCards.deckId, playerDecks.id))
			.innerJoin(players, eq(playerDecks.playerId, players.id))
			.where(and(
				metagameScope.playerWhere,
				ne(playerDeckCards.cardId, cardId),
				eq(playerDecks.isPrimary, true),
			))
			.groupBy(playerDeckCards.cardId, cards.name, cards.cardType, cards.scryfallId, cards.manaCost, cards.cmc, cards.colors)
			.orderBy(desc(sql`count(distinct ${playerDeckCards.deckId})`))
			.limit(10);

		const coOccurrence: CardCoOccurrenceEntry[] = coOccurrenceRows.map(r => ({
			id: r.cardId,
			name: r.name,
			cardType: r.cardType,
			scryfallId: r.scryfallId,
			manaCost: r.manaCost,
			cmc: r.cmc,
			colors: r.colors,
			coOccurrenceRate: totalDecksWithCard > 0
				? Math.round((r.coOccurrenceCount / totalDecksWithCard) * 10000) / 100
				: 0,
			deckCount: r.coOccurrenceCount,
		})).filter(entry => isEligibleMetagameCard(entry.cardType));

		return {
			card: mapCardRow(card),
			totalDecks,
			inclusionRate,
			avgCopies,
			mainboardCount,
			sideboardCount,
			archetypes: archEntries,
			players: cardPlayers,
			coOccurrence,
		};
	}

	return {
		getArchetypeBreakdown,
		getCardBreakdown,
		getSummary,
		getTokenRequirements,
		getArchetypeDetail,
		getCardDetail,
	};
}
