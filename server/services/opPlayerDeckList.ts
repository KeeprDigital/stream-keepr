import type { SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DbPlayer } from '~~/server/db/schema';
import type { OpDeckListLine, OpDeckListView, SavedOpPlayerDeckList } from '~~/shared/types/opDeckList';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { cards, playerDeckCards, playerDecks, playerDeckUnresolvedCards, players } from '~~/server/db/schema';
import { opDeckListLeaderCard, opDeckListText, opDeckListView } from '~~/server/modules/op-deck-list-write/paste';
import { opCatalogueCardColumns, opCatalogueRowFor, toOpCatalogueCard } from '~~/server/services/opCardCatalogue';
import { chunkJsonRows, selectForInsert } from '~~/server/utils/db';
import { formatOpColors } from '~~/shared/utils/card/op';

/**
 * Storage of One Piece Card Game Player Deck Lists (ADR-0074): one
 * `player_decks` row per Player, replaced whole by every write, so each write
 * gives the Deck List a new id. A catalogued entry is a `player_deck_cards`
 * row on its catalogue card, as a Magic: The Gathering Deck List's are, so the
 * Metagame reads both alike; a number the catalogue lacks is an Unresolved
 * Deck Card holding the number as its name.
 */

/** A Deck List the OP Deck List write has resolved, ready to store for a Player. */
export interface OpPlayerDeckListReplacement {
	eventId: number;
	playerId: number;
	view: OpDeckListView;
	/** The Player's Archetype: the one derived from their Leader, or none for an unknown Leader. */
	archetypeId: number | null;
	handEdited: boolean;
}

/** What a Player's stored Deck List holds, to tell whether an import changes it. */
export interface OpPlayerDeckListContents {
	leaderNumber: string | null;
	handEdited: boolean;
	/** Each entry, and whether its card is catalogued or an Unresolved Deck Card. */
	entries: Array<OpDeckListLine & { resolved: boolean }>;
}

/** A Player's primary deck row, which the statements batched after its insert find it by. */
function primaryDeckIdOf(playerId: SQL) {
	return sql`(select ${playerDecks.id} from ${playerDecks} where ${playerDecks.playerId} = ${playerId} and ${playerDecks.isPrimary} = 1)`;
}

const PAYLOAD_PLAYER_ID = sql`json_extract(value, '$.playerId')`;
// `json_each` has an `id` column of its own, so the Player's is named in full.
const PLAYER_ID = sql.raw('"players"."id"');

