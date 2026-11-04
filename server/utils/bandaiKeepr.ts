import type { z } from 'zod';
import type { OpCardSearchQuery } from '~~/server/schemas/api/opCard';
import type { BandaiKeeprCard, BandaiKeeprCardDetail } from '~~/server/schemas/external/bandaiKeepr';
import type { OpCardDetail, OpCardSummary } from '~~/shared/types/card/op';
import { bandaiKeeprCardDetailSchema, bandaiKeeprCardPageSchema, bandaiKeeprCollectionSchema } from '~~/server/schemas/external/bandaiKeepr';
import { opPrintingImageUrl } from '~~/shared/utils/card/op';
import { readConfiguredSecret } from './configuredSecret';

/**
 * The client of bandai-keepr, the One Piece card API (ADR-0057). It needs a
 * Bearer key and serves no CORS, so only this server calls it; the browser asks
 * the Event-scoped `op-cards` routes.
 */

const REQUEST_TIMEOUT_MS = 10_000;
/** A Card changes only when bandai-keepr rescrapes, so a number lookup is cached this long. */
const CARD_CACHE_SECONDS = 300;
const CARD_CACHE_NAME = 'bandai-keepr-cards';
/** `POST /cards/collection` takes at most this many identifiers a request. */
const COLLECTION_CHUNK_SIZE = 1000;

export class BandaiKeeprRequestError extends Error {
	readonly code = 'BANDAI_KEEPR_UPSTREAM_FAILURE';
	readonly status: number | null;

	constructor(message: string, options: { status?: number | null; cause?: unknown } = {}) {
		super(message, options.cause === undefined
			? undefined
			: { cause: options.cause });
		this.name = 'BandaiKeeprRequestError';
		this.status = options.status ?? null;
	}
}

export interface BandaiKeeprConfig {
	apiUrl: string;
	apiKey: string;
}

/** The configured bandai-keepr, or `null` when its key or URL is unset: card data is then unavailable. */
export function bandaiKeeprConfig(): BandaiKeeprConfig | null {
	const config = useRuntimeConfig();
	const apiKey = readConfiguredSecret(config.bandaiKeeprApiKey, 'NUXT_BANDAI_KEEPR_API_KEY');
	const apiUrl = readConfiguredSecret(config.bandaiKeeprApiUrl, 'NUXT_BANDAI_KEEPR_API_URL').replace(/\/+$/, '');
	return apiKey && apiUrl
		? { apiKey, apiUrl }
		: null;
}

/** Cards matching a search. A card-number search is the number lookup, narrowed by colour and category. */
export async function searchOpCards(config: BandaiKeeprConfig, query: OpCardSearchQuery): Promise<{ items: OpCardSummary[]; total: number }> {
	if (query.number) {
		const card = await lookupOpCard(config, query.number);
		const items: OpCardSummary[] = [];
		if (card && matchesFilters(card, query)) {
			const { printings: _printings, ...summary } = card;
			items.push(summary);
		}
		return { items, total: items.length };
	}

	const url = new URL(`${config.apiUrl}/cards`);
	if (query.q)
		url.searchParams.set('q', query.q);
	for (const color of query.color ?? [])
		url.searchParams.append('color', color);
	if (query.category)
		url.searchParams.set('category', query.category);
	url.searchParams.set('limit', String(query.limit));
	url.searchParams.set('offset', String(query.offset));

	const response = await request(config, url);
	// Every parameter is checked here first, so bandai-keepr refuses only text
	// with no words to search for (e.g. `!!`): that matches no cards.
	if (response.status === 400) {
		await response.body?.cancel().catch(() => undefined);
		return { items: [], total: 0 };
	}
	if (!response.ok)
		throw await upstreamFailure(response, 'search');
	const page = await parse(response, bandaiKeeprCardPageSchema, 'search');
	return {
		items: page.items.map(toSummary),
		total: page.total,
	};
}

/** The Card a number names, with every Printing; `null` when bandai-keepr does not know it. */
export async function lookupOpCard(config: BandaiKeeprConfig, number: string): Promise<OpCardDetail | null> {
	const url = new URL(`${config.apiUrl}/cards/${encodeURIComponent(number)}`);
	const cache = await openCardCache();
	// The key is the URL alone: the credential travels in a header, never in the key.
	const cacheKey = url.href;
	const hit = await cache?.match(cacheKey).catch(() => undefined);
	if (hit)
		return toDetail(await parse(hit, bandaiKeeprCardDetailSchema, 'cached lookup'));

	const response = await request(config, url);
	if (response.status === 404) {
		await response.body?.cancel().catch(() => undefined);
		return null;
	}
	if (!response.ok)
		throw await upstreamFailure(response, 'lookup');
	const card = await parse(response, bandaiKeeprCardDetailSchema, 'lookup');
	await cache?.put(cacheKey, Response.json(card, {
		headers: { 'Cache-Control': `max-age=${CARD_CACHE_SECONDS}` },
	})).catch(() => undefined);
	return toDetail(card);
}

