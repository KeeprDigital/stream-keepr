import type { BandaiKeeprConfig } from '~~/server/utils/bandaiKeepr';
import type { OpCatalogueCard } from '~~/shared/types/card/op';
import { opCardCatalogueService } from '~~/server/services/opCardCatalogue';
import { lookUpOpCards } from '~~/server/utils/bandaiKeepr';
import { ServiceConfigurationError } from '~~/server/utils/errors';

/**
 * Card numbers resolved through the card catalogue (ADR-0074). A number the
 * catalogue holds is never looked up again; the rest go to bandai-keepr's bulk
 * lookup together, and the cards it knows join the catalogue. A number it does
 * not know gets no row, so the next resolve asks for it again. A failed lookup
 * throws before anything is added, and so does one with no bandai-keepr
 * configured (503); a resolve the catalogue answers whole never reads the configuration.
 */
export function opCardCatalogueModule() {
	const catalogue = opCardCatalogueService();

	/** Each number's card, or `null` for one bandai-keepr does not know. */
	async function resolve(configured: () => BandaiKeeprConfig | null, numbers: readonly string[]): Promise<Map<string, OpCatalogueCard | null>> {
		const distinct = [
			...new Set(numbers),
		];
		const held = await catalogue.findByNumbers(distinct);
		const missing = distinct.filter(number => !held.has(number));
		if (missing.length > 0) {
			const config = configured();
			if (!config)
				throw new ServiceConfigurationError('NUXT_BANDAI_KEEPR_API_KEY', 'is not configured');
			const answer = await lookUpOpCards(config, missing);
			await catalogue.add(answer.cards);
			// Read back, so a row another write added meanwhile is the one answered.
			for (const [number, card] of await catalogue.findByNumbers(answer.cards.map(card => card.number)))
				held.set(number, card);
		}
		return new Map(distinct.map(number => [number, held.get(number) ?? null]));
	}

	return { resolve };
}