export function opPlayerDeckListService() {
	/**
	 * The statements replacing each Player's Deck List, for one batch: the old
	 * ones and their entries go, the new ones are stored, and each Player's
	 * Archetype and Deck List reference follow theirs. However many Players,
	 * they are a few bulk statements; the last `playerQueryCount` return the
	 * Players written.
	 */
	const buildReplaceManyQueries = (eventId: number, replacements: readonly OpPlayerDeckListReplacement[]): { queries: BatchItem<'sqlite'>[]; playerQueryCount: number } => {
		const writeAtMs = Date.now();
		const decks = replacements.map(({ playerId, view, archetypeId, handEdited }) => {
			const leader = opDeckListLeaderCard(view);
			return {
				playerId,
				name: leader?.name ?? '',
				colors: leader
					? formatOpColors(leader.colors)
					: '',
				archetypeId,
				leaderNumber: view.leaderNumber,
				handEdited,
				mainboardCount: view.mainboardCount,
			};
		});
		const rows = replacements.flatMap(({ playerId, view }) => view.entries.map((entry, sortOrder) => ({
			playerId,
			number: entry.number,
			quantity: entry.quantity,
			sortOrder,
			catalogued: entry.card !== null,
		})));
		const catalogued = rows.filter(row => row.catalogued);
		const unresolved = rows.filter(row => !row.catalogued);
		const deckId = primaryDeckIdOf(PAYLOAD_PLAYER_ID);
		const deckPayloads = chunkJsonRows(decks);
		const inPayload = (column: SQL | typeof playerDecks.playerId, payload: string) =>
			sql`${column} in (select json_extract(value, '$.playerId') from json_each(${payload}))`;

		const deleteDecks = deckPayloads.map(payload => db.delete(playerDecks)
			.where(and(eq(playerDecks.eventId, eventId), inPayload(playerDecks.playerId, payload))));
		const insertDecks = deckPayloads.map(payload => db
			.insert(playerDecks)
			.select(selectForInsert(playerDecks, {
				id: sql`null`,
				eventId: sql`${eventId}`,
				playerId: PAYLOAD_PLAYER_ID,
				// One Deck List per Player; its identity is the Player's, not an import's.
				externalId: sql`'player:' || json_extract(value, '$.playerId')`,
				externalSource: sql`'manual'`,
				formatExternalId: sql`'op'`,
				name: sql`json_extract(value, '$.name')`,
				colors: sql`json_extract(value, '$.colors')`,
				sortOrder: sql`0`,
				isPrimary: sql`1`,
				archetypeId: sql`json_extract(value, '$.archetypeId')`,
				reviewedAt: sql`null`,
				leaderCardNumber: sql`json_extract(value, '$.leaderNumber')`,
				handEdited: sql`json_extract(value, '$.handEdited')`,
				createdAt: sql`${writeAtMs}`,
				updatedAt: sql`${writeAtMs}`,
			}, sql`from json_each(${payload}) where true`)));
		const insertCards = chunkJsonRows(catalogued).map(payload => db
			.insert(playerDeckCards)
			.select(selectForInsert(playerDeckCards, {
				id: sql`null`,
				deckId,
				cardId: sql`(select ${cards.id} from ${cards} where ${opCatalogueRowFor(sql`json_extract(value, '$.number')`)})`,
				quantity: sql`json_extract(value, '$.quantity')`,
				compartment: sql`'mainboard'`,
				sortOrder: sql`json_extract(value, '$.sortOrder')`,
			}, sql`from json_each(${payload}) where true`)));
		const insertUnresolved = chunkJsonRows(unresolved).map(payload => db
			.insert(playerDeckUnresolvedCards)
			.select(selectForInsert(playerDeckUnresolvedCards, {
				id: sql`null`,
				deckId,
				entryType: sql`'card'`,
				// An OP card number is its own normalised name: Unresolved Deck Cards are found by it.
				originalName: sql`json_extract(value, '$.number')`,
				normalizedOriginalName: sql`json_extract(value, '$.number')`,
				setCode: sql`null`,
				normalizedSetCode: sql`''`,
				quantity: sql`json_extract(value, '$.quantity')`,
				compartment: sql`'mainboard'`,
				sortOrder: sql`json_extract(value, '$.sortOrder')`,
				cardType: sql`null`,
				createdAt: sql`${writeAtMs}`,
				updatedAt: sql`${writeAtMs}`,
			}, sql`from json_each(${payload}) where true`)));
		const deckOf = (payload: string, expression: SQL) =>
			sql`(select ${expression} from json_each(${payload}) where json_extract(value, '$.playerId') = ${PLAYER_ID})`;
		const updatePlayers = deckPayloads.map(payload => db.update(players)
			.set({
				archetypeId: deckOf(payload, sql`json_extract(value, '$.archetypeId')`),
				gameData: deckOf(payload, sql`json_object(
					'type', 'op',
					'deckList', json_object(
						'id', ${primaryDeckIdOf(PLAYER_ID)},
						'mainboardCount', json_extract(value, '$.mainboardCount'),
						'leaderNumber', json_extract(value, '$.leaderNumber')
					)
				)`),
				updatedAt: new Date(writeAtMs),
			})
			.where(and(eq(players.eventId, eventId), inPayload(PLAYER_ID, payload)))
			.returning());

		return {
			queries: [
				...deleteDecks,
				...insertDecks,
				...insertCards,
				...insertUnresolved,
				...updatePlayers,
			],
			playerQueryCount: updatePlayers.length,
		};
	};

	/** The statements replacing one Player's Deck List, for one batch. The last returns the Player. */
	const buildReplaceQueries = (replacement: OpPlayerDeckListReplacement): BatchItem<'sqlite'>[] =>
		buildReplaceManyQueries(replacement.eventId, [replacement]).queries;

	/** Replaces each Player's Deck List in one batch, answering the Players as written; a missing Player is left out. */
	const replaceMany = async (eventId: number, replacements: readonly OpPlayerDeckListReplacement[]): Promise<DbPlayer[]> => {
		if (replacements.length === 0)
			return [];
		const { queries, playerQueryCount } = buildReplaceManyQueries(eventId, replacements);
		const results = await db.batch(queries as [typeof queries[0], ...typeof queries]);
		return results.slice(-playerQueryCount).flat() as DbPlayer[];
	};

	/** Replaces a Player's Deck List, answering the Player as written, or `null` when there is none. */
	const replace = async (replacement: OpPlayerDeckListReplacement): Promise<DbPlayer | null> => {
		const [player] = await replaceMany(replacement.eventId, [replacement]);
		return player ?? null;
	};

	/** A Player's Deck List, each entry's card read from the catalogue; `null` for a Player with none. */
	const findByPlayer = async (eventId: number, playerId: number): Promise<SavedOpPlayerDeckList | null> => {
		const deck = await db.query.playerDecks.findFirst({
			where: and(eq(playerDecks.eventId, eventId), eq(playerDecks.playerId, playerId), eq(playerDecks.isPrimary, true)),
		});
		if (!deck)
			return null;
		const [catalogued, unresolved] = await Promise.all([
			db.select({
				number: cards.cardNumber,
				quantity: playerDeckCards.quantity,
				sortOrder: playerDeckCards.sortOrder,
				...opCatalogueCardColumns,
			})
				.from(playerDeckCards)
				.innerJoin(cards, eq(cards.id, playerDeckCards.cardId))
				.where(eq(playerDeckCards.deckId, deck.id)),
			db.select({
				number: playerDeckUnresolvedCards.originalName,
				quantity: playerDeckUnresolvedCards.quantity,
				sortOrder: playerDeckUnresolvedCards.sortOrder,
			})
				.from(playerDeckUnresolvedCards)
				.where(eq(playerDeckUnresolvedCards.deckId, deck.id))
				.orderBy(asc(playerDeckUnresolvedCards.sortOrder)),
		]);
		const entries = [
			...catalogued.map(row => ({
				number: row.number ?? '',
				quantity: row.quantity,
				sortOrder: row.sortOrder,
				card: toOpCatalogueCard(row),
			})),
			...unresolved.map(row => ({ ...row, card: null })),
		]
			.toSorted((left, right) => left.sortOrder - right.sortOrder)
			.map(({ number, quantity, card }) => ({ number, quantity, card }));
		const view = opDeckListView(entries, deck.leaderCardNumber);
		return {
			id: deck.id,
			playerId,
			handEdited: deck.handEdited,
			sourceText: opDeckListText(view.entries, view.leaderNumber),
			...view,
		};
	};

	/** What each Player in the Event holds in their Deck List, by Player. */
	const findContentsByEvent = async (eventId: number): Promise<Map<number, OpPlayerDeckListContents>> => {
		const primary = and(eq(playerDecks.eventId, eventId), eq(playerDecks.isPrimary, true));
		const [decks, catalogued, unresolved] = await Promise.all([
			db.select({ playerId: playerDecks.playerId, leaderNumber: playerDecks.leaderCardNumber, handEdited: playerDecks.handEdited })
				.from(playerDecks)
				.where(primary),
			db.select({
				playerId: playerDecks.playerId,
				number: cards.cardNumber,
				quantity: playerDeckCards.quantity,
				sortOrder: playerDeckCards.sortOrder,
			})
				.from(playerDeckCards)
				.innerJoin(playerDecks, eq(playerDecks.id, playerDeckCards.deckId))
				.innerJoin(cards, eq(cards.id, playerDeckCards.cardId))
				.where(primary),
			db.select({
				playerId: playerDecks.playerId,
				number: playerDeckUnresolvedCards.originalName,
				quantity: playerDeckUnresolvedCards.quantity,
				sortOrder: playerDeckUnresolvedCards.sortOrder,
			})
				.from(playerDeckUnresolvedCards)
				.innerJoin(playerDecks, eq(playerDecks.id, playerDeckUnresolvedCards.deckId))
				.where(primary),
		]);
		const contents = new Map<number, OpPlayerDeckListContents>(decks.map(({ playerId, ...deck }) => [
			playerId,
			{ ...deck, entries: [] },
		]));
		// In the Deck List's own order, so a rewrite built from these keeps it.
		const rows = [
			...catalogued.map(row => ({ ...row, number: row.number ?? '', resolved: true })),
			...unresolved.map(row => ({ ...row, resolved: false })),
		].toSorted((left, right) => left.sortOrder - right.sortOrder);
		for (const { playerId, number, quantity, resolved } of rows)
			contents.get(playerId)?.entries.push({ number, quantity, resolved });
		return contents;
	};

	return {
		buildReplaceQueries,
		replace,
		replaceMany,
		findByPlayer,
		findContentsByEvent,
	};
}
