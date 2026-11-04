import type { BandaiKeeprConfig } from '~~/server/utils/bandaiKeepr';
import type { FeatureMatchResponse } from '~~/shared/api';
import type { PlayerSide } from '~~/shared/types/enums';
import type {
	FeatureMatchDeckListPreviewAnswer,
	FeatureMatchDeckListView,
	SavedFeatureMatchDeckList,
	SaveFeatureMatchDeckListAnswer,
} from '~~/shared/types/featureMatchDeckList';
import { opCardCatalogueModule } from '~~/server/modules/op-card-catalogue';
import { opDeckListWriteModule } from '~~/server/modules/op-deck-list-write';
import { opDeckListView, parseOpDeckListText } from '~~/server/modules/op-deck-list-write/paste';
import { featureMatchService } from '~~/server/services/featureMatch';
import { featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { bandaiKeeprConfig } from '~~/server/utils/bandaiKeepr';
import { requireOpEvent } from '~~/server/utils/routeGuards';

/**
 * Feature Match Deck List seam (ADR-0057): previewing a paste, saving it to a
 * Slot side, and reading a saved one. A save is the OP Deck List write's, for
 * a Slot side (ADR-0074); this seam answers unavailable when no bandai-keepr
 * is configured.
 */

/** A paste's cards, through the card catalogue: one bulk lookup for the numbers it lacks (ADR-0074). */
async function resolvePaste(config: BandaiKeeprConfig, text: string): Promise<FeatureMatchDeckListView> {
	const lines = parseOpDeckListText(text);
	const cards = await opCardCatalogueModule().resolve(() => config, lines.map(line => line.number));
	return opDeckListView(lines.map(line => ({
		number: line.number,
		quantity: line.quantity,
		card: cards.get(line.number) ?? null,
	})));
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
		if (!bandaiKeeprConfig())
			return { available: false };
		const answer = await opDeckListWriteModule().write({
			eventId,
			owner: { kind: 'slotSide', slotId, side },
			input: { text },
			source: 'hand',
			originConnectionId,
		});
		return { available: true, ...answer };
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
