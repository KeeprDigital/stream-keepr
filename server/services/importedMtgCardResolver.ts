import type { DbCard } from '~~/server/db/schema';
import type { ScryfallCardData } from '~~/server/utils/scryfall';
import { eventCardNameOverrideService } from '~~/server/services/eventCardNameOverride';
import {
	batchLookupScryfallIds,
	createCardKey,
	fetchScryfallCardByName,
	getCardDataFromMap,
	isScryfallNotFoundError,
} from '~~/server/utils/scryfall';

export interface ImportedMtgCardIdentifier {
	name: string;
	setCode: string | null;
}

interface ImportedMtgCardResolutionBase {
	inputName: string;
	inputSetCode: string | null;
}

export interface ImportedMtgCardResolved extends ImportedMtgCardResolutionBase {
	status: 'resolved';
	source: 'override' | 'exact' | 'fuzzy';
	resolvedName: string;
	cardData: ScryfallCardData | null;
	overrideCard: DbCard | null;
}

export interface ImportedMtgCardUnresolved extends ImportedMtgCardResolutionBase {
	status: 'unresolved';
}

export type ImportedMtgCardResolution = ImportedMtgCardResolved | ImportedMtgCardUnresolved;

export interface ResolveImportedMtgCardsResult {
	resolutions: Map<string, ImportedMtgCardResolution>;
}

export class ImportedMtgCardLookupError extends Error {
	readonly code = 'IMPORTED_CARD_LOOKUP_UNAVAILABLE';
	readonly details: readonly string[];

	constructor(details: readonly string[]) {
		super('Card data lookup is temporarily unavailable; existing deck data was preserved');
		this.name = 'ImportedMtgCardLookupError';
		this.details = [...details];
	}
}

function createOverrideLookupKey(name: string, setCode: string | null): string {
	return createCardKey(name, setCode);
}

function buildOverrideResolution(
	inputName: string,
	inputSetCode: string | null,
	card: DbCard,
): ImportedMtgCardResolved {
	return {
		status: 'resolved',
		source: 'override',
		inputName,
		inputSetCode,
		resolvedName: card.name,
		cardData: card.scryfallId
			? {
					name: card.name,
					setCode: inputSetCode ?? '',
					collectorNumber: null,
					id: card.scryfallId,
					oracleId: card.oracleId,
					manaCost: card.manaCost,
					cmc: card.cmc,
					colors: card.colors,
					typeLine: card.cardType,
					deckCounterTypes: card.deckCounterTypes,
					deckTokens: card.deckTokens,
				}
			: null,
		overrideCard: card,
	};
}

function lookupErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function importedMtgCardResolverService() {
	const resolveBatch = async (
		eventId: number,
		cards: ImportedMtgCardIdentifier[],
	): Promise<ResolveImportedMtgCardsResult> => {
		const resolutions = new Map<string, ImportedMtgCardResolution>();

		if (cards.length === 0) {
			return { resolutions };
		}

		const uniqueCards = new Map<string, ImportedMtgCardIdentifier>();
		for (const card of cards) {
			uniqueCards.set(createCardKey(card.name, card.setCode), card);
		}

		const overrides = await eventCardNameOverrideService().listResolvedByEvent(eventId);
		const overrideMap = new Map<string, DbCard>();
		for (const override of overrides) {
			overrideMap.set(createOverrideLookupKey(override.inputName, override.inputSetCode), override.card);
		}

		const pendingExactLookups: ImportedMtgCardIdentifier[] = [];
		for (const card of uniqueCards.values()) {
			const exactOverride = overrideMap.get(createOverrideLookupKey(card.name, card.setCode));
			const genericOverride = overrideMap.get(createOverrideLookupKey(card.name, null));
			const overrideCard = exactOverride ?? genericOverride;

			if (overrideCard) {
				resolutions.set(
					createCardKey(card.name, card.setCode),
					buildOverrideResolution(card.name, card.setCode, overrideCard),
				);
				continue;
			}

			pendingExactLookups.push(card);
		}

		const exactLookup = await batchLookupScryfallIds(pendingExactLookups, {
			suppressNotFoundErrors: true,
			stopOnError: true,
		});
		if (exactLookup.errors.length > 0)
			throw new ImportedMtgCardLookupError(exactLookup.errors);

		const fuzzyLookups: ImportedMtgCardIdentifier[] = [];
		for (const card of pendingExactLookups) {
			const exactData = getCardDataFromMap(exactLookup.results, card.name, card.setCode);
			if (exactData) {
				resolutions.set(createCardKey(card.name, card.setCode), {
					status: 'resolved',
					source: 'exact',
					inputName: card.name,
					inputSetCode: card.setCode,
					resolvedName: exactData.name,
					cardData: exactData,
					overrideCard: null,
				});
				continue;
			}

			fuzzyLookups.push(card);
		}

		const resolveFuzzyCard = async (card: ImportedMtgCardIdentifier) => {
			let fuzzyData: ScryfallCardData | null = null;
			try {
				fuzzyData = await fetchScryfallCardByName({ fuzzy: card.name, setCode: card.setCode });
			}
			catch (error) {
				if (!isScryfallNotFoundError(error))
					throw new ImportedMtgCardLookupError([lookupErrorMessage(error)]);
			}

			if (!fuzzyData && card.setCode) {
				try {
					fuzzyData = await fetchScryfallCardByName({ fuzzy: card.name });
				}
				catch (error) {
					if (!isScryfallNotFoundError(error))
						throw new ImportedMtgCardLookupError([lookupErrorMessage(error)]);
					fuzzyData = null;
				}
			}

			if (fuzzyData) {
				return {
					key: createCardKey(card.name, card.setCode),
					resolution: {
						status: 'resolved',
						source: 'fuzzy',
						inputName: card.name,
						inputSetCode: card.setCode,
						resolvedName: fuzzyData.name,
						cardData: fuzzyData,
						overrideCard: null,
					} satisfies ImportedMtgCardResolution,
				};
			}

			return {
				key: createCardKey(card.name, card.setCode),
				resolution: {
					status: 'unresolved',
					inputName: card.name,
					inputSetCode: card.setCode,
				} satisfies ImportedMtgCardResolution,
			};
		};

		// Resolve a few named lookups at a time. This avoids the previous fully
		// serial fallback without turning a large import into an unbounded burst.
		const FUZZY_LOOKUP_CONCURRENCY = 4;
		for (let index = 0; index < fuzzyLookups.length; index += FUZZY_LOOKUP_CONCURRENCY) {
			const chunk = fuzzyLookups.slice(index, index + FUZZY_LOOKUP_CONCURRENCY);
			const settled = await Promise.allSettled(chunk.map(resolveFuzzyCard));
			const failed = settled.find(result => result.status === 'rejected');
			if (failed?.status === 'rejected')
				throw failed.reason;
			for (const result of settled) {
				if (result.status === 'fulfilled')
					resolutions.set(result.value.key, result.value.resolution);
			}
		}

		return { resolutions };
	};

	return {
		resolveBatch,
	};
}
