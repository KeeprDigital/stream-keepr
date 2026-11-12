import type { SetArchetypeKeyCardsInput } from '~~/server/schemas/api/archetype';
import type { CreateArchetypeInput, UpdateArchetypeInput } from '~~/shared/api';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '~~/server/db';
import { cards, events, players } from '~~/server/db/schema';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { playerUpdateModule } from '~~/server/modules/player-update';
import { archetypeService } from '~~/server/services/archetype';
import { archetypeCardService } from '~~/server/services/archetypeCard';
import { playerDeckService } from '~~/server/services/playerDeck';
import { buildReleaseScreenEventReferencesQuery, buildRepointScreenEventReferencesQuery } from '~~/server/services/screen';
import { sameArchetypeName } from '~~/shared/utils/archetypeName';

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

interface MergeArchetypeParams {
	eventId: number;
	/** The Archetype merged away. */
	archetypeId: number;
	/** The Archetype its decks move to. */
	intoArchetypeId: number;
	originConnectionId?: string;
}

interface RemoveEmptyArchetypesParams {
	eventId: number;
	originConnectionId?: string;
}

interface UpdateCardsParams {
	eventId: number;
	archetypeId: number;
	input: SetArchetypeKeyCardsInput;
	originConnectionId?: string;
}

/** A One Piece Card Game Archetype is derived from a Leader by the OP Deck List write, never assigned (ADR-0074). */
async function refuseOnOpEvent(eventId: number, action: string) {
	const event = await db.query.events.findFirst({
		where: eq(events.id, eventId),
		columns: { game: true },
	});
	if (event?.game === 'op') {
		throw createError({
			statusCode: 400,
			statusMessage: `A One Piece Card Game Archetype follows its Leader, so it cannot be ${action} by hand`,
		});
	}
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

	/**
	 * An Event holds one Archetype per name, ignoring case and surrounding
	 * spaces. The refusal names the holder, which an operator can merge into.
	 */
	async function refuseTakenName(eventId: number, name: string, renamedArchetypeId?: number) {
		const holder = (await archetypes.findByEventId(eventId))
			.find(archetype => archetype.id !== renamedArchetypeId && sameArchetypeName(archetype.name, name));
		if (holder) {
			throw createError({
				statusCode: 409,
				statusMessage: 'Conflict',
				message: `This Event already has an Archetype named “${holder.name}”`,
			});
		}
	}

	async function createArchetype({ eventId, input, originConnectionId }: CreateArchetypeParams) {
		await refuseOnOpEvent(eventId, 'created');
		await refuseTakenName(eventId, input.name);
		const newArchetype = await archetypes.create(eventId, input);

		return await publication.archetypeCreated({
			eventId,
			entity: newArchetype,
			originConnectionId,
		});
	}

	async function updateArchetype({ eventId, archetypeId, input, originConnectionId }: UpdateArchetypeParams) {
		// A rename or a pin customises it, which a derived Archetype's cleanup spares (ADR-0074).
		const current = await archetypes.findById(archetypeId, eventId);
		if (input.name !== undefined)
			await refuseTakenName(eventId, input.name, archetypeId);
		const customises = (input.name !== undefined && input.name !== current?.name) || input.chartSeries != null;
		const archetype = await archetypes.update(archetypeId, eventId, customises
			? { ...input, customised: true }
			: input);

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
		await refuseOnOpEvent(eventId, 'deleted');
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
		// a since-removed archetype (or vice versa on a partial failure). So must
		// releasing the Screens that name it (ADR-0060).
		const [, deletedArchetypes, clearedScreens] = await db.batch([
			deckService.buildClearReviewsByArchetypeQuery(eventId, archetypeId),
			archetypes.buildRemoveQuery(archetypeId, eventId),
			buildReleaseScreenEventReferencesQuery(eventId, ['archetype']),
		]);

		// No origin, because the deleting client never received these Screens back.
		for (const screen of clearedScreens)
			await publication.screenUpdated({ eventId, entity: screen });

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

	/**
	 * Merges one Archetype into another: its decks move to the survivor, still
	 * reviewed, the Screens naming it name the survivor, and it is deleted. The
	 * survivor keeps its own colours, key cards and Pinned Chart Series.
	 */
	async function mergeArchetype({ eventId, archetypeId, intoArchetypeId, originConnectionId }: MergeArchetypeParams) {
		await refuseOnOpEvent(eventId, 'merged');
		if (archetypeId === intoArchetypeId) {
			throw createError({
				statusCode: 400,
				statusMessage: 'An Archetype cannot be merged into itself',
			});
		}
		const [merged, survivor] = await Promise.all([
			archetypes.findById(archetypeId, eventId),
			archetypes.findById(intoArchetypeId, eventId),
		]);
		if (!merged || !survivor) {
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

		// One commit: decks left on a deleted Archetype would lose their review, and
		// a Screen left naming it would be released by the next delete (ADR-0060).
		const [, , repointedScreens] = await db.batch([
			deckService.buildMoveReviewsQuery(eventId, archetypeId, intoArchetypeId),
			// A Player's Archetype is their primary deck's, re-projected below. The Player
			// write can also give one with no Deck List, and that Player moves here.
			db.update(players)
				.set({ archetypeId: intoArchetypeId })
				.where(and(eq(players.eventId, eventId), eq(players.archetypeId, archetypeId))),
			buildRepointScreenEventReferencesQuery(eventId, 'archetype', archetypeId, intoArchetypeId),
			archetypes.buildRemoveQuery(archetypeId, eventId),
		]);

		// No origin, because the merging client never received these Screens back.
		for (const screen of repointedScreens)
			await publication.screenUpdated({ eventId, entity: screen });

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
			mergedIntoArchetypeId: intoArchetypeId,
			originConnectionId,
		});

		return { archetypeId: intoArchetypeId, mergedArchetypeId: archetypeId };
	}

	/**
	 * Removes the Event's Empty Archetypes. Emptiness is judged by the delete
	 * itself, so an Archetype a deck is assigned to meanwhile stays.
	 */
	async function removeEmptyArchetypes({ eventId, originConnectionId }: RemoveEmptyArchetypesParams) {
		await refuseOnOpEvent(eventId, 'removed');

		const [removed, clearedScreens] = await db.batch([
			archetypes.buildRemoveEmptyQuery(eventId),
			buildReleaseScreenEventReferencesQuery(eventId, ['archetype']),
		]);

		// No origin, because the removing client never received these Screens back.
		for (const screen of clearedScreens)
			await publication.screenUpdated({ eventId, entity: screen });

		for (const archetype of removed) {
			await publication.archetypeDeleted({
				eventId,
				id: archetype.id,
				originConnectionId,
			});
		}

		return {
			archetypeIds: removed.map(archetype => archetype.id),
		};
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
		mergeArchetype,
		removeEmptyArchetypes,
		updateCards,
	};
}
