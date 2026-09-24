import type { SetArchetypeKeyCardsInput } from '~~/server/schemas/api/archetype';
import type { CreateArchetypeInput, UpdateArchetypeInput } from '~~/shared/api';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { cards, events } from '~~/server/db/schema';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { playerUpdateModule } from '~~/server/modules/player-update';
import { archetypeService } from '~~/server/services/archetype';
import { archetypeCardService } from '~~/server/services/archetypeCard';
import { playerDeckService } from '~~/server/services/playerDeck';

interface CreateArchetypeParams {
	eventId: number;
	input: CreateArchetypeInput;
	originConnectionId?: string;
}

interface UpdateArchetypeParams {
	eventId: number;
	archetypeId: number;
	input: UpdateArchetypeInput;
	originConnectionId?: string;
}

interface DeleteArchetypeParams {
	eventId: number;
	archetypeId: number;
	originConnectionId?: string;
}

interface UpdateCardsParams {
	eventId: number;
	archetypeId: number;
	input: SetArchetypeKeyCardsInput;
	originConnectionId?: string;
}

function ensureUnique<T>(values: T[], label: string) {
	if (new Set(values).size !== values.length) {
		throw createError({
			statusCode: 400,
			statusMessage: `Duplicate ${label} are not allowed`,
		});
	}
}

