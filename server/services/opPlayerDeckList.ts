import type { BatchItem } from 'drizzle-orm/batch';
import type { DbPlayer } from '~~/server/db/schema';
import type { OpDeckListView, SavedOpPlayerDeckList } from '~~/shared/types/opDeckList';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { cards, playerDeckCards, playerDecks, playerDeckUnresolvedCards, players } from '~~/server/db/schema';
import { opDeckListText, opDeckListView } from '~~/server/modules/op-deck-list-write/paste';
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

/** The deck row the replacement inserts, found by the statements batched after it. */
function primaryDeckIdOf(playerId: number) {
	return sql`(select ${playerDecks.id} from ${playerDecks} where ${playerDecks.playerId} = ${playerId} and ${playerDecks.isPrimary} = 1)`;
}

export function opPlayerDeckListService() {
	/**
	 * The statements replacing a Player's Deck List, for one batch: the old one
	 * and its entries go, the new one is stored, and the Player's Archetype and
	 * Deck List reference follow it. The last statement returns the Player.
	 */
	const buildReplaceQueries = ({ eventId, playerId, view, archetypeId, handEdited }: OpPlayerDeckListReplacement): BatchItem<'sqlite'>[] => {
		const leader = view.entries.find(entry => entry.number === view.leaderNumber)?.card ?? null;
		const writeAtMs = Date.now();
		const rows = view.entries.map((entry, sortOrder) => ({ number: entry.number, quantity: entry.quantity, sortOrder }));
		const catalogued = rows.filter((_, index) => view.entries[index]!.card !== null);
		const unresolved = rows.filter((_, index) => view.entries[index]!.card === null);
		const deckId = primaryDeckIdOf(playerId);

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

		return [
			db.delete(playerDecks).where(and(eq(playerDecks.eventId, eventId), eq(playerDecks.playerId, playerId))),
			db.insert(playerDecks).values({
				eventId,
				playerId,
				// One Deck List per Player; its identity is the Player's, not an import's.
				externalId: `player:${playerId}`,
				externalSource: 'manual',
				formatExternalId: 'op',
				name: leader?.name ?? '',
				colors: leader
					? formatOpColors(leader.colors)
					: '',
				isPrimary: true,
				archetypeId,
				leaderCardNumber: view.leaderNumber,
				handEdited,
			}),
			...insertCards,
			...insertUnresolved,
			db.update(players)
				.set({
					archetypeId,
					gameData: sql`json_object(
						'type', 'op',
						'deckList', json_object('id', ${deckId}, 'mainboardCount', ${view.mainboardCount}, 'leaderNumber', ${view.leaderNumber})
					)`,
					updatedAt: new Date(writeAtMs),
				})
				.where(and(eq(players.eventId, eventId), eq(players.id, playerId)))
				.returning(),
		];
	};

	/** Runs `buildReplaceQueries`, answering the Player as written, or `null` when there is none. */
	const replace = async (replacement: OpPlayerDeckListReplacement): Promise<DbPlayer | null> => {
		const queries = buildReplaceQueries(replacement);
		const results = await db.batch(queries as [typeof queries[0], ...typeof queries]);
		const [player] = results.at(-1) as DbPlayer[];
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

	return { buildReplaceQueries, replace, findByPlayer };
}
