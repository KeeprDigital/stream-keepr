import type { ArchetypeConversionTarget } from '~~/server/modules/metagame/archetypes';
import type { MetagameScopeModel } from '~~/server/modules/metagame/scopeModel';
import type { OpCardCategory } from '~~/shared/types/card/op';
import type { BoardSelection, MetagameConversionMetric, MetagameScope } from '~~/shared/types/enums';
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
import type { MetagameCardTypeBucket } from '~~/shared/utils/metagame';
import { and, asc, count, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '~~/server/db';
import { archetypeCards, archetypes, cards, playerDeckCards, playerDecks, players } from '~~/server/db/schema';
import { hasReviewedPlayerDeckDetails } from '~~/server/mappers/playerDeck';
import { buildArchetypeBreakdownEntries, compareArchetypeBreakdownEntries, groupClassifiedPlayersByArchetype, isConvertedPlayer, limitArchetypeBreakdownEntries } from '~~/server/modules/metagame/archetypes';
import { compareCardBreakdownEntries, createCardTypeBucketFilter, isEligibleMetagameCard, metagameCardColors, metagameCardType, toCardBreakdownEntry } from '~~/server/modules/metagame/cards';
import { resolveMetagameScope } from '~~/server/modules/metagame/scopeModel';
import { archetypeService } from '~~/server/services/archetype';
import { archetypeCardService } from '~~/server/services/archetypeCard';
import { buildMetagameFacts } from '~~/server/services/metagameFacts';
import { computeMetagameWinRate } from '~~/server/services/metagameMetrics';
import { getPointsByOracleId } from '~~/shared/utils/highlander';
import { playerDisplayName } from '~~/shared/utils/playerName';

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
	cardNumber?: string | null;
	category?: OpCardCategory | null;
	imageUrl?: string | null;
}): CardResponse {
	if (row.game === 'op') {
		return {
			id: row.id,
			name: row.name,
			game: row.game,
			scryfallId: null,
			oracleId: null,
			cardType: metagameCardType('op', row),
			colors: metagameCardColors('op', row.colors),
			cmc: null,
			manaCost: null,
			cardNumber: row.cardNumber ?? null,
			imageUrl: row.imageUrl ?? null,
		};
	}

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

/** Standings a Player row carries, which a participation-only Metagame reads none of (ADR-0074). */
interface PlayerStandings {
	position: number | null;
	points: number | null;
	wins: number | null;
	losses: number | null;
}

function readStandings<T extends PlayerStandings>(metagameScope: MetagameScopeModel, row: T): T {
	if (metagameScope.rules.readsStandings)
		return row;

	return {
		...row,
		position: null,
		points: null,
		wins: null,
		losses: null,
		...('draws' in row
			? { draws: null }
			: {}),
	};
}

function resolveConversionTarget(metric?: MetagameConversionMetric, threshold?: number): ArchetypeConversionTarget | undefined {
	return metric != null && threshold != null
		? { metric, threshold }
		: undefined;
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
		sortBy: 'count' | 'winRate' | 'metaShare' | 'conversionRate' = 'metaShare',
		limit?: number,
		requestedConversionTarget?: ArchetypeConversionTarget,
	): Promise<ArchetypeBreakdownResponse> {
		const scope = metagameScope.scope;
		const conversionTarget = metagameScope.rules.readsStandings
			? requestedConversionTarget
			: undefined;

		if (totalPlayers === 0) {
			return {
				entries: [],
				totalPlayers: 0,
				classifiedPlayers: 0,
				scope,
			};
		}

		// Players with archetypes assigned (classified)
		const classifiedRows = (await db
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
			))).map(row => readStandings(metagameScope, row));

		const classifiedPlayers = classifiedRows.length;

		if (classifiedPlayers === 0) {
			return {
				entries: [],
				totalPlayers,
				classifiedPlayers: 0,
				scope,
			};
		}

		const groups = groupClassifiedPlayersByArchetype(classifiedRows, conversionTarget);

		// Only the Event's own Archetypes that have classified players, looked up
		// in groups within D1's parameter limit: an Event can represent a hundred
		// or more, and every id is a bound parameter (#702).
		const archetypeRows = await archetypeService().findManyByIds(eventId, [
			...groups.keys(),
		]);

		const entries = buildArchetypeBreakdownEntries(groups, archetypeRows, classifiedPlayers, new Map(), conversionTarget);
		entries.sort((a, b) => compareArchetypeBreakdownEntries(sortBy, a, b));
		const limitedEntries = limitArchetypeBreakdownEntries(entries, groups, classifiedPlayers, limit, conversionTarget);

		// Key cards only for the entries answered: the limit applies first, and
		// the aggregated Other entry has none.
		const keyCardRowsByArchetypeId = await archetypeCardService().getKeyCardsByArchetypeIds(
			limitedEntries.filter(entry => groups.has(entry.id)).map(entry => entry.id),
		);
		const answered = limitedEntries.map(entry => ({
			...entry,
			keyCards: keyCardRowsByArchetypeId.get(entry.id)?.map(mapCardRow) ?? [],
		}));

		return {
			entries: answered,
			totalPlayers,
			classifiedPlayers,
			scope,
		};
	}

	async function getArchetypeBreakdown(
		eventId: number,
		scope: MetagameScope,
		sortBy: 'count' | 'winRate' | 'metaShare' | 'conversionRate' = 'metaShare',
		topN?: number,
		playerListId?: number,
		limit?: number,
		minPoints?: number,
		conversionMetric?: MetagameConversionMetric,
		conversionThreshold?: number,
	): Promise<ArchetypeBreakdownResponse> {
		const metagameScope = await resolveMetagameScope(eventId, { scope, topN, playerListId, minPoints });
		const totalPlayers = await metagameScope.countPlayers();

		return computeArchetypeBreakdown(eventId, metagameScope, totalPlayers, sortBy, limit, resolveConversionTarget(conversionMetric, conversionThreshold));
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
		excludeTypes?: MetagameCardTypeBucket[],
		pointedOnly: boolean = false,
	): Promise<CardBreakdownResponse> {
		const scope = metagameScope.scope;
		const board = metagameScope.deckUniverse.board;

		if (totalDecks === 0) {
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
				oracleId: cards.oracleId,
				cardNumber: cards.cardNumber,
				category: cards.category,
				imageUrl: cards.imageUrl,
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
			.groupBy(playerDeckCards.cardId, cards.name, cards.cardType, cards.scryfallId, cards.colors, cards.cmc, cards.manaCost, cards.oracleId, cards.cardNumber, cards.category, cards.imageUrl);

		const { game, pointsSystem } = metagameScope;
		const pointsByOracleId = pointsSystem
			? getPointsByOracleId(pointsSystem)
			: null;

		const includesCardType = createCardTypeBucketFilter(game, excludeTypes);
		const entries: CardBreakdownEntry[] = aggRows
			.filter(row => isEligibleMetagameCard(game, row))
			.map(row => ({
				...toCardBreakdownEntry({
					...row,
					cardType: metagameCardType(game, row),
					colors: metagameCardColors(game, row.colors),
				}, totalDecks, board),
				...(pointsByOracleId
					? { highlanderPoints: pointsByOracleId.get(row.oracleId ?? '') ?? null }
					: {}),
			}))
			.filter(entry => entry.totalCopies > 0
				&& includesCardType(entry.cardType)
				&& (!pointedOnly || entry.highlanderPoints != null));

		entries.sort((a, b) => compareCardBreakdownEntries(sortBy, a, b));

		return {
			entries: entries.slice(0, limit),
			totalDecks,
			scope,
		};
	}

	async function getCardBreakdown(
		eventId: number,
		scope: MetagameScope,
		sortBy: 'inclusionRate' | 'avgCopies' | 'totalCopies' = 'inclusionRate',
		limit: number = 50,
		topN?: number,
		playerListId?: number,
		archetypeId?: number,
		board: BoardSelection = 'full',
		excludeTypes?: MetagameCardTypeBucket[],
		minPoints?: number,
		pointedOnly?: boolean,
	): Promise<CardBreakdownResponse> {
		const metagameScope = await resolveMetagameScope(eventId, {
			scope,
			topN,
			playerListId,
			archetypeId,
			board,
			minPoints,
		});
		// The Archetype the read is narrowed to, named for its caller: a Screen holds its id alone (ADR-0038).
		const archetype = archetypeId == null
			? undefined
			: await db.query.archetypes.findFirst({
					where: and(eq(archetypes.id, archetypeId), eq(archetypes.eventId, eventId)),
					columns: { id: true, name: true },
				});
		if (archetypeId != null && !archetype) {
			return { entries: [], totalDecks: 0, scope: metagameScope.scope };
		}

		const totalDecks = await metagameScope.deckUniverse.countDecks();
		const breakdown = await computeCardBreakdown(eventId, metagameScope, totalDecks, sortBy, limit, excludeTypes, pointedOnly);

		return archetype
			? { ...breakdown, archetype }
			: breakdown;
	}

	// ── Summary dashboard ──────────────────────────────────────────

	async function getSummary(
		eventId: number,
		scope: MetagameScope,
		topN?: number,
		playerListId?: number,
		minPoints?: number,
	): Promise<MetagameSummaryResponse> {
		// Resolve scope and player/deck counts ONCE and thread them through the
		// archetype/card breakdown computations below, instead of letting each
		// independently re-resolve the same scope and re-count players/decks.
		const metagameScope = await resolveMetagameScope(eventId, { scope, topN, playerListId, minPoints });
		const totalPlayers = await metagameScope.countPlayers();

		const totalArchetypesRow = await db
			.select({
				c: count(),
			})
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
		minPoints?: number,
	): Promise<TokenRequirementsResponse> {
		const metagameScope = await resolveMetagameScope(eventId, { scope, topN, playerListId, minPoints });
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

		const entries = [
			...tokenMap.values(),
		]
			.map(entry => ({
				...entry.token,
				deckCount: entry.deckIds.size,
				sourceCardCount: entry.sourceCards.size,
				sourceCards: [
					...entry.sourceCards.values(),
				].sort((a, b) => a.name.localeCompare(b.name)),
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
		board: BoardSelection = 'full',
		minPoints?: number,
		conversionMetric?: MetagameConversionMetric,
		conversionThreshold?: number,
	): Promise<ArchetypeDetailResponse | null> {
		const arch = await db.query.archetypes.findFirst({
			where: and(eq(archetypes.id, archetypeId), eq(archetypes.eventId, eventId)),
		});

		if (!arch)
			return null;

		const metagameScope = await resolveMetagameScope(eventId, {
			scope,
			topN,
			playerListId,
			archetypeId,
			board,
			minPoints,
		});

		// Players in this archetype (within scope)
		const archPlayerRows = await db
			.select({
				id: players.id,
				name: players.name,
				nickname: players.nickname,
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

		const pilotRows = archPlayerRows.map(row => readStandings(metagameScope, row));
		const playerCount = pilotRows.length;
		const archPlayerIds = pilotRows.map(p => p.id);

		// Stats
		const totalWins = pilotRows.reduce((s, p) => s + (p.wins ?? 0), 0);
		const totalLosses = pilotRows.reduce((s, p) => s + (p.losses ?? 0), 0);
		const withPosition = pilotRows.filter(p => p.position != null);
		const conversionTarget = metagameScope.rules.readsStandings
			? resolveConversionTarget(conversionMetric, conversionThreshold)
			: undefined;
		const convertedCount = conversionTarget
			? pilotRows.filter(p => isConvertedPlayer(p, conversionTarget)).length
			: null;

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

		const archPlayers: ArchetypePlayerEntry[] = pilotRows.map((p) => {
			const reviewed = hasReviewedPlayerDeckDetails(
				{ archetypeId: p.deckArchetypeId, reviewedAt: p.deckReviewedAt },
				arch,
			);
			return {
				id: p.id,
				name: playerDisplayName(p),
				deckName: reviewed
					? arch.name
					: p.deckName ?? null,
				position: p.position,
				points: p.points,
				wins: p.wins,
				losses: p.losses,
				draws: p.draws,
				colors: reviewed
					? arch.colors
					: p.deckColors ?? null,
			};
		});

		return {
			id: arch.id,
			name: arch.name,
			colors: arch.colors,
			keyCards,
			playerCount,
			metaShare: classifiedCount > 0
				? Math.round((playerCount / classifiedCount) * 10000) / 100
				: 0,
			winRate: computeMetagameWinRate(totalWins, totalLosses),
			avgPosition: withPosition.length > 0
				? Math.round((withPosition.reduce((s, p) => s + (p.position ?? 0), 0) / withPosition.length) * 10) / 10
				: null,
			convertedCount,
			conversionRate: convertedCount != null && playerCount > 0
				? Math.round((convertedCount / playerCount) * 10000) / 100
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
		minPoints?: number,
	): Promise<CardDetailResponse | null> {
		const card = await db.query.cards.findFirst({
			where: eq(cards.id, cardId),
		});
		if (!card)
			return null;

		const metagameScope = await resolveMetagameScope(eventId, { scope, topN, playerListId, minPoints });

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

		const inclusionRate = totalDecks > 0
			? Math.round((totalDecksWithCard / totalDecks) * 10000) / 100
			: 0;
		const avgCopies = totalDecksWithCard > 0
			? Math.round((totalCopies / totalDecksWithCard) * 100) / 100
			: 0;

		// Players who run this card
		const playerRowsWithCard = await db
			.select({
				id: players.id,
				name: players.name,
				nickname: players.nickname,
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

		const cardPlayers: CardPlayerEntry[] = playerRowsWithCard.map(row => readStandings(metagameScope, row)).map(r => ({
			id: r.id,
			name: playerDisplayName(r),
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
					inclusionRate: totalInArch > 0
						? Math.round((row.deckCount / totalInArch) * 10000) / 100
						: 0,
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
				cardNumber: cards.cardNumber,
				category: cards.category,
				imageUrl: cards.imageUrl,
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
			.groupBy(playerDeckCards.cardId, cards.name, cards.cardType, cards.scryfallId, cards.manaCost, cards.cmc, cards.colors, cards.cardNumber, cards.category, cards.imageUrl)
			.orderBy(desc(sql`count(distinct ${playerDeckCards.deckId})`))
			.limit(10);

		const { game } = metagameScope;
		const coOccurrence: CardCoOccurrenceEntry[] = coOccurrenceRows.filter(r => isEligibleMetagameCard(game, r)).map(r => ({
			id: r.cardId,
			name: r.name,
			cardType: metagameCardType(game, r),
			scryfallId: r.scryfallId,
			manaCost: r.manaCost,
			cmc: r.cmc,
			colors: metagameCardColors(game, r.colors),
			cardNumber: r.cardNumber,
			imageUrl: r.imageUrl,
			coOccurrenceRate: totalDecksWithCard > 0
				? Math.round((r.coOccurrenceCount / totalDecksWithCard) * 10000) / 100
				: 0,
			deckCount: r.coOccurrenceCount,
		}));

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