export function archetypeWriteModule() {
	const publication = eventDataPublicationModule();
	const archetypes = archetypeService();
	const archetypeCards = archetypeCardService();

	async function createArchetype({ eventId, input, originConnectionId }: CreateArchetypeParams) {
		const newArchetype = await archetypes.create(eventId, input);

		return await publication.archetypeCreated({
			eventId,
			entity: newArchetype,
			originConnectionId,
		});
	}

	async function updateArchetype({ eventId, archetypeId, input, originConnectionId }: UpdateArchetypeParams) {
		const archetype = await archetypes.update(archetypeId, eventId, input);

		if (!archetype) {
			throw createError({
				statusCode: 404,
				message: 'Archetype not found',
			});
		}

		const deckService = playerDeckService();
		const [affectedPlayerIds, affectedPrimaryPlayerIds] = await Promise.all([
			deckService.listPlayerIdsByArchetype(eventId, archetypeId),
			deckService.listPrimaryPlayerIdsByArchetype(eventId, archetypeId),
		]);
		await playerUpdateModule().reconcileDeckProjections({
			eventId,
			playerIds: affectedPrimaryPlayerIds,
			originConnectionId,
		});
		const secondaryPlayerIds = affectedPlayerIds.filter(playerId => !affectedPrimaryPlayerIds.includes(playerId));
		await playerUpdateModule().publishPlayerSnapshotUpdates({
			eventId,
			playerIds: secondaryPlayerIds,
			originConnectionId,
		});

		// Fetch current key cards to include in response
		const keyCards = await archetypeCards.getKeyCards(archetypeId);
		return await publication.archetypeUpdated({
			eventId,
			entity: archetype,
			keyCards,
			originConnectionId,
		});
	}

	async function deleteArchetype({ eventId, archetypeId, originConnectionId }: DeleteArchetypeParams) {
		if (!await archetypes.findById(archetypeId, eventId)) {
			throw createError({
				statusCode: 404,
				message: 'Archetype not found',
			});
		}

		const deckService = playerDeckService();
		const [playerIds, primaryPlayerIds] = await Promise.all([
			deckService.listPlayerIdsByArchetype(eventId, archetypeId),
			deckService.listPrimaryPlayerIdsByArchetype(eventId, archetypeId),
		]);

		// Clearing deck reviews and deleting the archetype must commit together —
		// otherwise a delete without the review clear would leave decks pointing at
		// a since-removed archetype (or vice versa on a partial failure).
		const [, deletedArchetypes] = await db.batch([
			deckService.buildClearReviewsByArchetypeQuery(eventId, archetypeId),
			archetypes.buildRemoveQuery(archetypeId, eventId),
		]);

		if (deletedArchetypes.length === 0) {
			throw createError({
				statusCode: 404,
				message: 'Archetype not found',
			});
		}

		await playerUpdateModule().reconcileDeckProjections({
			eventId,
			playerIds: primaryPlayerIds,
			originConnectionId,
		});
		const secondaryPlayerIds = playerIds.filter(playerId => !primaryPlayerIds.includes(playerId));
		await playerUpdateModule().publishPlayerSnapshotUpdates({
			eventId,
			playerIds: secondaryPlayerIds,
			originConnectionId,
		});

		await publication.archetypeDeleted({
			eventId,
			id: archetypeId,
			originConnectionId,
		});

		return { success: true };
	}

	async function updateCards({ eventId, archetypeId, input, originConnectionId }: UpdateCardsParams) {
		// Verify archetype belongs to this event
		const archetype = await archetypes.findById(archetypeId, eventId);
		if (!archetype) {
			throw createError({ statusCode: 404, statusMessage: 'Archetype not found' });
		}

		const eventRecord = await db.query.events.findFirst({
			where: eq(events.id, eventId),
			columns: { game: true },
		});
		if (!eventRecord) {
			throw createError({ statusCode: 404, statusMessage: 'Event not found' });
		}
		if (eventRecord.game !== 'mtg') {
			throw createError({
				statusCode: 400,
				statusMessage: 'Key cards are only supported for MTG events',
			});
		}

		// Resolve card IDs — from explicit IDs or by name lookup
		let cardIds: number[];
		if (input.cardIds !== undefined) {
			ensureUnique(input.cardIds, 'card IDs');

			if (input.cardIds.length === 0) {
				cardIds = [];
			}
			else {
				const found = await db
					.select({ id: cards.id })
					.from(cards)
					.where(and(
						eq(cards.game, 'mtg'),
						inArray(cards.id, input.cardIds),
					));

				if (found.length !== input.cardIds.length) {
					throw createError({
						statusCode: 400,
						statusMessage: 'One or more cardIds do not reference MTG cards',
					});
				}

				// The length check above already guaranteed every requested ID is valid.
				cardIds = input.cardIds;
			}
		}
		else if (input.cardNames !== undefined && input.cardNames.length > 0) {
			const requestedCardNames = input.cardNames;
			const normalizedNames = requestedCardNames.map(name => name.toLowerCase());
			ensureUnique(normalizedNames, 'card names');

			const found = await db
				.select({
					id: cards.id,
					name: cards.name,
					normalizedName: sql<string>`lower(${cards.name})`,
				})
				.from(cards)
				.where(and(
					eq(cards.game, 'mtg'),
					or(...normalizedNames.map(name => sql`lower(${cards.name}) = ${name}`)),
				));

			const cardsByName = new Map<string, Array<{ id: number; name: string }>>();
			for (const card of found) {
				const matches = cardsByName.get(card.normalizedName) ?? [];
				matches.push({ id: card.id, name: card.name });
				cardsByName.set(card.normalizedName, matches);
			}

			cardIds = normalizedNames.map((normalizedName) => {
				const requestedName = requestedCardNames[normalizedNames.indexOf(normalizedName)] ?? normalizedName;
				const matches = cardsByName.get(normalizedName) ?? [];

				if (matches.length === 0) {
					throw createError({
						statusCode: 400,
						statusMessage: `Unknown MTG card: ${requestedName}`,
					});
				}

				if (matches.length > 1) {
					throw createError({
						statusCode: 400,
						statusMessage: `Ambiguous MTG card name: ${matches[0]!.name}`,
					});
				}

				return matches[0]!.id;
			});
		}
		else {
			cardIds = [];
		}

		const keyCards = await archetypeCards.setKeyCards(archetypeId, cardIds);

		await publication.archetypeKeyCardsUpdated({
			eventId,
			archetypeId,
			keyCards,
			originConnectionId,
		});

		return { keyCards };
	}

	return {
		createArchetype,
		updateArchetype,
		deleteArchetype,
		updateCards,
	};
}
