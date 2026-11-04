import type { BandaiKeeprConfig } from '~~/server/utils/bandaiKeepr';
import type { FeatureMatchResponse, ManualPlayerSlotData } from '~~/shared/api';
import type { PlayerSide } from '~~/shared/types/enums';
import type {
	FeatureMatchDeckListPreviewAnswer,
	FeatureMatchDeckListView,
	SavedFeatureMatchDeckList,
	SaveFeatureMatchDeckListAnswer,
} from '~~/shared/types/featureMatchDeckList';
import type { OpLeader } from '~~/shared/types/game';
import { featureMatchSlotWriteModule } from '~~/server/modules/feature-match-slot-write';
import { opCardCatalogueModule } from '~~/server/modules/op-card-catalogue';
import { featureMatchService } from '~~/server/services/featureMatch';
import { featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { bandaiKeeprConfig } from '~~/server/utils/bandaiKeepr';
import { runCompensation } from '~~/server/utils/errors';
import { requireOpEvent } from '~~/server/utils/routeGuards';
import { catalogueOpLeader } from '~~/shared/utils/card/op';
import { getOpGameData } from '~~/shared/utils/gameData';
import { featureMatchDeckListView, parseFeatureMatchDeckListText } from './paste';

/**
 * Feature Match Deck List seam (ADR-0057): previewing a paste, saving it to a
 * Slot side, and reading a saved one. A paste's cards come from the card
 * catalogue, and a failed lookup fails the paste whole (ADR-0074).
 *
 * A save stores the Deck List, then writes the side's slot data through the
 * Slot setup write: the side's Leader becomes the pasted one, and the side
 * references the new Deck List. That write corrects the active Session's
 * source snapshot and announces the Slot, as any setup save does, and drops
 * the Deck List the side held before.
 */

const SIDE_DATA_KEY = { player1: 'player1Data', player2: 'player2Data' } as const satisfies Record<PlayerSide, string>;

/** A paste's cards, through the card catalogue: one bulk lookup for the numbers it lacks (ADR-0074). */
async function resolvePaste(config: BandaiKeeprConfig, text: string): Promise<FeatureMatchDeckListView> {
	const lines = parseFeatureMatchDeckListText(text);
	const cards = await opCardCatalogueModule().resolve(() => config, lines.map(line => line.number));
	return featureMatchDeckListView(lines.map(line => ({
		number: line.number,
		quantity: line.quantity,
		card: cards.get(line.number) ?? null,
	})));
}

function leaderOf(view: FeatureMatchDeckListView): OpLeader | null {
	const entry = view.entries.find(candidate => candidate.number === view.leaderNumber);
	return entry?.card
		? catalogueOpLeader(entry.number, entry.card)
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

		// Read after the lookup, so an edit to the side made meanwhile is kept.
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
