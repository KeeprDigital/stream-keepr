import type { DbFeatureMatch } from '~~/server/db/schema';
import type { CreateFeatureMatchInput, FeatureMatchResponse, ManualPlayerSlotData, PlayerSlotData, UpdateFeatureMatchInput, UpdatePlayerInput } from '~~/shared/api';
import type { EventKind } from '~~/shared/config/games';
import type { Seat } from '~~/shared/types/enums';
import type { FeatureMatchDeckListReference } from '~~/shared/types/featureMatchDeckList';
import { eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { events } from '~~/server/db/schema';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { opCardCatalogueModule } from '~~/server/modules/op-card-catalogue';
import { playerUpdateModule } from '~~/server/modules/player-update';
import { featureMatchService } from '~~/server/services/featureMatch';
import { deckListReferenceOf, featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { withCommanderSeats, writesCommanderSeats } from '~~/server/services/featureMatchSlotCommander';
import { linkedOpSideGameData, slotLeaderNumbers } from '~~/server/services/featureMatchSlotLeader';
import { playerService } from '~~/server/services/player';
import { bandaiKeeprConfig } from '~~/server/utils/bandaiKeepr';
import { validateFeatureMatchReferences } from '~~/server/utils/routeGuards';
import { eventKind } from '~~/shared/config/games';
import { SLOT_SEAT_DATA_KEY } from '~~/shared/utils/featureMatchSidePlayer';

/** The two Seats every Slot has, either of which may link a Player. */
const SIDE_DATA_KEYS = ['player1Data', 'player2Data'] as const;
type SideDataKey = typeof SIDE_DATA_KEYS[number];
const SIDE_PLAYER_KEY = { player1Data: 'player1Id', player2Data: 'player2Id' } as const satisfies Record<SideDataKey, string>;
/** What a setup save names when it edits or seats a Seat. */
const SEATING_KEYS = [
	...Object.values(SLOT_SEAT_DATA_KEY),
	...Object.values(SIDE_PLAYER_KEY),
];

/**
 * A write to a Commander Event's Slot (ADR-0087): the Event is its Slots alone,
 * so the Slot links no Player and no Match, and each Seat it names is typed.
 */
function commanderSlotWrite(input: UpdateFeatureMatchInput): UpdateFeatureMatchInput {
	if (input.player1Id != null || input.player2Id != null || input.matchId != null)
		throw createError({ statusCode: 400, message: 'A Commander Event\'s Slot links no Player and no Match' });
	return withCommanderSeats(input);
}

/** Whether a write names a Seat, a Player or a Match: what the kind of Event decides. */
function namesSeatOrMatch(input: UpdateFeatureMatchInput): boolean {
	return input.matchId !== undefined || SEATING_KEYS.some(key => Object.hasOwn(input, key));
}

/** The kind of Event the Slot's Event is; none for an Event that is not there. */
async function eventKindOf(eventId: number): Promise<EventKind | undefined> {
	const event = await db.query.events.findFirst({
		where: eq(events.id, eventId),
		columns: { game: true, variant: true },
	});
	return event && eventKind(event);
}

interface CreateSlotParams {
	eventId: number;
	input: CreateFeatureMatchInput;
	originConnectionId?: string;
}

interface RemoveSlotParams {
	eventId: number;
	slotId: number;
	originConnectionId?: string;
}

interface UpdateSlotSetupParams {
	eventId: number;
	slotId: number;
	input: UpdateFeatureMatchInput;
	originConnectionId?: string;
}

interface SwapSeatsParams {
	eventId: number;
	slotId: number;
	seats: [Seat, Seat];
	originConnectionId?: string;
}

interface ReorderSlotsParams {
	eventId: number;
	slotId: number;
	direction: 'up' | 'down';
	originConnectionId?: string;
}

/**
 * Feature Match Slot write seam.
 *
 * Owns operator writes to a Feature Match Slot itself — create, delete, setup
 * edit, and display reorder — including reference validation, the Slot's own
 * Session lifecycle (via the Feature Match service) and realtime Event Data
 * publication. Promotion and Session command handling stay in their own modules.
 */
export function featureMatchSlotWriteModule() {
	const publication = eventDataPublicationModule();
	const slots = featureMatchService();
	const players = playerService();
	const playerUpdate = playerUpdateModule();
	const deckLists = featureMatchDeckListService();

	/**
	 * A picked Leader is saved to the card catalogue before a side references it
	 * by number (ADR-0074): only its number is taken from the save, the card is
	 * bandai-keepr's, and a number that names no Leader card is refused.
	 */
	async function catalogueLeaders(input: UpdateFeatureMatchInput) {
		const numbers = slotLeaderNumbers(input);
		if (numbers.length === 0)
			return;
		const cards = await opCardCatalogueModule().resolve(bandaiKeeprConfig, numbers);
		for (const number of numbers) {
			if (cards.get(number)?.category !== 'leader')
				throw createError({ statusCode: 400, message: `${number} is not a Leader card` });
		}
	}

	async function create({ eventId, input, originConnectionId }: CreateSlotParams): Promise<FeatureMatchResponse> {
		await validateFeatureMatchReferences(eventId, input);
		const isCommanderEvent = namesSeatOrMatch(input) && await eventKindOf(eventId) === 'mtg-commander';
		if (!isCommanderEvent)
			await catalogueLeaders(input);

		const slot = await slots.create(eventId, isCommanderEvent
			? commanderSlotWrite(input)
			: input);

		return await publication.featureMatchSlotCreated({
			eventId,
			entity: slot,
			originConnectionId,
		});
	}

	async function remove({ eventId, slotId, originConnectionId }: RemoveSlotParams): Promise<{ success: true }> {
		const { deleted, clearedScreens } = await slots.remove(slotId, eventId);
		// Each released Screen first, and with no origin: the deleting client
		// holds those Screens at their old version too (ADR-0032, ADR-0060).
		for (const screen of clearedScreens)
			await publication.screenUpdated({ eventId, entity: screen });
		if (!deleted) {
			throw createError({ statusCode: 404, message: 'Feature match slot not found' });
		}

		await publication.featureMatchSlotDeleted({
			eventId,
			id: slotId,
			originConnectionId,
		});

		return { success: true };
	}

	/**
	 * Writes a setup edit's name, pronouns and LGS to the Player seated on that
	 * side (ADR-0045); records, deck and archetype stay Slot snapshot fields.
	 * The Player write reverse-syncs every Slot seating them, so it runs before
	 * the Slot write, which then lands the rest of this save on the edited Slot.
	 * It is published with no origin: the saving client applied only the Slot.
	 */
	async function writeSeatedPlayerEdits(eventId: number, current: DbFeatureMatch, input: UpdateFeatureMatchInput) {
		if (!input.player1Data && !input.player2Data)
			return;

		for (const side of [1, 2] as const) {
			const data = side === 1
				? input.player1Data
				: input.player2Data;
			const requestedPlayerId = side === 1
				? input.player1Id
				: input.player2Id;
			const playerId = requestedPlayerId !== undefined
				? requestedPlayerId
				: side === 1
					? current.player1Id
					: current.player2Id;
			if (!data || playerId == null)
				continue;
			const player = await players.findById(playerId, eventId);
			if (!player)
				continue;

			// An omitted field was not edited. A cleared name falls back to the
			// Player's Nickname (ADR-0074); with none to fall back to, it stays on
			// the Slot only, because a Player always shows by something.
			const changes: UpdatePlayerInput = {};
			const name = data.name?.trim();
			if (name !== undefined && name !== player.name && (name || player.nickname))
				changes.name = name;
			if (Object.hasOwn(data, 'pronouns') && (data.pronouns ?? null) !== player.pronouns)
				changes.pronouns = data.pronouns ?? null;
			if (Object.hasOwn(data, 'lgs') && (data.lgs ?? null) !== player.lgs)
				changes.lgs = data.lgs ?? null;
			if (Object.keys(changes).length > 0)
				await playerUpdate.updatePlayer({ eventId, playerId, input: changes });
		}
	}

	/**
	 * A side's Feature Match Deck List reference is the server's (ADR-0057). A
	 * save keeps it (key omitted), drops it (`null`) or moves one of this Slot's
	 * Deck Lists between sides; one naming any other Deck List, as a stale form
	 * might, keeps what the side holds. Its Mainboard count is the Deck List's
	 * own, and a Deck List both sides name stays with the side that held it.
	 */
	async function settleDeckListReferences(current: DbFeatureMatch, input: UpdateFeatureMatchInput): Promise<UpdateFeatureMatchInput> {
		const named = SIDE_DATA_KEYS
			.map(key => deckListReferenceOf(input[key])?.id)
			.filter((id): id is number => id !== undefined);
		const stored = await deckLists.referencesFor(current.id, named);

		const held = (key: SideDataKey) => deckListReferenceOf(current[key]);
		const settled: Record<SideDataKey, FeatureMatchDeckListReference | null> = { player1Data: null, player2Data: null };
		for (const key of SIDE_DATA_KEYS) {
			const data = input[key];
			if (!Object.hasOwn(input, key)) {
				settled[key] = held(key);
				continue;
			}
			if (data?.gameData?.type !== 'op')
				continue;
			const requested = data.gameData.featureMatchDeckList;
			settled[key] = requested === undefined
				? held(key)
				: requested && (stored.get(requested.id) ?? held(key));
		}
		const [first, second] = [settled.player1Data, settled.player2Data];
		if (first && first.id === second?.id) {
			const loser: SideDataKey = held('player2Data')?.id === first.id && held('player1Data')?.id !== first.id
				? 'player1Data'
				: 'player2Data';
			settled[loser] = null;
		}

		const output = { ...input };
		for (const key of SIDE_DATA_KEYS) {
			const data = input[key];
			// A side that never held a Deck List and names none is left as written.
			if (data?.gameData?.type === 'op' && (settled[key] || data.gameData.featureMatchDeckList !== undefined)) {
				output[key] = {
					...data,
					gameData: { ...data.gameData, featureMatchDeckList: settled[key] },
				} satisfies ManualPlayerSlotData;
			}
		}
		return output;
	}

	/** Deletes the Deck Lists this write took off the Slot's sides: a cleared side's, or a replaced one. */
	async function releaseDeckLists(before: DbFeatureMatch, after: DbFeatureMatch) {
		const kept = new Set([after.player1Data, after.player2Data].map(data => deckListReferenceOf(data)?.id));
		const released = [before.player1Data, before.player2Data]
			.map(data => deckListReferenceOf(data)?.id)
			.filter((id): id is number => id !== undefined && !kept.has(id));
		await deckLists.remove(before.id, released);
	}

	/**
	 * A One Piece side linked to a Player shows the Player's Leader and Deck
	 * List and holds none of its own (ADR-0074), so its game data is the
	 * server's, read from the Player whatever the save sent. An unlinked side
	 * keeps the Leader it shows, and no Player Deck List reference.
	 */
	async function settleOpSides(eventId: number, current: DbFeatureMatch | undefined, input: UpdateFeatureMatchInput): Promise<UpdateFeatureMatchInput> {
		const output = { ...input };
		for (const key of SIDE_DATA_KEYS) {
			const requested = input[SIDE_PLAYER_KEY[key]];
			const edited = Object.hasOwn(input, key);
			// A side the save neither edits nor seats is left as stored.
			if (!edited && requested === undefined)
				continue;
			const playerId = requested !== undefined
				? requested
				: current?.[SIDE_PLAYER_KEY[key]] ?? null;
			const data = edited
				? input[key]
				: current?.[key];
			if (playerId == null) {
				if (data?.gameData?.type === 'op' && Object.hasOwn(data.gameData, 'deckList')) {
					const { deckList: _deckList, ...gameData } = data.gameData;
					output[key] = { ...data, gameData };
				}
				continue;
			}
			const player = await players.findById(playerId, eventId);
			if (!player)
				continue;
			// Provenance is never written by an operator save; the Player's arrives through Reverse Sync.
			const { externalId: _externalId, externalSource: _externalSource, ...manual }: PlayerSlotData = data ?? {};
			output[key] = {
				...manual,
				gameData: linkedOpSideGameData(player.gameData),
			} satisfies ManualPlayerSlotData;
		}
		return output;
	}

	/** Leaves out each side whose Leader a Player's Deck List sets: only a picked Leader is catalogued here. */
	function pickedLeaderSides(input: UpdateFeatureMatchInput, current: DbFeatureMatch | undefined): UpdateFeatureMatchInput {
		const picked = { ...input };
		for (const key of SIDE_DATA_KEYS) {
			const requested = input[SIDE_PLAYER_KEY[key]];
			const playerId = requested !== undefined
				? requested
				: current?.[SIDE_PLAYER_KEY[key]] ?? null;
			if (playerId != null)
				delete picked[key];
		}
		return picked;
	}

	async function updateSetup({ eventId, slotId, input, originConnectionId }: UpdateSlotSetupParams): Promise<FeatureMatchResponse> {
		await validateFeatureMatchReferences(eventId, input);
		// Only a save that edits or seats a Seat writes a Player or moves a Deck List.
		const editsSeats = SEATING_KEYS.some(key => Object.hasOwn(input, key));
		const kind = namesSeatOrMatch(input)
			? await eventKindOf(eventId)
			: undefined;
		if (kind !== 'mtg-commander' && writesCommanderSeats(input))
			throw createError({ statusCode: 400, message: 'Only a Commander Event\'s Slot has Seats 3 and 4, or Seats holding Commanders' });
		const current = editsSeats
			? await slots.findById(slotId, eventId)
			: undefined;

		let settledInput = input;
		if (kind === 'mtg-commander') {
			settledInput = commanderSlotWrite(input);
		}
		else {
			await catalogueLeaders(pickedLeaderSides(input, current));
			if (current) {
				await writeSeatedPlayerEdits(eventId, current, input);
				const referenced = await settleDeckListReferences(current, input);
				settledInput = kind === 'op'
					? await settleOpSides(eventId, current, referenced)
					: referenced;
			}
		}

		const updatedSlot = await slots.update(slotId, eventId, settledInput);
		if (!updatedSlot) {
			throw createError({ statusCode: 404, message: 'Feature match slot not found' });
		}
		if (current)
			await releaseDeckLists(current, updatedSlot);

		return await publication.featureMatchSlotUpdated({
			eventId,
			entity: updatedSlot,
			originConnectionId,
		});
	}

	/**
	 * Swap Seats (ADR-0087): two Seats' players change places in the Slot itself,
	 * each with everything its Seat holds. A Commander Slot's alone: on any other
	 * Event the Session owns which Seat each player sits in (ADR-0058).
	 */
	async function swapSeats({ eventId, slotId, seats: [first, second], originConnectionId }: SwapSeatsParams): Promise<FeatureMatchResponse> {
		if (first === second)
			throw createError({ statusCode: 400, message: 'Swap Seats takes two different Seats' });
		if (await eventKindOf(eventId) !== 'mtg-commander')
			throw createError({ statusCode: 400, message: 'Only a Commander Event\'s Slot swaps its Seats' });

		const swappedSlot = await slots.swapSeats(slotId, eventId, first, second);
		if (!swappedSlot)
			throw createError({ statusCode: 404, message: 'Feature match slot not found' });

		return await publication.featureMatchSlotUpdated({
			eventId,
			entity: swappedSlot,
			originConnectionId,
		});
	}

	async function reorder({ eventId, slotId, direction, originConnectionId }: ReorderSlotsParams) {
		const result = await slots.swapMatchOrder(eventId, slotId, direction);

		await publication.featureMatchSlotsReordered({
			eventId,
			slots: result,
			originConnectionId,
		});

		return { slots: result };
	}

	return {
		create,
		remove,
		updateSetup,
		swapSeats,
		reorder,
	};
}
