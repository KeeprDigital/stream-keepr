import type { BatchItem } from 'drizzle-orm/batch';
import type { H3Event } from 'h3';
import type { DbPlayerDeckUnresolvedCard, DeckListCompartment } from '~~/server/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from 'hub:db';
import {
	cards,
	eventCardNameOverrides,
	playerDeckCards,
	playerDeckCompanions,
	playerDeckUnresolvedCards,
} from '~~/server/db/schema';
import { requireMeleeSyncEventData } from '~~/server/modules/melee-sync/eventData';
import { playerDeckService } from '~~/server/services/playerDeck';
import { DeckCompanionValidationError, playerDeckCompanionService } from '~~/server/services/playerDeckCompanion';
import { playerDeckUnresolvedCardService } from '~~/server/services/playerDeckUnresolvedCard';
import { normalizeImportedCardName, normalizeImportedSetCode } from '~~/server/utils/cardNameNormalization';
import { chunkArray, SAFE_INARRAY_SIZE } from '~~/server/utils/db';
import { throwRetryableUpstreamRefusal } from '~~/server/utils/retryableUpstreamRefusal';
import { fetchScryfallCardById } from '~~/server/utils/scryfall';

/** Four copies of each ID are bound in the conditional merge expressions. */
const RESOLUTION_MERGE_ID_CHUNK_SIZE = 20;

export interface ResolveUnresolvedDeckCardInput {
	eventId: number;
	unresolvedCardId: number;
	scryfallId: string;
	/**
	 * The request being answered, carried in only so the upstream-outage refusal below
	 * can set `retry-after` on it (#346). Named for the HTTP request rather than
	 * `event`, because `eventId` beside it means a tournament Event — the same
	 * disambiguation `melee-sync` makes with `requestEvent`.
	 */
	requestEvent: H3Event;
}

export interface ResolveUnresolvedDeckCardResult {
	success: true;
	message: string;
	resolvedCardName: string;
	unresolvedId: number;
	resolvedCount: number;
}

async function validateMatchingEntriesBelongToEvent(eventId: number, matchingEntries: Array<{ deckId: number }>) {
	const deckIds = [...new Set(matchingEntries.map(entry => entry.deckId))];
	const eventDecks = await playerDeckService().findManyByIds(eventId, deckIds);

	if (eventDecks.length !== deckIds.length) {
		throw createError({ statusCode: 409, statusMessage: 'Unresolved deck card references a deck outside this event' });
	}
}

interface ExistingDeckCard {
	id: number;
	deckId: number;
	quantity: number;
	compartment: DeckListCompartment;
	sortOrder: number;
}

function groupCardEntries(entries: DbPlayerDeckUnresolvedCard[]) {
	const groups = new Map<string, {
		deckId: number;
		compartment: DeckListCompartment;
		entries: DbPlayerDeckUnresolvedCard[];
	}>();

	for (const entry of entries) {
		const compartment = entry.compartment ?? 'mainboard';
		const key = `${entry.deckId}:${compartment}`;
		const group = groups.get(key) ?? { deckId: entry.deckId, compartment, entries: [] };
		group.entries.push(entry);
		groups.set(key, group);
	}

	return [...groups.values()];
}

async function listExistingDeckCards(deckIds: number[], cardName: string): Promise<ExistingDeckCard[]> {
	const rows: ExistingDeckCard[] = [];
	for (const deckIdChunk of chunkArray(deckIds, SAFE_INARRAY_SIZE)) {
		rows.push(...await db
			.select({
				id: playerDeckCards.id,
				deckId: playerDeckCards.deckId,
				quantity: playerDeckCards.quantity,
				compartment: playerDeckCards.compartment,
				sortOrder: playerDeckCards.sortOrder,
			})
			.from(playerDeckCards)
			.innerJoin(cards, eq(playerDeckCards.cardId, cards.id))
			.where(and(
				inArray(playerDeckCards.deckId, deckIdChunk),
				eq(cards.name, cardName),
				eq(cards.game, 'mtg'),
			)));
	}
	return rows;
}

