import type { ScryfallCardData } from '~~/server/utils/scryfall';
import type {
	BroadcastDeckListCardResolution,
	BroadcastDeckListCardResolutionRequest,
	BroadcastDeckListCardResolver,
	ResolvedBroadcastDeckListCard,
} from './index';
import { normalizeImportedCardName, normalizeImportedSetCode } from '~~/server/utils/cardNameNormalization';
import {
	batchLookupScryfallIds,
	createCardKey,
	fetchScryfallCardBySetAndCollector,
	isScryfallNotFoundError,
	ScryfallRequestError,
} from '~~/server/utils/scryfall';

export interface BroadcastDeckListNameOverride {
	inputName: string;
	inputSetCode: string | null;
	canonicalName: string;
}

export interface BroadcastDeckListScryfallBoundary {
	lookupByName: (
		requests: ReadonlyArray<{ name: string; setCode: string | null }>,
	) => Promise<ReadonlyArray<ScryfallCardData | null>>;
	lookupBySetAndCollector: (setCode: string, collectorNumber: string) => Promise<ScryfallCardData>;
}

export class BroadcastDeckListCardProviderError extends Error {
	readonly code = 'BROADCAST_DECK_LIST_CARD_PROVIDER_UNAVAILABLE';
	readonly retryable = true;

	constructor(cause: unknown) {
		super('Card data provider is temporarily unavailable', { cause });
		this.name = 'BroadcastDeckListCardProviderError';
	}
}

async function lookupScryfallCardsByName(
	requests: ReadonlyArray<{ name: string; setCode: string | null }>,
): Promise<ReadonlyArray<ScryfallCardData | null>> {
	const lookup = await batchLookupScryfallIds([...requests], {
		suppressNotFoundErrors: true,
		stopOnError: true,
	});
	if (lookup.errors.length > 0) {
		throw new ScryfallRequestError('Scryfall exact batch lookup failed', { retryable: true });
	}

	return requests.map(request => lookup.results.get(createCardKey(request.name, request.setCode)) ?? null);
}

const DEFAULT_SCRYFALL_BOUNDARY: BroadcastDeckListScryfallBoundary = {
	lookupByName: lookupScryfallCardsByName,
	lookupBySetAndCollector: fetchScryfallCardBySetAndCollector,
};

function normalizeSlashSpelling(name: string): string {
	return name.trim().replace(/\s*\/{1,2}\s*/g, ' // ').replace(/\s+/g, ' ');
}

function resolutionKey(request: BroadcastDeckListCardResolutionRequest): string {
	return [
		normalizeImportedCardName(request.name),
		normalizeImportedSetCode(request.setCode),
		request.collectorNumber ?? '',
	].join('|');
}

function overrideKey(name: string, setCode: string | null): string {
	return `${normalizeImportedCardName(name)}|${normalizeImportedSetCode(setCode)}`;
}

function cardMatchesName(card: ScryfallCardData, name: string): boolean {
	const expected = normalizeImportedCardName(normalizeSlashSpelling(name));
	const canonical = normalizeImportedCardName(card.name);
	if (expected === canonical)
		return true;

	return card.name
		.split(' // ')
		.some(faceName => normalizeImportedCardName(faceName) === expected);
}

function isExactPrinting(
	card: ScryfallCardData,
	request: BroadcastDeckListCardResolutionRequest,
): boolean {
	return cardMatchesName(card, request.name)
		&& (request.setCode === null || card.setCode.toLowerCase() === request.setCode.toLowerCase())
		&& (request.collectorNumber === null || card.collectorNumber === request.collectorNumber);
}

function canonicalCard(card: ScryfallCardData): ResolvedBroadcastDeckListCard {
	return {
		canonicalName: card.name,
		scryfallId: card.id,
		oracleId: card.oracleId,
		setCode: card.setCode.toLowerCase(),
		collectorNumber: card.collectorNumber ?? null,
		cardType: card.typeLine,
		colors: card.colors,
		manaCost: card.manaCost,
		manaValue: card.cmc,
		deckCounterTypes: [...card.deckCounterTypes],
	};
}

async function lookupCollectorCards(
	requests: readonly BroadcastDeckListCardResolutionRequest[],
	scryfall: BroadcastDeckListScryfallBoundary,
): Promise<Map<string, ScryfallCardData | null>> {
	const cards = new Map<string, ScryfallCardData | null>();
	const concurrency = 4;
	for (let index = 0; index < requests.length; index += concurrency) {
		const chunk = requests.slice(index, index + concurrency);
		const settled = await Promise.all(chunk.map(async (request) => {
			try {
				return await scryfall.lookupBySetAndCollector(request.setCode!, request.collectorNumber!);
			}
			catch (error) {
				if (isScryfallNotFoundError(error))
					return null;
				throw error;
			}
		}));
		for (const [chunkIndex, card] of settled.entries())
			cards.set(resolutionKey(chunk[chunkIndex]!), card);
	}
	return cards;
}

export function createBroadcastDeckListScryfallResolver(options: {
	overrides?: readonly BroadcastDeckListNameOverride[];
	scryfall?: BroadcastDeckListScryfallBoundary;
} = {}): BroadcastDeckListCardResolver {
	const scryfall = options.scryfall ?? DEFAULT_SCRYFALL_BOUNDARY;
	const overrides = new Map<string, string>();
	for (const override of options.overrides ?? [])
		overrides.set(overrideKey(override.inputName, override.inputSetCode), override.canonicalName);

	return {
		async resolve(requests): Promise<readonly BroadcastDeckListCardResolution[]> {
			const prepared = requests.map((request) => {
				const setCode = request.setCode ? request.setCode.toLowerCase() : null;
				const canonicalName = overrides.get(overrideKey(request.name, setCode))
					?? overrides.get(overrideKey(request.name, null))
					?? request.name;
				return {
					name: normalizeSlashSpelling(canonicalName),
					setCode,
					collectorNumber: request.collectorNumber,
				} satisfies BroadcastDeckListCardResolutionRequest;
			});
			const unique = new Map(prepared.map(request => [resolutionKey(request), request]));
			const named = [...unique.values()].filter(request => request.collectorNumber === null);
			const collectors = [...unique.values()].filter(request => request.collectorNumber !== null);

			try {
				const namedCards = await scryfall.lookupByName(named.map(request => ({
					name: request.name,
					setCode: request.setCode,
				})));
				const cards = new Map<string, ScryfallCardData | null>();
				for (const [index, request] of named.entries())
					cards.set(resolutionKey(request), namedCards[index] ?? null);
				for (const [key, card] of await lookupCollectorCards(collectors, scryfall))
					cards.set(key, card);

				return prepared.map((request) => {
					const card = cards.get(resolutionKey(request)) ?? null;
					return card && isExactPrinting(card, request)
						? { status: 'resolved' as const, card: canonicalCard(card) }
						: { status: 'unresolved' as const };
				});
			}
			catch (error) {
				if (error instanceof BroadcastDeckListCardProviderError)
					throw error;
				throw new BroadcastDeckListCardProviderError(error);
			}
		},
	};
}
