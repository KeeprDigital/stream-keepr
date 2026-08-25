import type { SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type {
	DbPlayer,
	DbPlayerDeck,
	DbPlayerDeckCardInsert,
	DbPlayerDeckInsert,
	DbPlayerDeckUnresolvedCardInsert,
} from '~~/server/db/schema';
import type { MtgPlayerGameData } from '~~/shared/types/game';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import {
	archetypes,
	phases,
	playerDeckCards,
	playerDeckCompanions,
	playerDecks,
	playerDeckUnresolvedCards,
	players,
	rounds,
} from '~~/server/db/schema';
import { chunkArray, chunkJsonRows, SAFE_INARRAY_SIZE, selectForInsert } from '~~/server/utils/db';

export type UpsertMeleePlayerDeck = Omit<DbPlayerDeckInsert, 'id' | 'createdAt' | 'updatedAt' | 'externalSource' | 'archetypeId' | 'reviewedAt'>;

export type MeleeDeckCardSnapshot = Omit<DbPlayerDeckCardInsert, 'id' | 'deckId'>;
export type MeleeDeckUnresolvedCardSnapshot = Omit<DbPlayerDeckUnresolvedCardInsert, 'id' | 'deckId' | 'createdAt' | 'updatedAt'>;

export type ImportedCompanionMutation
	= | { action: 'set'; cardId: number }
		| { action: 'clear' }
		| { action: 'preserve' };

export interface MeleePlayerDeckSnapshot {
	deck: UpsertMeleePlayerDeck;
	cards: MeleeDeckCardSnapshot[];
	unresolvedCards: MeleeDeckUnresolvedCardSnapshot[];
	importedCompanion: ImportedCompanionMutation;
}

export interface MeleePlayerDeckReplacement {
	playerId: number;
	snapshots: MeleePlayerDeckSnapshot[];
}

interface ReviewedMeleeDeckRow {
	id: number;
	externalId: string;
	formatExternalId: string;
}

interface ComparableDeckCardRow {
	deckId: number;
	cardId: number;
	quantity: number;
	compartment: string;
}

interface ComparableUnresolvedDeckCardRow {
	deckId: number;
	entryType: string;
	normalizedOriginalName: string;
	normalizedSetCode: string;
	quantity: number;
	compartment: string | null;
}

interface ComparableDeckCompanionRow {
	deckId: number;
	companionCardId: number | null;
	source: string;
}

export interface PlayerDeckSelection {
	deckId?: number;
	phaseId?: number;
	roundId?: number;
}

interface ReconcilePrimaryArchetypeOptions {
	/** Only restore the projection when the primary deck has completed review. */
	reviewedOnly?: boolean;
}

/**
 * Correlated lookup of a Melee deck's id from the surrounding `json_each`
 * row's `externalId`. Only meaningful inside a select iterating a `json_each`
 * whose rows carry an `externalId` field.
 */
function meleeDeckIdByExternalId(eventId: number): SQL {
	return sql`(select ${playerDecks.id} from ${playerDecks}
		where ${playerDecks.eventId} = ${eventId}
			and ${playerDecks.externalId} = json_extract(value, '$.externalId')
			and ${playerDecks.externalSource} = 'melee'
		limit 1)`;
}

function canonicalRows(rows: unknown[][]): string {
	return JSON.stringify(rows.map(row => JSON.stringify(row)).sort());
}

/** Compare classification-relevant contents; source ordering and display metadata are not deck changes. */
function submittedDeckContentsChanged(
	existingDeck: ReviewedMeleeDeckRow,
	snapshot: MeleePlayerDeckSnapshot,
	existingCards: ComparableDeckCardRow[],
	existingUnresolvedCards: ComparableUnresolvedDeckCardRow[],
	existingCompanion: ComparableDeckCompanionRow | undefined,
): boolean {
	if (existingDeck.formatExternalId !== snapshot.deck.formatExternalId)
		return true;

	const persistedCards = canonicalRows(existingCards.map(card => [
		card.cardId,
		card.quantity,
		card.compartment,
	]));
	const importedCards = canonicalRows(snapshot.cards.map(card => [
		card.cardId,
		card.quantity,
		card.compartment,
	]));
	if (persistedCards !== importedCards)
		return true;

	const persistedUnresolvedCards = canonicalRows(existingUnresolvedCards.map(card => [
		card.entryType,
		card.normalizedOriginalName,
		card.normalizedSetCode,
		card.quantity,
		card.compartment ?? null,
	]));
	const importedUnresolvedCards = canonicalRows(snapshot.unresolvedCards.map(card => [
		card.entryType,
		card.normalizedOriginalName,
		card.normalizedSetCode,
		card.quantity,
		card.compartment ?? null,
	]));
	if (persistedUnresolvedCards !== importedUnresolvedCards)
		return true;

	switch (snapshot.importedCompanion.action) {
		case 'preserve':
			return false;
		case 'clear':
			return existingCompanion?.source === 'melee';
		case 'set':
			if (!existingCompanion)
				return true;
			if (existingCompanion.source !== 'melee')
				return false;
			return existingCompanion.companionCardId !== snapshot.importedCompanion.cardId;
	}
}

export function playerDeckService() {
	const listByPlayer = async (eventId: number, playerId: number): Promise<DbPlayerDeck[]> => {
		return await db
			.select()
			.from(playerDecks)
			.where(and(
				eq(playerDecks.eventId, eventId),
				eq(playerDecks.playerId, playerId),
			))
			.orderBy(desc(playerDecks.isPrimary), asc(playerDecks.sortOrder), asc(playerDecks.id));
	};

	const listByEvent = async (eventId: number): Promise<DbPlayerDeck[]> => {
		return await db
			.select()
			.from(playerDecks)
			.where(eq(playerDecks.eventId, eventId))
			.orderBy(asc(playerDecks.playerId), desc(playerDecks.isPrimary), asc(playerDecks.sortOrder), asc(playerDecks.id));
	};

	/** Atomically reconcile all Melee-owned deck snapshots for an event import. */
	const replaceMeleeDecksForEvent = async (
		eventId: number,
		replacements: MeleePlayerDeckReplacement[],
	): Promise<void> => {
		if (replacements.length === 0)
			return;

		const playerIds = new Set<number>();
		const deckExternalIds = new Set<string>();
		for (const replacement of replacements) {
			if (playerIds.has(replacement.playerId))
				throw new Error(`Duplicate Melee deck replacement player identity: ${replacement.playerId}`);
			playerIds.add(replacement.playerId);
			for (const snapshot of replacement.snapshots) {
				if (snapshot.deck.eventId !== eventId || snapshot.deck.playerId !== replacement.playerId)
					throw new Error('Melee deck snapshot contains a Deck outside its authoritative scope');
				if (deckExternalIds.has(snapshot.deck.externalId))
					throw new Error(`Duplicate Melee Deck external identity: ${snapshot.deck.externalId}`);
				deckExternalIds.add(snapshot.deck.externalId);
			}
		}

		const targetRows = replacements.map((replacement) => {
			const primary = replacement.snapshots.find(snapshot => snapshot.deck.isPrimary)
				?? replacement.snapshots[0]
				?? null;
			return {
				playerId: replacement.playerId,
				primaryExternalId: primary?.deck.externalId ?? null,
				retainedExternalIds: replacement.snapshots.map(snapshot => snapshot.deck.externalId),
			};
		});
		const targetPayloads = chunkJsonRows(targetRows);
		const primaryTargetPayloads = chunkJsonRows(targetRows.filter(row => row.primaryExternalId != null));
		const projections: Array<{
			playerId: number;
			gameData: DbPlayer['gameData'];
			deckId: number | null;
			archetypeId: number | null;
			reviewedAt: Date | null;
			archetypeName: string | null;
			archetypeColors: string | null;
		}> = [];
		for (const payload of targetPayloads) {
			const primaryExternalId = sql<string | null>`(
				select json_extract(value, '$.primaryExternalId')
				from json_each(${payload})
				where cast(json_extract(value, '$.playerId') as integer) = ${players.id}
				limit 1
			)`;
			projections.push(...await db
				.select({
					playerId: players.id,
					gameData: players.gameData,
					deckId: playerDecks.id,
					archetypeId: playerDecks.archetypeId,
					reviewedAt: playerDecks.reviewedAt,
					archetypeName: archetypes.name,
					archetypeColors: archetypes.colors,
				})
				.from(players)
				.leftJoin(playerDecks, and(
					eq(playerDecks.eventId, eventId),
					eq(playerDecks.playerId, players.id),
					eq(playerDecks.externalId, primaryExternalId),
					eq(playerDecks.externalSource, 'melee'),
				))
				.leftJoin(archetypes, eq(playerDecks.archetypeId, archetypes.id))
				.where(and(
					eq(players.eventId, eventId),
					sql`${players.id} in (select cast(json_extract(value, '$.playerId') as integer) from json_each(${payload}))`,
				)));
		}
		if (projections.length !== replacements.length) {
			const found = new Set(projections.map(projection => projection.playerId));
			const missing = replacements.find(replacement => !found.has(replacement.playerId));
			throw new Error(`Player ${missing?.playerId ?? 'unknown'} was not found while persisting Melee decks`);
		}

		const snapshots = replacements.flatMap(replacement => replacement.snapshots);
		const snapshotsByExternalId = new Map(snapshots.map(snapshot => [snapshot.deck.externalId, snapshot]));
		const deckIdentityRows = snapshots.map(snapshot => ({ externalId: snapshot.deck.externalId }));
		const reviewedDecks: ReviewedMeleeDeckRow[] = [];
		for (const payload of chunkJsonRows(deckIdentityRows)) {
			reviewedDecks.push(...await db
				.select({
					id: playerDecks.id,
					externalId: playerDecks.externalId,
					formatExternalId: playerDecks.formatExternalId,
				})
				.from(playerDecks)
				.where(and(
					eq(playerDecks.eventId, eventId),
					eq(playerDecks.externalSource, 'melee'),
					isNotNull(playerDecks.archetypeId),
					isNotNull(playerDecks.reviewedAt),
					sql`${playerDecks.externalId} in (select json_extract(value, '$.externalId') from json_each(${payload}))`,
				)));
		}

		const reviewedDeckIds = reviewedDecks.map(deck => ({ deckId: deck.id }));
		const existingCards: ComparableDeckCardRow[] = [];
		const existingUnresolvedCards: ComparableUnresolvedDeckCardRow[] = [];
		const existingCompanions: ComparableDeckCompanionRow[] = [];
		for (const payload of chunkJsonRows(reviewedDeckIds)) {
			existingCards.push(...await db
				.select({
					deckId: playerDeckCards.deckId,
					cardId: playerDeckCards.cardId,
					quantity: playerDeckCards.quantity,
					compartment: playerDeckCards.compartment,
				})
				.from(playerDeckCards)
				.where(sql`${playerDeckCards.deckId} in (select cast(json_extract(value, '$.deckId') as integer) from json_each(${payload}))`));
			existingUnresolvedCards.push(...await db
				.select({
					deckId: playerDeckUnresolvedCards.deckId,
					entryType: playerDeckUnresolvedCards.entryType,
					normalizedOriginalName: playerDeckUnresolvedCards.normalizedOriginalName,
					normalizedSetCode: playerDeckUnresolvedCards.normalizedSetCode,
					quantity: playerDeckUnresolvedCards.quantity,
					compartment: playerDeckUnresolvedCards.compartment,
				})
				.from(playerDeckUnresolvedCards)
				.where(sql`${playerDeckUnresolvedCards.deckId} in (select cast(json_extract(value, '$.deckId') as integer) from json_each(${payload}))`));
			existingCompanions.push(...await db
				.select({
					deckId: playerDeckCompanions.deckId,
					companionCardId: playerDeckCompanions.companionCardId,
					source: playerDeckCompanions.source,
				})
				.from(playerDeckCompanions)
				.where(sql`${playerDeckCompanions.deckId} in (select cast(json_extract(value, '$.deckId') as integer) from json_each(${payload}))`));
		}

		const cardsByDeckId = Map.groupBy(existingCards, card => card.deckId);
		const unresolvedCardsByDeckId = Map.groupBy(existingUnresolvedCards, card => card.deckId);
		const companionByDeckId = new Map(existingCompanions.map(companion => [companion.deckId, companion]));
		const changedReviewedDeckIds = new Set(reviewedDecks.flatMap((deck) => {
			const snapshot = snapshotsByExternalId.get(deck.externalId);
			return snapshot && submittedDeckContentsChanged(
				deck,
				snapshot,
				cardsByDeckId.get(deck.id) ?? [],
				unresolvedCardsByDeckId.get(deck.id) ?? [],
				companionByDeckId.get(deck.id),
			)
				? [deck.id]
				: [];
		}));

		const now = new Date();
		const nowMs = now.getTime();
		const queries: BatchItem<'sqlite'>[] = [];
		for (const payload of targetPayloads) {
			queries.push(db
				.update(playerDecks)
				.set({ isPrimary: false, updatedAt: now })
				.where(and(
					eq(playerDecks.eventId, eventId),
					eq(playerDecks.isPrimary, true),
					sql`${playerDecks.playerId} in (select cast(json_extract(value, '$.playerId') as integer) from json_each(${payload}))`,
				)));
		}

		const deckRows = snapshots.map(snapshot => snapshot.deck);
		for (const payload of chunkJsonRows(deckRows)) {
			queries.push(db
				.insert(playerDecks)
				.select(selectForInsert(playerDecks, {
					id: sql`null`,
					eventId: sql`json_extract(value, '$.eventId')`,
					playerId: sql`json_extract(value, '$.playerId')`,
					externalId: sql`json_extract(value, '$.externalId')`,
					externalSource: sql`'melee'`,
					formatExternalId: sql`json_extract(value, '$.formatExternalId')`,
					name: sql`json_extract(value, '$.name')`,
					colors: sql`coalesce(json_extract(value, '$.colors'), '')`,
					sortOrder: sql`coalesce(json_extract(value, '$.sortOrder'), 0)`,
					isPrimary: sql`0`,
					archetypeId: sql`null`,
					reviewedAt: sql`null`,
					createdAt: sql`${nowMs}`,
					updatedAt: sql`${nowMs}`,
				}, sql`from json_each(${payload}) where true`))
				.onConflictDoUpdate({
					target: [playerDecks.eventId, playerDecks.externalId, playerDecks.externalSource],
					set: {
						playerId: sql.raw('excluded.player_id'),
						formatExternalId: sql.raw('excluded.format_external_id'),
						name: sql.raw('excluded.name'),
						colors: sql.raw('excluded.colors'),
						sortOrder: sql.raw('excluded.sort_order'),
						isPrimary: false,
						updatedAt: now,
					},
				}));
		}
		for (const deckIds of chunkArray([...changedReviewedDeckIds], SAFE_INARRAY_SIZE)) {
			queries.push(db
				.update(playerDecks)
				.set({ archetypeId: null, reviewedAt: null, updatedAt: now })
				.where(and(
					eq(playerDecks.eventId, eventId),
					inArray(playerDecks.id, deckIds),
				)));
		}

		for (const payload of chunkJsonRows(deckIdentityRows)) {
			const incomingDeckIds = sql`select ${playerDecks.id} from ${playerDecks}
				where ${playerDecks.eventId} = ${eventId}
					and ${playerDecks.externalSource} = 'melee'
					and ${playerDecks.externalId} in (select json_extract(value, '$.externalId') from json_each(${payload}))`;
			queries.push(db.delete(playerDeckCards).where(sql`${playerDeckCards.deckId} in (${incomingDeckIds})`));
			queries.push(db.delete(playerDeckUnresolvedCards).where(sql`${playerDeckUnresolvedCards.deckId} in (${incomingDeckIds})`));
		}

		const cardRows = snapshots.flatMap(snapshot => snapshot.cards.map(card => ({
			externalId: snapshot.deck.externalId,
			...card,
		})));
		for (const payload of chunkJsonRows(cardRows)) {
			queries.push(db.insert(playerDeckCards).select(selectForInsert(playerDeckCards, {
				id: sql`null`,
				deckId: meleeDeckIdByExternalId(eventId),
				cardId: sql`json_extract(value, '$.cardId')`,
				quantity: sql`json_extract(value, '$.quantity')`,
				compartment: sql`json_extract(value, '$.compartment')`,
				sortOrder: sql`json_extract(value, '$.sortOrder')`,
			}, sql`from json_each(${payload})`)));
		}

		const unresolvedRows = snapshots.flatMap(snapshot => snapshot.unresolvedCards.map(card => ({
			externalId: snapshot.deck.externalId,
			...card,
		})));
		for (const payload of chunkJsonRows(unresolvedRows)) {
			queries.push(db.insert(playerDeckUnresolvedCards).select(selectForInsert(playerDeckUnresolvedCards, {
				id: sql`null`,
				deckId: meleeDeckIdByExternalId(eventId),
				entryType: sql`json_extract(value, '$.entryType')`,
				originalName: sql`json_extract(value, '$.originalName')`,
				normalizedOriginalName: sql`json_extract(value, '$.normalizedOriginalName')`,
				setCode: sql`json_extract(value, '$.setCode')`,
				normalizedSetCode: sql`coalesce(json_extract(value, '$.normalizedSetCode'), '')`,
				quantity: sql`coalesce(json_extract(value, '$.quantity'), 1)`,
				compartment: sql`json_extract(value, '$.compartment')`,
				sortOrder: sql`coalesce(json_extract(value, '$.sortOrder'), 0)`,
				cardType: sql`json_extract(value, '$.cardType')`,
				createdAt: sql`${nowMs}`,
				updatedAt: sql`${nowMs}`,
			}, sql`from json_each(${payload})`)));
		}

		const companionClearRows = snapshots
			.filter(snapshot => snapshot.importedCompanion.action === 'clear')
			.map(snapshot => ({ externalId: snapshot.deck.externalId }));
		for (const payload of chunkJsonRows(companionClearRows)) {
			queries.push(db.delete(playerDeckCompanions).where(and(
				eq(playerDeckCompanions.source, 'melee'),
				sql`${playerDeckCompanions.deckId} in (
					select ${playerDecks.id} from ${playerDecks}
					where ${playerDecks.eventId} = ${eventId}
						and ${playerDecks.externalSource} = 'melee'
						and ${playerDecks.externalId} in (select json_extract(value, '$.externalId') from json_each(${payload}))
				)`,
			)));
		}

		const companionSetRows = snapshots.flatMap(snapshot => snapshot.importedCompanion.action === 'set'
			? [{ externalId: snapshot.deck.externalId, companionCardId: snapshot.importedCompanion.cardId }]
			: []);
		for (const payload of chunkJsonRows(companionSetRows)) {
			queries.push(db
				.insert(playerDeckCompanions)
				.select(selectForInsert(playerDeckCompanions, {
					id: sql`null`,
					deckId: meleeDeckIdByExternalId(eventId),
					companionCardId: sql`json_extract(value, '$.companionCardId')`,
					source: sql`'melee'`,
					createdAt: sql`${nowMs}`,
					updatedAt: sql`${nowMs}`,
				}, sql`from json_each(${payload}) where true`))
				.onConflictDoUpdate({
					target: playerDeckCompanions.deckId,
					set: {
						companionCardId: sql.raw('excluded.companion_card_id'),
						source: 'melee',
						updatedAt: now,
					},
					setWhere: eq(playerDeckCompanions.source, 'melee'),
				}));
		}

		for (const payload of targetPayloads) {
			queries.push(db.delete(playerDecks).where(and(
				eq(playerDecks.eventId, eventId),
				eq(playerDecks.externalSource, 'melee'),
				sql`exists (
					select 1 from json_each(${payload}) target
					where cast(json_extract(target.value, '$.playerId') as integer) = ${playerDecks.playerId}
						and not exists (
							select 1 from json_each(json_extract(target.value, '$.retainedExternalIds')) retained
							where retained.value = ${playerDecks.externalId}
						)
				)`,
			)));
		}
		for (const payload of primaryTargetPayloads) {
			queries.push(db.update(playerDecks).set({ isPrimary: true, updatedAt: now }).where(and(
				eq(playerDecks.eventId, eventId),
				eq(playerDecks.externalSource, 'melee'),
				sql`exists (
					select 1 from json_each(${payload}) target
					where cast(json_extract(target.value, '$.playerId') as integer) = ${playerDecks.playerId}
						and json_extract(target.value, '$.primaryExternalId') = ${playerDecks.externalId}
				)`,
			)));
		}

		const projectionByPlayerId = new Map(projections.map(projection => [projection.playerId, projection]));
		const playerProjectionRows = replacements.map((replacement) => {
			const projection = projectionByPlayerId.get(replacement.playerId)!;
			const primary = replacement.snapshots.find(snapshot => snapshot.deck.isPrimary)
				?? replacement.snapshots[0]
				?? null;
			const reviewInvalidated = projection.deckId != null && changedReviewedDeckIds.has(projection.deckId);
			const reviewed = primary != null && !reviewInvalidated && projection.reviewedAt != null && projection.archetypeName != null;
			const gameData = primary
				? {
					...(projection.gameData?.type === 'mtg' ? projection.gameData : {}),
					type: 'mtg',
					deckName: reviewed ? projection.archetypeName : primary.deck.name,
					deckColors: reviewed ? projection.archetypeColors : primary.deck.colors,
				} satisfies MtgPlayerGameData
				: projection.gameData?.type === 'mtg'
					? { ...projection.gameData, deckName: null, deckColors: null }
					: projection.gameData ?? null;
			return {
				playerId: replacement.playerId,
				archetypeId: primary && !reviewInvalidated ? projection.archetypeId ?? null : null,
				gameData,
			};
		});
		for (const payload of chunkJsonRows(playerProjectionRows)) {
			const incoming = sql`(
				select value from json_each(${payload})
				where cast(json_extract(value, '$.playerId') as integer) = ${players.id}
				limit 1
			)`;
			queries.push(db.update(players).set({
				archetypeId: sql`json_extract(${incoming}, '$.archetypeId')`,
				gameData: sql`json_extract(${incoming}, '$.gameData')`,
				updatedAt: now,
			}).where(and(
				eq(players.eventId, eventId),
				sql`${players.id} in (select cast(json_extract(value, '$.playerId') as integer) from json_each(${payload}))`,
			)));
		}

		await db.batch(queries as [typeof queries[0], ...typeof queries]);
	};

	interface PrimaryArchetypeProjectionRow {
		gameData: DbPlayer['gameData'];
		deckId: number | null;
		archetypeId: number | null;
		reviewedAt: Date | null;
		importedName: string | null;
		importedColors: string | null;
		archetypeName: string | null;
		archetypeColors: string | null;
	}

	/** Derive the reviewed state and player-level projection from a primary-deck row. */
	function computeArchetypeProjection(projection: PrimaryArchetypeProjectionRow) {
		const reviewed = projection.reviewedAt != null && projection.archetypeName != null;
		const gameData = projection.deckId != null
			? {
				...(projection.gameData?.type === 'mtg' ? projection.gameData : {}),
				type: 'mtg',
				deckName: reviewed ? projection.archetypeName : projection.importedName,
				deckColors: reviewed ? projection.archetypeColors : projection.importedColors,
			} satisfies MtgPlayerGameData
			: projection.gameData;

		return { reviewed, gameData, archetypeId: projection.archetypeId ?? null };
	}

	/** Keep the player-level archetype as a projection of the primary submitted deck. */
	const reconcilePrimaryArchetype = async (
		eventId: number,
		playerId: number,
		options: ReconcilePrimaryArchetypeOptions = {},
	): Promise<DbPlayer | null> => {
		const [projection] = await db
			.select({
				gameData: players.gameData,
				deckId: playerDecks.id,
				archetypeId: playerDecks.archetypeId,
				reviewedAt: playerDecks.reviewedAt,
				importedName: playerDecks.name,
				importedColors: playerDecks.colors,
				archetypeName: archetypes.name,
				archetypeColors: archetypes.colors,
			})
			.from(players)
			.leftJoin(playerDecks, and(
				eq(playerDecks.eventId, eventId),
				eq(playerDecks.playerId, playerId),
				eq(playerDecks.isPrimary, true),
			))
			.leftJoin(archetypes, eq(playerDecks.archetypeId, archetypes.id))
			.where(and(eq(players.id, playerId), eq(players.eventId, eventId)))
			.limit(1);
		if (!projection)
			return null;

		const { reviewed, gameData, archetypeId } = computeArchetypeProjection(projection);
		if (options.reviewedOnly && !reviewed)
			return null;

		const [player] = await db
			.update(players)
			.set({ archetypeId, gameData, updatedAt: new Date() })
			.where(and(eq(players.id, playerId), eq(players.eventId, eventId)))
			.returning();

		return player ?? null;
	};

	/**
	 * Bulk variant of `reconcilePrimaryArchetype` for reconciling many players at
	 * once (e.g. after an Archetype delete/rename affects a batch of decks).
	 * Fetches the primary-deck projection for all Players in one bulk query per
	 * `SAFE_INARRAY_SIZE` chunk instead of one query per Player, then applies the
	 * per-Player update sequentially (write count and update semantics are
	 * unchanged from calling `reconcilePrimaryArchetype` in a loop).
	 */
	const reconcilePrimaryArchetypesForPlayers = async (
		eventId: number,
		playerIds: number[],
	): Promise<DbPlayer[]> => {
		const uniqueIds = [...new Set(playerIds)];
		if (uniqueIds.length === 0)
			return [];

		const projectionsById = new Map<number, PrimaryArchetypeProjectionRow & { playerId: number }>();
		for (const idChunk of chunkArray(uniqueIds, SAFE_INARRAY_SIZE)) {
			const rows = await db
				.select({
					playerId: players.id,
					gameData: players.gameData,
					deckId: playerDecks.id,
					archetypeId: playerDecks.archetypeId,
					reviewedAt: playerDecks.reviewedAt,
					importedName: playerDecks.name,
					importedColors: playerDecks.colors,
					archetypeName: archetypes.name,
					archetypeColors: archetypes.colors,
				})
				.from(players)
				.leftJoin(playerDecks, and(
					eq(playerDecks.eventId, eventId),
					eq(playerDecks.playerId, players.id),
					eq(playerDecks.isPrimary, true),
				))
				.leftJoin(archetypes, eq(playerDecks.archetypeId, archetypes.id))
				.where(and(
					eq(players.eventId, eventId),
					inArray(players.id, idChunk),
				));
			for (const row of rows) {
				projectionsById.set(row.playerId, row);
			}
		}

		const updated: DbPlayer[] = [];
		for (const playerId of uniqueIds) {
			const projection = projectionsById.get(playerId);
			if (!projection)
				continue;

			const { gameData, archetypeId } = computeArchetypeProjection(projection);
			const [player] = await db
				.update(players)
				.set({ archetypeId, gameData, updatedAt: new Date() })
				.where(and(eq(players.id, playerId), eq(players.eventId, eventId)))
				.returning();

			if (player)
				updated.push(player);
		}

		return updated;
	};

	const listPrimaryPlayerIdsByArchetype = async (eventId: number, archetypeId: number): Promise<number[]> => {
		const rows = await db
			.select({ playerId: playerDecks.playerId })
			.from(playerDecks)
			.where(and(
				eq(playerDecks.eventId, eventId),
				eq(playerDecks.archetypeId, archetypeId),
				eq(playerDecks.isPrimary, true),
			));

		return [...new Set(rows.map(row => row.playerId))];
	};

	const listPlayerIdsByArchetype = async (eventId: number, archetypeId: number): Promise<number[]> => {
		const rows = await db
			.select({ playerId: playerDecks.playerId })
			.from(playerDecks)
			.where(and(
				eq(playerDecks.eventId, eventId),
				eq(playerDecks.archetypeId, archetypeId),
			));

		return [...new Set(rows.map(row => row.playerId))];
	};

	/**
	 * Build (without executing) the write that clears deck classifications for
	 * an archetype. Exposed so callers that need this to commit atomically with
	 * another write (e.g. the archetype's own deletion) can append it to a
	 * shared `db.batch()` instead of running it as its own round trip.
	 */
	const buildClearReviewsByArchetypeQuery = (eventId: number, archetypeId: number) => {
		return db
			.update(playerDecks)
			.set({ archetypeId: null, reviewedAt: null, updatedAt: new Date() })
			.where(and(
				eq(playerDecks.eventId, eventId),
				eq(playerDecks.archetypeId, archetypeId),
			));
	};

	const reviewDeck = async (
		eventId: number,
		playerId: number,
		deckId: number,
		archetypeId: number,
	): Promise<{ deck: DbPlayerDeck; player: DbPlayer | null } | null> => {
		const [existingDeck] = await db
			.select()
			.from(playerDecks)
			.where(and(
				eq(playerDecks.id, deckId),
				eq(playerDecks.eventId, eventId),
				eq(playerDecks.playerId, playerId),
			))
			.limit(1);
		if (!existingDeck)
			return null;

		const [deck] = await db
			.update(playerDecks)
			.set({ archetypeId, reviewedAt: new Date(), updatedAt: new Date() })
			.where(and(
				eq(playerDecks.id, deckId),
				eq(playerDecks.eventId, eventId),
				eq(playerDecks.playerId, playerId),
			))
			.returning();
		if (!deck)
			return null;

		const player = existingDeck.isPrimary
			? await reconcilePrimaryArchetype(eventId, playerId)
			: null;
		return { deck, player };
	};

	const getFormatExternalIdForSelection = async (
		eventId: number,
		selection: PlayerDeckSelection,
	): Promise<string | null> => {
		if (selection.phaseId != null) {
			const [phase] = await db
				.select({ formatExternalId: phases.formatExternalId })
				.from(phases)
				.where(and(eq(phases.id, selection.phaseId), eq(phases.eventId, eventId)))
				.limit(1);
			return phase?.formatExternalId ?? null;
		}

		if (selection.roundId != null) {
			const [round] = await db
				.select({ formatExternalId: phases.formatExternalId })
				.from(rounds)
				.innerJoin(phases, eq(rounds.phaseId, phases.id))
				.where(and(eq(rounds.id, selection.roundId), eq(rounds.eventId, eventId)))
				.limit(1);
			return round?.formatExternalId ?? null;
		}

		return null;
	};

	const selectFromDecks = async (
		eventId: number,
		decks: DbPlayerDeck[],
		selection: PlayerDeckSelection = {},
	): Promise<DbPlayerDeck | null> => {
		if (decks.length === 0)
			return null;

		if (selection.deckId != null) {
			return decks.find(deck => deck.id === selection.deckId) ?? null;
		}

		const formatExternalId = await getFormatExternalIdForSelection(eventId, selection);
		if (formatExternalId) {
			const formatDecks = decks.filter(deck => deck.formatExternalId === formatExternalId);
			if (formatDecks.length > 0) {
				return formatDecks[0] ?? null;
			}
		}

		return decks.find(deck => deck.isPrimary) ?? decks[0] ?? null;
	};

	const findManyByIds = async (eventId: number, deckIds: number[]): Promise<DbPlayerDeck[]> => {
		if (deckIds.length === 0)
			return [];

		const decks: DbPlayerDeck[] = [];
		for (const idChunk of chunkArray(deckIds, SAFE_INARRAY_SIZE)) {
			decks.push(...await db
				.select()
				.from(playerDecks)
				.where(and(
					eq(playerDecks.eventId, eventId),
					inArray(playerDecks.id, idChunk),
				)));
		}
		return decks;
	};

	return {
		listByPlayer,
		listByEvent,
		replaceMeleeDecksForEvent,
		reconcilePrimaryArchetype,
		reconcilePrimaryArchetypesForPlayers,
		listPlayerIdsByArchetype,
		listPrimaryPlayerIdsByArchetype,
		buildClearReviewsByArchetypeQuery,
		reviewDeck,
		selectFromDecks,
		findManyByIds,
	};
}
