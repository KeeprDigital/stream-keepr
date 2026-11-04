import type { PlayerSide } from '~~/shared/types/enums';
import type { OpUnresolvedDeckCard, OpUnresolvedDeckCardAnswer, OpUnresolvedDeckCardDeckList } from '~~/shared/types/opUnresolvedDeckCard';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '~~/server/db';
import { cards, featureMatchDeckListEntries, featureMatchDeckLists, featureMatches, playerDecks, playerDeckUnresolvedCards, players } from '~~/server/db/schema';
import { opCardCatalogueModule } from '~~/server/modules/op-card-catalogue';
import { opDeckListWriteModule } from '~~/server/modules/op-deck-list-write';
import { deckListReferenceOf, featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { opCatalogueRowFor } from '~~/server/services/opCardCatalogue';
import { opPlayerDeckListService } from '~~/server/services/opPlayerDeckList';
import { bandaiKeeprConfig } from '~~/server/utils/bandaiKeepr';
import { requireOpEvent } from '~~/server/utils/routeGuards';
import { playerDisplayName } from '~~/shared/utils/playerName';

/**
 * One Piece Card Game Unresolved Deck Cards (ADR-0074): the card numbers
 * bandai-keepr did not know, listed Event-wide across Player Deck Lists and
 * the Feature Match Deck Lists Slot sides hold.
 */

interface HeldEntry extends OpUnresolvedDeckCardDeckList {
	number: string;
	/** The Feature Match Deck List a Slot side holds it in. */
	deckListId?: number;
}

const SIDES = ['player1', 'player2'] as const satisfies readonly PlayerSide[];
const SIDE_DATA_KEY = { player1: 'player1Data', player2: 'player2Data' } as const satisfies Record<PlayerSide, string>;

/** Every Deck List entry in the Event holding a number bandai-keepr did not know, or only `number`'s. */
async function heldEntries(eventId: number, number?: string): Promise<HeldEntry[]> {
	const [playerRows, slotRows, slots] = await Promise.all([
		db.select({
			number: playerDeckUnresolvedCards.normalizedOriginalName,
			quantity: playerDeckUnresolvedCards.quantity,
			playerId: playerDecks.playerId,
			leaderCardNumber: playerDecks.leaderCardNumber,
			name: players.name,
			nickname: players.nickname,
		})
			.from(playerDeckUnresolvedCards)
			.innerJoin(playerDecks, eq(playerDecks.id, playerDeckUnresolvedCards.deckId))
			.innerJoin(players, eq(players.id, playerDecks.playerId))
			.where(and(
				eq(playerDecks.eventId, eventId),
				eq(playerDecks.isPrimary, true),
				eq(playerDeckUnresolvedCards.entryType, 'card'),
				number === undefined
					? undefined
					: eq(playerDeckUnresolvedCards.normalizedOriginalName, number),
			))
			.orderBy(asc(playerDeckUnresolvedCards.sortOrder)),
		db.select({
			number: featureMatchDeckListEntries.cardNumber,
			quantity: featureMatchDeckListEntries.quantity,
			deckListId: featureMatchDeckListEntries.deckListId,
		})
			.from(featureMatchDeckListEntries)
			.innerJoin(featureMatchDeckLists, eq(featureMatchDeckLists.id, featureMatchDeckListEntries.deckListId))
			.leftJoin(cards, opCatalogueRowFor(featureMatchDeckListEntries.cardNumber))
			.where(and(
				eq(featureMatchDeckLists.eventId, eventId),
				isNull(cards.id),
				number === undefined
					? undefined
					: eq(featureMatchDeckListEntries.cardNumber, number),
			))
			.orderBy(asc(featureMatchDeckListEntries.sortOrder)),
		db.select({
			id: featureMatches.id,
			player1Data: featureMatches.player1Data,
			player2Data: featureMatches.player2Data,
		})
			.from(featureMatches)
			.where(eq(featureMatches.eventId, eventId))
			.orderBy(asc(featureMatches.sortOrder), asc(featureMatches.id)),
	]);

	const playerEntries: HeldEntry[] = playerRows
		.map(row => ({
			number: row.number,
			quantity: row.quantity,
			asLeader: row.leaderCardNumber === row.number,
			holder: {
				kind: 'player' as const,
				playerId: row.playerId,
				name: playerDisplayName(row),
			},
		}))
		.toSorted((left, right) => left.holder.name.localeCompare(right.holder.name) || left.holder.playerId - right.holder.playerId);

	// Only a Deck List a side holds is in play; an older one is on its way out.
	const sideEntries: HeldEntry[] = slots.flatMap(slot => SIDES.flatMap((side) => {
		const data = slot[SIDE_DATA_KEY[side]];
		const reference = deckListReferenceOf(data);
		if (!reference)
			return [];
		return slotRows
			.filter(row => row.deckListId === reference.id)
			.map(row => ({
				number: row.number,
				quantity: row.quantity,
				// A number bandai-keepr does not know is never recognised as a pasted Leader.
				asLeader: false,
				holder: {
					kind: 'slotSide' as const,
					slotId: slot.id,
					side,
					name: playerDisplayName(data),
				},
				deckListId: reference.id,
			}));
	}));

	return [
		...playerEntries,
		...sideEntries,
	];
}

export function opUnresolvedDeckCardModule() {
	const catalogue = opCardCatalogueModule();
	const write = opDeckListWriteModule();
	const playerDeckLists = opPlayerDeckListService();
	const featureMatchDeckLists = featureMatchDeckListService();

	/** The Event's Unresolved Deck Cards, the one held by the most Deck Lists first. */
	async function list({ eventId }: { eventId: number }): Promise<OpUnresolvedDeckCard[]> {
		await requireOpEvent(eventId);
		const byNumber = new Map<string, OpUnresolvedDeckCard>();
		for (const { number, deckListId: _deckListId, ...deckList } of await heldEntries(eventId)) {
			const card = byNumber.get(number) ?? { number, copies: 0, deckLists: [] };
			card.copies += deckList.quantity;
			card.deckLists.push(deckList);
			byNumber.set(number, card);
		}
		return [
			...byNumber.values(),
		].toSorted((left, right) =>
			right.deckLists.length - left.deckLists.length
			|| right.copies - left.copies
			|| left.number.localeCompare(right.number));
	}

	/**
	 * Rewrites `from` as `to` in every Deck List holding it, each through the OP
	 * Deck List write, which keeps whether it was hand-edited. A Deck List already
	 * holding `to` takes the copies into that entry; a Leader moves with its number.
	 */
	async function rewrite(eventId: number, held: readonly HeldEntry[], from: string, to: string): Promise<number> {
		const rename = (number: string) => number === from
			? to
			: number;
		let rewritten = 0;
		const playerIds = new Set<number>();
		for (const { holder, deckListId } of held) {
			if (holder.kind === 'player') {
				if (playerIds.has(holder.playerId))
					continue;
				playerIds.add(holder.playerId);
				const deckList = await playerDeckLists.findByPlayer(eventId, holder.playerId);
				if (!deckList)
					continue;
				await write.write({
					eventId,
					owner: { kind: 'player', playerId: holder.playerId },
					input: {
						entries: deckList.entries.map(entry => ({
							number: rename(entry.number),
							quantity: entry.quantity,
						})),
						leaderNumber: deckList.leaderNumber === null
							? null
							: rename(deckList.leaderNumber),
					},
					source: 'resolution',
				});
			}
			else {
				const deckList = deckListId === undefined
					? null
					: await featureMatchDeckLists.findById(deckListId, holder.slotId, eventId);
				if (!deckList)
					continue;
				await write.write({
					eventId,
					owner: { kind: 'slotSide', slotId: holder.slotId, side: holder.side },
					input: {
						entries: deckList.entries.map(entry => ({
							number: rename(entry.number),
							quantity: entry.quantity,
						})),
						leaderNumber: null,
					},
					source: 'resolution',
				});
			}
			rewritten++;
		}
		return rewritten;
	}

	async function requireHeld(eventId: number, number: string): Promise<HeldEntry[]> {
		const held = await heldEntries(eventId, number);
		if (held.length === 0)
			throw createError({ statusCode: 404, message: `No Deck List in the Event holds ${number} unresolved` });
		return held;
	}

	/**
	 * Looks the number up again, through the catalogue and the bulk lookup. A
	 * card bandai-keepr now knows resolves every Deck List holding it; one it
	 * still does not know rewrites nothing.
	 */
	async function retry({ eventId, number }: { eventId: number; number: string }): Promise<OpUnresolvedDeckCardAnswer> {
		await requireOpEvent(eventId);
		const held = await requireHeld(eventId, number);
		const card = (await catalogue.resolve(bandaiKeeprConfig, [number])).get(number) ?? null;
		if (!card)
			return { number, card: null, rewritten: 0 };
		return {
			number,
			card: { number, name: card.name },
			rewritten: await rewrite(eventId, held, number, number),
		};
	}

	/**
	 * Names the number as the card the operator picked from a bandai-keepr
	 * search, in every Deck List in the Event holding it (as ADR-0031 does for
	 * MTG). A picked card bandai-keepr does not know is refused.
	 */
	async function resolve({ eventId, number, cardNumber }: { eventId: number; number: string; cardNumber: string }): Promise<OpUnresolvedDeckCardAnswer> {
		await requireOpEvent(eventId);
		const held = await requireHeld(eventId, number);
		const card = (await catalogue.resolve(bandaiKeeprConfig, [cardNumber])).get(cardNumber) ?? null;
		if (!card)
			throw createError({ statusCode: 400, message: `bandai-keepr has no card ${cardNumber}` });
		return {
			number,
			card: { number: cardNumber, name: card.name },
			rewritten: await rewrite(eventId, held, number, cardNumber),
		};
	}

	return { list, retry, resolve };
}
