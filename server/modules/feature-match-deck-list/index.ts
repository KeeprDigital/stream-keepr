import type { BandaiKeeprConfig } from '~~/server/utils/bandaiKeepr';
import type { FeatureMatchResponse, ManualPlayerSlotData } from '~~/shared/api';
import type { OpCardColor, OpCardDetail } from '~~/shared/types/card/op';
import type { PlayerSide } from '~~/shared/types/enums';
import type {
	FeatureMatchDeckListCard,
	FeatureMatchDeckListPreviewAnswer,
	FeatureMatchDeckListView,
	SavedFeatureMatchDeckList,
	SaveFeatureMatchDeckListAnswer,
} from '~~/shared/types/featureMatchDeckList';
import type { OpLeader } from '~~/shared/types/game';
import { featureMatchSlotWriteModule } from '~~/server/modules/feature-match-slot-write';
import { featureMatchService } from '~~/server/services/featureMatch';
import { featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { bandaiKeeprConfig, lookupOpCard } from '~~/server/utils/bandaiKeepr';
import { runCompensation } from '~~/server/utils/errors';
import { requireOpEvent } from '~~/server/utils/routeGuards';
import { OP_CARD_COLORS } from '~~/shared/types/card/op';
import { getOpGameData } from '~~/shared/utils/gameData';
import { featureMatchDeckListView, parseFeatureMatchDeckListText } from './paste';

/**
 * Feature Match Deck List seam (ADR-0057): previewing a paste, saving it to a
 * Slot side, and reading a saved one.
 *
 * A save stores the Deck List, then writes the side's slot data through the
 * Slot setup write: the side's Leader becomes the pasted one, and the side
 * references the new Deck List. That write corrects the active Session's
 * source snapshot and announces the Slot, as any setup save does, and drops
 * the Deck List the side held before.
 */

const SIDE_DATA_KEY = { player1: 'player1Data', player2: 'player2Data' } as const satisfies Record<PlayerSide, string>;

/** bandai-keepr has no batch lookup, so a paste is resolved this many numbers at a time. */
const LOOKUP_CONCURRENCY = 6;
/** A Deck List names one Leader and at most 50 numbers; this leaves room for mistakes, not for abuse. */
const MAX_DECK_LIST_CARD_NUMBERS = 80;

function isOpCardColor(value: string): value is OpCardColor {
	return (OP_CARD_COLORS as readonly string[]).includes(value);
}

function toDeckListCard(card: OpCardDetail): FeatureMatchDeckListCard {
	return {
		name: card.name,
		category: card.category,
		colors: card.colors.filter(isOpCardColor),
		cost: card.cost,
		power: card.power,
		counter: card.counter,
		imageUrl: card.imageUrl,
	};
}

/** Each number's card, or `null` for one bandai-keepr does not know; each number asked once. */
async function lookUpCards(config: BandaiKeeprConfig, numbers: readonly string[]): Promise<Map<string, OpCardDetail | null>> {
	const cards = new Map<string, OpCardDetail | null>();
	let next = 0;
	let failed = false;
	async function worker() {
		while (!failed && next < numbers.length) {
			const number = numbers[next++]!;
			try {
				cards.set(number, await lookupOpCard(config, number));
			}
			catch (error) {
				// One failed lookup fails the paste; the other workers ask nothing more.
				failed = true;
				throw error;
			}
		}
	}
	await Promise.all(Array.from({
		length: Math.min(LOOKUP_CONCURRENCY, numbers.length),
	}, worker));
	return cards;
}

async function resolvePaste(config: BandaiKeeprConfig, text: string): Promise<FeatureMatchDeckListView> {
	const lines = parseFeatureMatchDeckListText(text);
	if (lines.length > MAX_DECK_LIST_CARD_NUMBERS)
		throw createError({ statusCode: 400, message: `A Deck List names at most ${MAX_DECK_LIST_CARD_NUMBERS} card numbers` });
	const cards = await lookUpCards(config, lines.map(line => line.number));
	return featureMatchDeckListView(lines.map((line) => {
		const card = cards.get(line.number);
		return {
			number: line.number,
			quantity: line.quantity,
			card: card
				? toDeckListCard(card)
				: null,
		};
	}));
}

function leaderOf(view: FeatureMatchDeckListView): OpLeader | null {
	const entry = view.entries.find(candidate => candidate.number === view.leaderNumber);
	return entry?.card
		? {
				number: entry.number,
				name: entry.card.name,
				colors: entry.card.colors,
				imageUrl: entry.card.imageUrl,
			}
		: null;
}

interface PreviewParams {
	eventId: number;
	text: string;
}

interface SaveParams {
	eventId: number;
	slotId: number;
	/** The Slot side, in the Slot's own order: a swap is the Session's, never the Slot's. */
	side: PlayerSide;
	text: string;
	originConnectionId?: string;
}

interface ReadParams {
	eventId: number;
	slotId: number;
	deckListId: number;
}

export function featureMatchDeckListModule() {
	const deckLists = featureMatchDeckListService();
	const slots = featureMatchService();

	async function preview({ eventId, text }: PreviewParams): Promise<FeatureMatchDeckListPreviewAnswer> {
		await requireOpEvent(eventId);
		const config = bandaiKeeprConfig();
		if (!config)
			return { available: false };
		return { available: true, deckList: await resolvePaste(config, text) };
	}

	async function save({ eventId, slotId, side, text, originConnectionId }: SaveParams): Promise<SaveFeatureMatchDeckListAnswer<FeatureMatchResponse>> {
		await requireOpEvent(eventId);
		if (!await slots.exists(slotId, eventId))
			throw createError({ statusCode: 404, message: 'Feature match slot not found' });
		const config = bandaiKeeprConfig();
		if (!config)
			return { available: false };

		const view = await resolvePaste(config, text);
		const deckListId = await deckLists.create(eventId, slotId, text, view);

		// Read after the lookups, so an edit to the side made meanwhile is kept.
		const slot = await slots.findById(slotId, eventId);
		const key = SIDE_DATA_KEY[side];
		// Provenance is never written by an operator save; an OP Slot carries none.
		const { externalId: _externalId, externalSource: _externalSource, ...current } = slot?.[key] ?? {};
		const currentGameData = getOpGameData(current.gameData);
		const sideData: ManualPlayerSlotData = {
			...current,
			gameData: {
				...currentGameData,
				leader: leaderOf(view) ?? currentGameData.leader,
				featureMatchDeckList: { id: deckListId, mainboardCount: view.mainboardCount },
			},
		};

		let featureMatch: FeatureMatchResponse;
		try {
			featureMatch = await featureMatchSlotWriteModule().updateSetup({
				eventId,
				slotId,
				input: { [key]: sideData },
				originConnectionId,
			});
		}
		catch (error) {
			await runCompensation(error, () => deckLists.remove(slotId, [deckListId]));
			throw error;
		}
		// A save of the same side that started first but landed later leaves its Deck List held by nothing.
		await deckLists.removeUnheldBefore(slotId, deckListId, [featureMatch.player1Data, featureMatch.player2Data]);

		const saved = await deckLists.findById(deckListId, slotId, eventId);
		if (!saved)
			throw createError({ statusCode: 409, message: 'The Deck List was replaced while it was saved' });
		return { available: true, deckList: saved, featureMatch };
	}

	async function read({ eventId, slotId, deckListId }: ReadParams): Promise<SavedFeatureMatchDeckList> {
		await requireOpEvent(eventId);
		const deckList = await deckLists.findById(deckListId, slotId, eventId);
		if (!deckList)
			throw createError({ statusCode: 404, message: 'Feature Match Deck List not found' });
		return deckList;
	}

	return { preview, save, read };
}