/** What the bulk lookup answers: the cards bandai-keepr knows, and the numbers it does not. */
export interface OpCardBulkLookupAnswer {
	cards: OpCardSummary[];
	notFound: string[];
}

/**
 * The bulk lookup port (ADR-0074): many card numbers at once, through
 * `POST /cards/collection`, asked by number only and at most 1,000 a request.
 * A number bandai-keepr does not know is `notFound`; any other failure throws.
 */
export async function lookUpOpCards(config: BandaiKeeprConfig, numbers: readonly string[]): Promise<OpCardBulkLookupAnswer> {
	const answer: OpCardBulkLookupAnswer = { cards: [], notFound: [] };
	for (let start = 0; start < numbers.length; start += COLLECTION_CHUNK_SIZE) {
		const chunk = numbers.slice(start, start + COLLECTION_CHUNK_SIZE);
		const response = await request(config, new URL(`${config.apiUrl}/cards/collection`), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				identifiers: chunk.map(number => ({ number })),
			}),
		});
		if (!response.ok)
			throw await upstreamFailure(response, 'bulk lookup');
		const { results } = await parse(response, bandaiKeeprCollectionSchema, 'bulk lookup');
		const byIndex = new Map(results.map(result => [result.index, result]));
		chunk.forEach((number, index) => {
			const result = byIndex.get(index);
			if (result?.card)
				answer.cards.push(toSummary(result.card));
			else if (result?.error?.code === 'not_found')
				answer.notFound.push(number);
			else
				throw new BandaiKeeprRequestError(`bandai-keepr bulk lookup: unexpected answer for ${number}`);
		});
	}
	return answer;
}

/** The Workers Cache this server keeps number lookups in; absent outside workerd. */
async function openCardCache(): Promise<Cache | null> {
	if (typeof caches === 'undefined')
		return null;
	try {
		return await caches.open(CARD_CACHE_NAME);
	}
	catch {
		return null;
	}
}

async function request(config: BandaiKeeprConfig, url: URL, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	try {
		return await fetch(url, {
			method: init.method,
			body: init.body,
			headers: {
				...init.headers,
				Accept: 'application/json',
				Authorization: `Bearer ${config.apiKey}`,
			},
			signal: controller.signal,
		});
	}
	catch (error) {
		throw new BandaiKeeprRequestError(controller.signal.aborted
			? 'bandai-keepr request timed out'
			: 'bandai-keepr request failed', { cause: error });
	}
	finally {
		clearTimeout(timeout);
	}
}

async function upstreamFailure(response: Response, operation: string): Promise<BandaiKeeprRequestError> {
	await response.body?.cancel().catch(() => undefined);
	return new BandaiKeeprRequestError(`bandai-keepr ${operation}: HTTP ${response.status}`, { status: response.status });
}

async function parse<T>(response: Response, schema: z.ZodType<T>, operation: string): Promise<T> {
	let body: unknown;
	try {
		body = await response.json();
	}
	catch (error) {
		throw new BandaiKeeprRequestError(`bandai-keepr ${operation}: invalid JSON`, { cause: error });
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success)
		throw new BandaiKeeprRequestError(`bandai-keepr ${operation}: unexpected answer`, { cause: parsed.error });
	return parsed.data;
}

/** bandai-keepr's colour filter: a Card of any colour asked for. */
function matchesFilters(card: OpCardSummary, query: OpCardSearchQuery): boolean {
	if (query.category && card.category !== query.category)
		return false;
	return !query.color?.length || card.colors.some(color => (query.color as string[]).includes(color));
}

function toSummary(card: BandaiKeeprCard): OpCardSummary {
	const printingId = card.sourcePrintingId;
	return {
		number: card.number,
		name: card.name,
		category: card.category,
		colors: card.colors,
		cost: card.cost,
		life: card.life,
		power: card.power,
		counter: card.counter,
		types: card.types,
		effect: card.effect,
		trigger: card.trigger,
		printingId,
		imageUrl: opPrintingImageUrl(printingId),
	};
}

function toDetail(card: BandaiKeeprCardDetail): OpCardDetail {
	return {
		...toSummary(card),
		printings: card.printings.map(printing => ({
			id: printing.id,
			setId: printing.setId,
			kind: printing.kind,
			rarity: printing.rarity,
			imageUrl: opPrintingImageUrl(printing.id),
		})),
	};
}
