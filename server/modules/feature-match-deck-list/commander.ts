import type { BroadcastDeckListCanonicalEntry, CommanderDeckListDocument } from '~~/server/modules/broadcast-deck-list-import';
import type { FeatureMatchResponse, ManualPlayerSlotData } from '~~/shared/api';
import type { Seat } from '~~/shared/types/enums';
import type {
	CommanderDeckListEntry,
	CommanderDeckListPreviewAnswer,
	CommanderDeckListRefusal,
	SaveCommanderDeckListAnswer,
	SavedCommanderDeckList,
} from '~~/shared/types/featureMatchDeckList';
import { eq } from 'drizzle-orm';
import { db } from '~~/server/db';
import { events } from '~~/server/db/schema';
import {
	BroadcastDeckListCardProviderError,
	createBroadcastDeckListScryfallResolver,
	importCommanderDeckList,
} from '~~/server/modules/broadcast-deck-list-import';
import { featureMatchSlotWriteModule } from '~~/server/modules/feature-match-slot-write';
import { featureMatchService } from '~~/server/services/featureMatch';
import { featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { runCompensation } from '~~/server/utils/errors';
import { eventKind } from '~~/shared/config/games';
import { COMMANDER_DECK_LIST_INVALID } from '~~/shared/types/featureMatchDeckList';
import { orderedColourIdentity } from '~~/shared/utils/commander';
import { commanderMainboardCount, commanderOfDeckListEntry } from '~~/shared/utils/commanderDeckList';
import { SLOT_SEAT_DATA_KEY } from '~~/shared/utils/featureMatchSidePlayer';

/**
 * A Commander Seat's Feature Match Deck List (ADR-0087): previewing a paste,
 * saving it to a Seat with the Commanders its operator confirmed, and reading
 * a saved one. The paste goes through the Magic deck text parser, which reads
 * any of Moxfield's four copies, and each card is held as the exact printing
 * its line names. The save is the Slot setup write's, which corrects the
 * Seat's Session and announces the Slot.
 */

interface PreviewParams {
	eventId: number;
	text: string;
}

interface SaveParams {
	eventId: number;
	slotId: number;
	seat: Seat;
	text: string;
	/** The Commanders confirmed, each a printing of the list, by Scryfall id. */
	commanders: readonly string[];
	originConnectionId?: string;
}

interface ReadParams {
	eventId: number;
	slotId: number;
	deckListId: number;
}

function refused(errors: CommanderDeckListRefusal[]) {
	return createError({
		statusCode: 422,
		message: errors[0]?.message ?? 'Deck List is invalid',
		data: { code: COMMANDER_DECK_LIST_INVALID, errors },
	});
}

async function requireCommanderEvent(eventId: number): Promise<void> {
	const event = await db.query.events.findFirst({
		where: eq(events.id, eventId),
		columns: { game: true, variant: true },
	});
	if (!event)
		throw createError({ statusCode: 404, message: 'Event not found' });
	if (eventKind(event) !== 'mtg-commander')
		throw createError({ statusCode: 400, message: 'Only a Commander Event\'s Seat takes a pasted Magic: The Gathering Deck List' });
}

function toEntry(entry: BroadcastDeckListCanonicalEntry): CommanderDeckListEntry {
	return {
		quantity: entry.quantity,
		scryfallId: entry.scryfallId,
		name: entry.canonicalName,
		setCode: entry.setCode,
		collectorNumber: entry.collectorNumber,
		cardType: entry.cardType,
		colorIdentity: orderedColourIdentity(entry.colors ?? ''),
		manaCost: entry.manaCost,
		manaValue: entry.manaValue,
	};
}

/** A paste's cards, or why it is refused. A Scryfall outage is neither: it is thrown, to retry. */
async function importPaste(text: string): Promise<{ document: CommanderDeckListDocument } | { errors: CommanderDeckListRefusal[] }> {
	try {
		const result = await importCommanderDeckList(text, createBroadcastDeckListScryfallResolver());
		return result.ok
			? { document: result.document }
			: { errors: result.errors };
	}
	catch (error) {
		if (error instanceof BroadcastDeckListCardProviderError)
			throw createError({ cause: error });
		throw error;
	}
}

export function commanderDeckListModule() {
	const deckLists = featureMatchDeckListService();
	const slots = featureMatchService();

	async function preview({ eventId, text }: PreviewParams): Promise<CommanderDeckListPreviewAnswer> {
		await requireCommanderEvent(eventId);
		const imported = await importPaste(text);
		if ('errors' in imported)
			return { ok: false, errors: imported.errors };
		const { entries, offeredCommanders, sideboardDropped } = imported.document;
		return {
			ok: true,
			deckList: { entries: entries.map(toEntry), offeredCommanders, sideboardDropped },
		};
	}

	async function save({ eventId, slotId, seat, text, commanders, originConnectionId }: SaveParams): Promise<SaveCommanderDeckListAnswer<FeatureMatchResponse>> {
		await requireCommanderEvent(eventId);
		if (!await slots.exists(slotId, eventId))
			throw createError({ statusCode: 404, message: 'Feature match slot not found' });
		const imported = await importPaste(text);
		if ('errors' in imported)
			throw refused(imported.errors);

		const entries = imported.document.entries.map(toEntry);
		const confirmed = [...new Set(commanders)];
		if (confirmed.length === 0)
			throw refused([{ code: 'NO_COMMANDER', message: 'Confirm one or two Commanders before saving' }]);
		const seatCommanders = confirmed.map((scryfallId) => {
			const entry = entries.find(candidate => candidate.scryfallId === scryfallId);
			if (!entry)
				throw refused([{ code: 'COMMANDER_NOT_IN_LIST', message: 'A Commander must be a card of the pasted list' }]);
			return commanderOfDeckListEntry(entry);
		});
		const mainboardCount = commanderMainboardCount(entries, seatCommanders);
		const deckListId = await deckLists.createCommander(eventId, slotId, imported.document.sourceText, entries, mainboardCount);

		// Read after the lookup, so an edit to the Seat made meanwhile is kept.
		const slot = await slots.findById(slotId, eventId);
		const key = SLOT_SEAT_DATA_KEY[seat];
		// A paste replaces the Commanders picked by search, and keeps the Seat's player.
		const seatData: ManualPlayerSlotData = {
			name: slot?.[key]?.name,
			pronouns: slot?.[key]?.pronouns,
			lgs: slot?.[key]?.lgs,
			gameData: {
				type: 'mtg',
				commanders: seatCommanders,
				featureMatchDeckList: { id: deckListId, mainboardCount },
			},
		};

		let featureMatch: FeatureMatchResponse;
		try {
			featureMatch = await featureMatchSlotWriteModule().updateSetup({
				eventId,
				slotId,
				input: { [key]: seatData },
				originConnectionId,
			});
		}
		catch (error) {
			await runCompensation(error, () => deckLists.remove(slotId, [deckListId]));
			throw error;
		}
		// A save of the same Seat that started first but landed later leaves its Deck List held by nothing.
		await deckLists.removeUnheldBefore(slotId, deckListId, Object.values(SLOT_SEAT_DATA_KEY).map(seatKey => featureMatch[seatKey]));

		const saved = await deckLists.findCommanderById(deckListId, slotId, eventId);
		if (!saved)
			throw createError({ statusCode: 409, message: 'The Deck List was replaced while it was saved' });
		return { deckList: saved, featureMatch };
	}

	async function read({ eventId, slotId, deckListId }: ReadParams): Promise<SavedCommanderDeckList> {
		await requireCommanderEvent(eventId);
		const deckList = await deckLists.findCommanderById(deckListId, slotId, eventId);
		if (!deckList)
			throw createError({ statusCode: 404, message: 'Feature Match Deck List not found' });
		return deckList;
	}

	return { preview, save, read };
}
