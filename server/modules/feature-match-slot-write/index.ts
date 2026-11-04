import type { DbFeatureMatch } from '~~/server/db/schema';
import type { CreateFeatureMatchInput, FeatureMatchResponse, ManualPlayerSlotData, UpdateFeatureMatchInput, UpdatePlayerInput } from '~~/shared/api';
import type { FeatureMatchDeckListReference } from '~~/shared/types/featureMatchDeckList';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { opCardCatalogueModule } from '~~/server/modules/op-card-catalogue';
import { playerUpdateModule } from '~~/server/modules/player-update';
import { featureMatchService } from '~~/server/services/featureMatch';
import { deckListReferenceOf, featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { slotLeaderNumbers } from '~~/server/services/featureMatchSlotLeader';
import { playerService } from '~~/server/services/player';
import { bandaiKeeprConfig } from '~~/server/utils/bandaiKeepr';
import { validateFeatureMatchReferences } from '~~/server/utils/routeGuards';

const SIDE_DATA_KEYS = ['player1Data', 'player2Data'] as const;
type SideDataKey = typeof SIDE_DATA_KEYS[number];

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
		await catalogueLeaders(input);

		const slot = await slots.create(eventId, input);

		return await publication.featureMatchSlotCreated({
			eventId,
			entity: slot,
			originConnectionId,
		});
	}

	async function remove({ eventId, slotId, originConnectionId }: RemoveSlotParams): Promise<{ success: true }> {
		const { deleted, clearedScreens } = await slots.remove(slotId, eventId);
		// Each released Deck Source first, and with no origin: the deleting client
		// holds those Screens at their old version too (ADR-0032).
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

	async function updateSetup({ eventId, slotId, input, originConnectionId }: UpdateSlotSetupParams): Promise<FeatureMatchResponse> {
		await validateFeatureMatchReferences(eventId, input);
		await catalogueLeaders(input);
		// Only a save that edits a side writes a Player or moves a Deck List.
		const current = SIDE_DATA_KEYS.some(key => Object.hasOwn(input, key))
			? await slots.findById(slotId, eventId)
			: undefined;
		let settledInput = input;
		if (current) {
			await writeSeatedPlayerEdits(eventId, current, input);
			settledInput = await settleDeckListReferences(current, input);
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
		reorder,
	};
}