export function deckListResolutionModule() {
	const unresolvedCards = playerDeckUnresolvedCardService();
	const companions = playerDeckCompanionService();

	async function resolveUnresolvedDeckCard({
		eventId,
		unresolvedCardId,
		scryfallId,
		requestEvent,
	}: ResolveUnresolvedDeckCardInput): Promise<ResolveUnresolvedDeckCardResult> {
		await requireMeleeSyncEventData(eventId);

		const unresolvedCard = await unresolvedCards.findById(unresolvedCardId, eventId);
		if (!unresolvedCard) {
			throw createError({ statusCode: 404, statusMessage: 'Unresolved deck card not found' });
		}

		const matchingEntries = await unresolvedCards.listMatchingEntries(
			eventId,
			unresolvedCard.normalizedOriginalName,
			unresolvedCard.normalizedSetCode,
			unresolvedCard.entryType,
		);
		if (matchingEntries.length === 0) {
			throw createError({ statusCode: 404, statusMessage: 'No unresolved deck cards remain for this group' });
		}

		await validateMatchingEntriesBelongToEvent(eventId, matchingEntries);

		let scryfallData;
		try {
			scryfallData = await fetchScryfallCardById(scryfallId);
		}
		catch (error) {
			const failure = error && typeof error === 'object'
				? error as { code?: unknown; notFound?: unknown }
				: null;
			if (failure?.code !== 'SCRYFALL_UPSTREAM_FAILURE')
				throw error;

			if (failure.notFound === true) {
				throw createError({
					statusCode: 400,
					statusMessage: 'Bad Request',
					message: 'The selected Scryfall card was not found',
					cause: error,
				});
			}

			// Inside this branch rather than the enclosing catch on purpose: the 400
			// above is a card ID the provider does not have, and no amount of waiting
			// resolves that — and its fields stay live, because the mapper declines
			// `notFound` causes and the sanitizer leaves sub-500s alone. Here the
			// mapper fires (`SCRYFALL_UPSTREAM_FAILURE` without `notFound`); see
			// `throwRetryableUpstreamRefusal` for why nothing is spelled here.
			throwRetryableUpstreamRefusal(requestEvent, error);
		}
		const [existingResolvedCard] = unresolvedCard.entryType === 'companion'
			? await db
					.select({ id: cards.id })
					.from(cards)
					.where(and(eq(cards.name, scryfallData.name), eq(cards.game, 'mtg')))
					.limit(1)
			: [];
		const now = new Date();
		const resolvedCardId = sql<number>`(
			select ${cards.id}
			from ${cards}
			where ${cards.name} = ${scryfallData.name} and ${cards.game} = ${'mtg'}
			limit 1
		)`;
		const queries: BatchItem<'sqlite'>[] = [
			db
				.insert(cards)
				.values({
					name: scryfallData.name,
					game: 'mtg',
					scryfallId: scryfallData.id,
					oracleId: scryfallData.oracleId,
					cardType: scryfallData.typeLine,
					colors: scryfallData.colors,
					cmc: scryfallData.cmc,
					manaCost: scryfallData.manaCost,
					deckCounterTypes: scryfallData.deckCounterTypes,
					deckTokens: scryfallData.deckTokens,
				})
				.onConflictDoUpdate({
					target: [cards.name, cards.game],
					set: {
						scryfallId: scryfallData.id,
						oracleId: scryfallData.oracleId,
						cardType: scryfallData.typeLine,
						colors: scryfallData.colors,
						cmc: scryfallData.cmc,
						manaCost: scryfallData.manaCost,
						deckCounterTypes: scryfallData.deckCounterTypes,
						deckTokens: scryfallData.deckTokens,
						updatedAt: now,
					},
				}),
			db
				.insert(eventCardNameOverrides)
				.values({
					eventId,
					inputName: unresolvedCard.originalName.trim(),
					normalizedInputName: normalizeImportedCardName(unresolvedCard.originalName),
					inputSetCode: unresolvedCard.setCode ?? null,
					normalizedInputSetCode: normalizeImportedSetCode(unresolvedCard.setCode),
					resolvedCardId,
				})
				.onConflictDoUpdate({
					target: [
						eventCardNameOverrides.eventId,
						eventCardNameOverrides.normalizedInputName,
						eventCardNameOverrides.normalizedInputSetCode,
					],
					set: {
						inputName: unresolvedCard.originalName.trim(),
						inputSetCode: unresolvedCard.setCode ?? null,
						resolvedCardId,
						updatedAt: now,
					},
				}),
		];

		if (unresolvedCard.entryType === 'companion') {
			const entriesByDeck = new Map<number, DbPlayerDeckUnresolvedCard[]>();
			for (const matchingEntry of matchingEntries) {
				const deckEntries = entriesByDeck.get(matchingEntry.deckId) ?? [];
				deckEntries.push(matchingEntry);
				entriesByDeck.set(matchingEntry.deckId, deckEntries);
			}

			for (const [deckId, deckEntries] of entriesByDeck) {
				try {
					const shouldSync = await companions.shouldSyncImportedCompanion(deckId, existingResolvedCard?.id ?? -1);
					if (!shouldSync)
						continue;
				}
				catch (error) {
					if (error instanceof DeckCompanionValidationError) {
						throw createError({ statusCode: 400, statusMessage: error.message });
					}

					throw error;
				}

				const entryIds = deckEntries.slice(0, SAFE_INARRAY_SIZE).map(entry => entry.id);
				queries.push(db
					.insert(playerDeckCompanions)
					.select(sql`
						select ${deckId}, ${resolvedCardId}, ${'melee'}
						from ${playerDeckUnresolvedCards}
						where ${inArray(playerDeckUnresolvedCards.id, entryIds)}
						limit 1
					`)
					.onConflictDoUpdate({
						target: playerDeckCompanions.deckId,
						set: { companionCardId: resolvedCardId, source: 'melee', updatedAt: now },
						setWhere: eq(playerDeckCompanions.source, 'melee'),
					}));
			}
		}
		else {
			const deckIds = [...new Set(matchingEntries.map(entry => entry.deckId))];
			const existingRows = await listExistingDeckCards(deckIds, scryfallData.name);
			for (const group of groupCardEntries(matchingEntries)) {
				const existingForGroup = existingRows
					.filter(row => row.deckId === group.deckId && row.compartment === group.compartment)
					.sort((left, right) => left.sortOrder - right.sortOrder || left.id - right.id);
				const canonical = existingForGroup[0];
				const entryIdChunks = chunkArray(group.entries.map(entry => entry.id), RESOLUTION_MERGE_ID_CHUNK_SIZE);
				const firstChunk = entryIdChunks[0]!;

				if (canonical) {
					const existingQuantity = existingForGroup.reduce((sum, row) => sum + row.quantity, 0);
					queries.push(db
						.update(playerDeckCards)
						.set({
							quantity: sql`case
								when exists(select 1 from ${playerDeckUnresolvedCards} where ${inArray(playerDeckUnresolvedCards.id, firstChunk)})
								then ${existingQuantity} + (select coalesce(sum(${playerDeckUnresolvedCards.quantity}), 0) from ${playerDeckUnresolvedCards} where ${inArray(playerDeckUnresolvedCards.id, firstChunk)})
								else ${playerDeckCards.quantity}
							end`,
							sortOrder: sql`case
								when exists(select 1 from ${playerDeckUnresolvedCards} where ${inArray(playerDeckUnresolvedCards.id, firstChunk)})
								then min(${canonical.sortOrder}, (select min(${playerDeckUnresolvedCards.sortOrder}) from ${playerDeckUnresolvedCards} where ${inArray(playerDeckUnresolvedCards.id, firstChunk)}))
								else ${playerDeckCards.sortOrder}
							end`,
						})
						.where(eq(playerDeckCards.id, canonical.id)));

					const duplicateIds = existingForGroup.slice(1).map(row => row.id);
					for (const duplicateIdChunk of chunkArray(duplicateIds, SAFE_INARRAY_SIZE)) {
						queries.push(db.delete(playerDeckCards).where(inArray(playerDeckCards.id, duplicateIdChunk)));
					}
				}
				else {
					queries.push(db
						.insert(playerDeckCards)
						.select(sql`
							select
								${group.deckId},
								${resolvedCardId},
								sum(${playerDeckUnresolvedCards.quantity}),
								${group.compartment},
								min(${playerDeckUnresolvedCards.sortOrder})
							from ${playerDeckUnresolvedCards}
							where ${inArray(playerDeckUnresolvedCards.id, firstChunk)}
							having count(*) > 0
						`));
				}

				for (const entryIdChunk of entryIdChunks.slice(1)) {
					queries.push(db
						.update(playerDeckCards)
						.set({
							quantity: sql`case
								when exists(select 1 from ${playerDeckUnresolvedCards} where ${inArray(playerDeckUnresolvedCards.id, entryIdChunk)})
								then ${playerDeckCards.quantity} + (select coalesce(sum(${playerDeckUnresolvedCards.quantity}), 0) from ${playerDeckUnresolvedCards} where ${inArray(playerDeckUnresolvedCards.id, entryIdChunk)})
								else ${playerDeckCards.quantity}
							end`,
							sortOrder: sql`case
								when exists(select 1 from ${playerDeckUnresolvedCards} where ${inArray(playerDeckUnresolvedCards.id, entryIdChunk)})
								then min(${playerDeckCards.sortOrder}, (select min(${playerDeckUnresolvedCards.sortOrder}) from ${playerDeckUnresolvedCards} where ${inArray(playerDeckUnresolvedCards.id, entryIdChunk)}))
								else ${playerDeckCards.sortOrder}
							end`,
						})
						.where(and(
							eq(playerDeckCards.deckId, group.deckId),
							eq(playerDeckCards.cardId, resolvedCardId),
							eq(playerDeckCards.compartment, group.compartment),
						)));
				}
			}
		}

		for (const entryIdChunk of chunkArray(matchingEntries.map(entry => entry.id), SAFE_INARRAY_SIZE)) {
			queries.push(db.delete(playerDeckUnresolvedCards).where(inArray(playerDeckUnresolvedCards.id, entryIdChunk)));
		}

		await db.batch(queries as [typeof queries[0], ...typeof queries]);

		return {
			success: true,
			message: `Resolved ${matchingEntries.length} entr${matchingEntries.length === 1 ? 'y' : 'ies'} for ${unresolvedCard.originalName} as ${scryfallData.name}`,
			resolvedCardName: scryfallData.name,
			unresolvedId: unresolvedCardId,
			resolvedCount: matchingEntries.length,
		};
	}

	return {
		resolveUnresolvedDeckCard,
	};
}
