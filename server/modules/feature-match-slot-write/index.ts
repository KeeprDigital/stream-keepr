import type { DbFeatureMatch } from '~~/server/db/schema';
import type { CreateFeatureMatchInput, FeatureMatchResponse, ManualPlayerSlotData, UpdateFeatureMatchInput, UpdatePlayerInput } from '~~/shared/api';
import type { FeatureMatchDeckListReference } from '~~/shared/types/featureMatchDeckList';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { playerUpdateModule } from '~~/server/modules/player-update';
import { featureMatchService } from '~~/server/services/featureMatch';
import { deckListReferenceOf, featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { playerService } from '~~/server/services/player';
import { validateFeatureMatchReferences } from '~~/server/utils/routeGuards';

const SIDE_DATA_KEYS = ['player1Data', 'player2Data'] as const;

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

	async function create({ eventId, input, originConnectionId }: CreateSlotParams): Promise<FeatureMatchResponse> {
		await validateFeatureMatchReferences(eventId, input);

		const slot = await slots.create(eventId, input);

		return await publication.featureMatchSlotCreated({
			eventId,
			entity: slot,
			originConnectionId,
		});
	}

	async function remove({ eventId, slotId, originConnectionId }: RemoveSlotParams): Promise<{ success: true }> {
		const deleted = await slots.remove(slotId, eventId);
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

			// An omitted field was not edited. A Player always has a name, so a
			// cleared one stays on the Slot only.
			const changes: UpdatePlayerInput = {};
			if (data.name && data.name !== player.name)
				changes.name = data.name;
			if (Object.hasOwn(data, 'pronouns') && (data.pronouns ?? null) !== player.pronouns)
				changes.pronouns = data.pronouns ?? null;
			if (Object.hasOwn(data, 'lgs') && (data.lgs ?? null) !== player.lgs)
				changes.lgs = data.lgs ?? null;
			if (Object.keys(changes).length > 0)
				await playerUpdate.updatePlayer({ eventId, playerId, input: changes });
		}
	}

	/**
	 * A side's Feature Match Deck List reference is the server's: a save may move
	 * one of this Slot's Deck Lists between sides or drop it, never name another
	 * Slot's or a missing one, and its Mainboard count is the Deck List's own. A
	 * Deck List both sides name stays with the side that already held it.
	 */
	async function settleDeckListReferences(current: DbFeatureMatch, input: UpdateFeatureMatchInput): Promise<UpdateFeatureMatchInput> {
		const named = [input.player1Data, input.player2Data]
			.map(deckListReferenceOf)
			.filter(reference => reference !== null);
		if (named.length === 0)
			return input;
		const held = await deckLists.referencesFor(current.id, named.map(reference => reference.id));

		const settled = { ...input };
		const claimed = new Set<number>();
		for (const key of SIDE_DATA_KEYS) {
			const untouched = Object.hasOwn(input, key)
				? undefined
				: deckListReferenceOf(current[key])?.id;
			if (untouched !== undefined)
				claimed.add(untouched);
		}
		for (const key of SIDE_DATA_KEYS) {
			const data = input[key];
			const reference = deckListReferenceOf(data);
			if (!data || !reference)
				continue;
			const stored: FeatureMatchDeckListReference | null = !claimed.has(reference.id)
				? held.get(reference.id) ?? null
				: null;
			if (stored)
				claimed.add(stored.id);
			settled[key] = {
				...data,
				gameData: { ...data.gameData!, type: 'op', featureMatchDeckList: stored },
			} satisfies ManualPlayerSlotData;
		}
		return settled;
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
		const current = await slots.findById(slotId, eventId);
		if (!current) {
			throw createError({ statusCode: 404, message: 'Feature match slot not found' });
		}
		await writeSeatedPlayerEdits(eventId, current, input);
		const settledInput = await settleDeckListReferences(current, input);

		const updatedSlot = await slots.update(slotId, eventId, settledInput);
		if (!updatedSlot) {
			throw createError({ statusCode: 404, message: 'Feature match slot not found' });
		}
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
