import type { ScryfallCard } from '@scryfall/api-types';
import type { DeckTokenRequirement } from '~~/shared/utils/deckTokens';
import { scryfallCardSchema, scryfallCollectionResponseSchema } from '~~/server/schemas/external/scryfall';
import { deriveDeckCounterTypesFromScryfallCard } from '~~/shared/utils/deckCounters';
import { deriveDeckTokensFromScryfallCard } from '~~/shared/utils/deckTokens';

const SCRYFALL_API_URL = 'https://api.scryfall.com';
const SCRYFALL_HEADERS = {
	'Accept': 'application/json',
	'User-Agent': 'stream-keepr/1.0',
};
const SCRYFALL_REQUEST_TIMEOUT_MS = 10_000;
const SCRYFALL_MAX_RETRIES = 2;
const SCRYFALL_RETRY_BASE_DELAY_MS = 250;
const SCRYFALL_CARD_BODY_LIMIT_BYTES = 1024 * 1024;
const SCRYFALL_COLLECTION_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

export class ScryfallRequestError extends Error {
	readonly code = 'SCRYFALL_UPSTREAM_FAILURE';
	readonly status: number | null;
	readonly retryable: boolean;
	readonly notFound: boolean;

	constructor(
		message: string,
		options: { status?: number | null; retryable?: boolean; notFound?: boolean; cause?: unknown } = {},
	) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = 'ScryfallRequestError';
		this.status = options.status ?? null;
		this.retryable = options.retryable ?? false;
		this.notFound = options.notFound ?? false;
	}
}

export function isScryfallNotFoundError(error: unknown): boolean {
	return error instanceof ScryfallRequestError && error.notFound;
}

function parseScryfallCard(raw: unknown, errorPrefix: string): ScryfallCard.Any {
	const parsed = scryfallCardSchema.safeParse(raw);
	if (!parsed.success) {
		throw new ScryfallRequestError(`${errorPrefix}: invalid response schema`, {
			cause: parsed.error,
		});
	}

	return parsed.data as ScryfallCard.Any;
}

function parseScryfallCollection(raw: unknown, errorPrefix: string): ScryfallCollectionResponse {
	const parsed = scryfallCollectionResponseSchema.safeParse(raw);
	if (!parsed.success) {
		throw new ScryfallRequestError(`${errorPrefix}: invalid response schema`, {
			cause: parsed.error,
		});
	}

	return {
		object: parsed.data.object,
		not_found: parsed.data.not_found,
		data: parsed.data.data.map(card => card as ScryfallCard.Any),
	};
}

function delay(milliseconds: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function createScryfallResponseError(response: Response, prefix: string): Promise<ScryfallRequestError> {
	await response.body?.cancel().catch(() => undefined);
	const status = Number.isInteger(response.status) ? response.status : null;
	const notFound = status === 404 || response.statusText?.toLowerCase() === 'not found';
	return new ScryfallRequestError(
		`${prefix}: HTTP ${status ?? 'unknown'}`,
		{
			status,
			notFound,
			retryable: status !== null && isRetryableStatus(status),
		},
	);
}

async function readJsonResponseLimited(
	response: Response,
	maxBytes: number,
	errorPrefix: string,
): Promise<unknown> {
	const declaredLength = response.headers?.get('Content-Length');
	if (declaredLength && /^\d+$/.test(declaredLength.trim()) && Number(declaredLength) > maxBytes) {
		await response.body?.cancel().catch(() => undefined);
		throw new ScryfallRequestError(`${errorPrefix}: response exceeded the configured size limit`);
	}

	if (!response.body) {
		try {
			const value = await response.json();
			const serialized = JSON.stringify(value);
			if (serialized === undefined)
				throw new SyntaxError('JSON response was empty');
			if (new TextEncoder().encode(serialized).byteLength > maxBytes)
				throw new ScryfallRequestError(`${errorPrefix}: response exceeded the configured size limit`);
			return value;
		}
		catch (error) {
			if (error instanceof ScryfallRequestError)
				throw error;
			throw new ScryfallRequestError(`${errorPrefix}: invalid JSON response`, { cause: error });
		}
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done)
				break;
			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new ScryfallRequestError(`${errorPrefix}: response exceeded the configured size limit`);
			}
			chunks.push(value);
		}
	}
	finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	try {
		return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
	}
	catch (error) {
		throw new ScryfallRequestError(`${errorPrefix}: invalid JSON response`, { cause: error });
	}
}

async function fetchScryfallJson(
	input: string,
	init: RequestInit,
	errorPrefix: string,
	maxResponseBytes: number,
): Promise<unknown> {
	for (let attempt = 0; attempt <= SCRYFALL_MAX_RETRIES; attempt++) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), SCRYFALL_REQUEST_TIMEOUT_MS);
		let failure: ScryfallRequestError | null = null;
		try {
			const response = await fetch(input, { ...init, signal: controller.signal });
			if (response.ok)
				return await readJsonResponseLimited(response, maxResponseBytes, errorPrefix);
			else
				failure = await createScryfallResponseError(response, errorPrefix);
		}
		catch (error) {
			if (error instanceof ScryfallRequestError) {
				failure = error;
			}
			else {
				const timedOut = controller.signal.aborted;
				failure = new ScryfallRequestError(
					timedOut ? `${errorPrefix}: request timed out` : `${errorPrefix}: network request failed`,
					{ retryable: true, cause: error },
				);
			}
		}
		finally {
			clearTimeout(timeout);
		}

		if (!failure.retryable || attempt === SCRYFALL_MAX_RETRIES)
			throw failure;

		await delay(SCRYFALL_RETRY_BASE_DELAY_MS * 2 ** attempt);
	}

	throw new ScryfallRequestError(`${errorPrefix}: request failed`, { retryable: true });
}

const COLLECTION_BATCH_SIZE = 75; // Scryfall limit per request

interface CardIdentifier {
	name: string;
	set?: string;
}

interface ScryfallCollectionResponse {
	object: 'list';
	not_found: CardIdentifier[];
	data: ScryfallCard.Any[];
}

function mapScryfallCardData(card: ScryfallCard.Any): ScryfallCardData {
	const colorIdentity = 'color_identity' in card && Array.isArray(card.color_identity)
		? (card.color_identity as string[]).join('')
		: null;

	const typeLine = 'type_line' in card && card.type_line
		? (card.type_line as string)
		: null;

	const cmc = 'cmc' in card && (card as { cmc?: number | null }).cmc != null
		? (card as { cmc: number }).cmc
		: null;

	return {
		name: card.name,
		setCode: card.set,
		collectorNumber: 'collector_number' in card && typeof card.collector_number === 'string'
			? card.collector_number
			: null,
		id: card.id,
		oracleId: extractOracleId(card),
		manaCost: extractManaCost(card),
		cmc,
		colors: colorIdentity,
		typeLine,
		deckCounterTypes: deriveDeckCounterTypesFromScryfallCard(card),
		deckTokens: deriveDeckTokensFromScryfallCard(card),
	};
}

/**
 * Card data returned from Scryfall lookup
 */
export interface ScryfallCardData {
	name: string;
	setCode: string;
	collectorNumber: string | null;
	id: string;
	oracleId: string | null;
	manaCost: string | null;
	/** Converted mana cost (numeric) */
	cmc: number | null;
	/** Joined color identity string e.g. "WUB" */
	colors: string | null;
	/** Type line e.g. "Creature — Vampire Cleric" */
	typeLine: string | null;
	/** Player-level counters this card can require for match tracking */
	deckCounterTypes: string[];
	/** Linked token cards this card can create */
	deckTokens: DeckTokenRequirement[];
}

export async function fetchScryfallCardById(id: string): Promise<ScryfallCardData> {
	const errorPrefix = 'Scryfall card lookup failed';
	const raw = await fetchScryfallJson(
		`${SCRYFALL_API_URL}/cards/${encodeURIComponent(id)}`,
		{ headers: SCRYFALL_HEADERS },
		errorPrefix,
		SCRYFALL_CARD_BODY_LIMIT_BYTES,
	);
	const card = parseScryfallCard(raw, errorPrefix);
	return mapScryfallCardData(card);
}

export async function fetchScryfallCardByName(params: {
	exact?: string;
	fuzzy?: string;
	setCode?: string | null;
}): Promise<ScryfallCardData> {
	const query = new URLSearchParams();
	if (params.exact) {
		query.set('exact', params.exact);
	}
	if (params.fuzzy) {
		query.set('fuzzy', params.fuzzy);
	}
	if (params.setCode) {
		query.set('set', params.setCode);
	}

	const errorPrefix = 'Scryfall named lookup failed';
	const raw = await fetchScryfallJson(
		`${SCRYFALL_API_URL}/cards/named?${query.toString()}`,
		{ headers: SCRYFALL_HEADERS },
		errorPrefix,
		SCRYFALL_CARD_BODY_LIMIT_BYTES,
	);
	const card = parseScryfallCard(raw, errorPrefix);
	return mapScryfallCardData(card);
}

export async function fetchScryfallCardBySetAndCollector(
	setCode: string,
	collectorNumber: string,
): Promise<ScryfallCardData> {
	const errorPrefix = 'Scryfall exact printing lookup failed';
	const raw = await fetchScryfallJson(
		`${SCRYFALL_API_URL}/cards/${encodeURIComponent(setCode)}/${encodeURIComponent(collectorNumber)}`,
		{ headers: SCRYFALL_HEADERS },
		errorPrefix,
		SCRYFALL_CARD_BODY_LIMIT_BYTES,
	);
	const card = parseScryfallCard(raw, errorPrefix);
	if (!('collector_number' in card) || typeof card.collector_number !== 'string') {
		throw new ScryfallRequestError(`${errorPrefix}: invalid response schema`);
	}
	return mapScryfallCardData(card);
}

/**
 * Fetch Scryfall card data for a batch of card identifiers
 * Uses the /cards/collection endpoint which accepts up to 75 cards per request
 */
async function fetchCardCollection(identifiers: CardIdentifier[]): Promise<ScryfallCollectionResponse> {
	const raw = await fetchScryfallJson(`${SCRYFALL_API_URL}/cards/collection`, {
		method: 'POST',
		headers: {
			...SCRYFALL_HEADERS,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ identifiers }),
	}, 'Scryfall API request failed', SCRYFALL_COLLECTION_BODY_LIMIT_BYTES);

	// Validate the response shape at the external API boundary.
	// scryfallCollectionResponseSchema uses .passthrough() so extra Scryfall fields are preserved.
	return parseScryfallCollection(raw, 'Scryfall API request failed');
}

/**
 * Create a lookup key for card identification
 */
export function createCardKey(name: string, setCode: string | null): string {
	return setCode ? `${name.toLowerCase()}|${setCode.toLowerCase()}` : name.toLowerCase();
}

/**
 * Extract mana cost from a Scryfall card.
 *
 * Card layout handling:
 * - Simple cards: top-level mana_cost is correct (e.g. "{1}{W}")
 * - Transform / modal_dfc: top-level mana_cost is absent; front face holds the cost
 * - Split / adventure: top-level mana_cost is the combined string (e.g. "{1}{R} // {1}{U}");
 *   we use card_faces[0] for the castable front-face cost instead
 */
function extractManaCost(card: ScryfallCard.Any): string | null {
	// Simple cards: top-level mana_cost is present and not the combined "//" format
	if ('mana_cost' in card && card.mana_cost && !card.mana_cost.includes(' // ')) {
		return card.mana_cost;
	}

	// DFCs (top-level absent), split and adventure (top-level is combined):
	// use the front face mana cost for accurate pip counting
	if ('card_faces' in card && card.card_faces?.[0]) {
		const frontFace = card.card_faces[0];
		if ('mana_cost' in frontFace && frontFace.mana_cost) {
			return frontFace.mana_cost;
		}
	}

	return null;
}

function extractOracleId(card: ScryfallCard.Any): string | null {
	if ('oracle_id' in card && typeof card.oracle_id === 'string') {
		return card.oracle_id;
	}

	if ('card_faces' in card && card.card_faces?.[0]) {
		const frontFace = card.card_faces[0];
		if ('oracle_id' in frontFace && typeof frontFace.oracle_id === 'string') {
			return frontFace.oracle_id;
		}
	}

	return null;
}

export interface ScryfallLookupResult {
	results: Map<string, ScryfallCardData>;
	/** Human-readable descriptions of any batches that failed to fetch or parse. */
	errors: string[];
}

/**
 * Batch lookup Scryfall data for a list of cards.
 * Returns both the results map AND any errors encountered — callers decide
 * whether errors are fatal or just warnings. Never swallows failures silently.
 */
export async function batchLookupScryfallIds(
	cards: Array<{ name: string; setCode: string | null }>,
	options: { suppressNotFoundErrors?: boolean; stopOnError?: boolean } = {},
): Promise<ScryfallLookupResult> {
	const results = new Map<string, ScryfallCardData>();
	const errors: string[] = [];

	if (cards.length === 0) {
		return { results, errors };
	}

	// Deduplicate cards by name+set combination
	const uniqueCards = new Map<string, CardIdentifier>();
	for (const card of cards) {
		const trimmedName = card.name.trim();
		if (!trimmedName) {
			continue;
		}

		const key = createCardKey(trimmedName, card.setCode);
		if (!uniqueCards.has(key)) {
			// Scryfall collection endpoint rejects "Front // Back" combined names —
			// strip to the front face so transform, modal_dfc, and split cards are found.
			const nameForScryfall = trimmedName.includes(' // ')
				? trimmedName.split(' // ')[0]!.trim()
				: trimmedName;
			const identifier: CardIdentifier = { name: nameForScryfall };
			if (card.setCode) {
				identifier.set = card.setCode;
			}
			uniqueCards.set(key, identifier);
		}
	}

	const identifiers = [...uniqueCards.values()];
	const totalBatches = Math.ceil(identifiers.length / COLLECTION_BATCH_SIZE);

	// Process in batches of 75 (Scryfall limit)
	for (let i = 0; i < identifiers.length; i += COLLECTION_BATCH_SIZE) {
		const batchIndex = Math.floor(i / COLLECTION_BATCH_SIZE) + 1;
		const batch = identifiers.slice(i, i + COLLECTION_BATCH_SIZE);

		try {
			const response = await fetchCardCollection(batch);

			// Map results back to card keys
			for (const card of response.data) {
				// Color identity — join WUBRG codes into a single string.
				// Use 'in' guard because ScryfallCard.Any is a wide union.
				const cardData = mapScryfallCardData(card);

				const key = createCardKey(card.name, card.set);
				results.set(key, cardData);

				// Also set without set code for fallback lookups
				const nameOnlyKey = createCardKey(card.name, null);
				if (!results.has(nameOnlyKey)) {
					results.set(nameOnlyKey, cardData);
				}

				// For double-faced cards (MDFCs, transform, etc.), Scryfall returns
				// the full name "Front // Back" but Melee may provide only a single
				// face name. Store each face name as an additional lookup key so the
				// card can be resolved regardless of which name format was provided.
				if (card.name.includes(' // ')) {
					for (const faceName of card.name.split(' // ')) {
						const faceKey = createCardKey(faceName, card.set);
						if (!results.has(faceKey)) {
							results.set(faceKey, cardData);
						}
						const faceNameOnlyKey = createCardKey(faceName, null);
						if (!results.has(faceNameOnlyKey)) {
							results.set(faceNameOnlyKey, cardData);
						}
					}
				}
			}

			// Warn about cards Scryfall could not find (bad name, wrong set, etc.)
			if (response.not_found.length > 0) {
				const names = response.not_found.map((c: CardIdentifier) => c.name).join(', ');
				const msg = `Scryfall batch ${batchIndex}/${totalBatches}: ${response.not_found.length} card(s) not found — ${names}`;
				console.warn(JSON.stringify({
					service: 'scryfall',
					event: 'cards_not_found',
					batch: batchIndex,
					totalBatches,
					count: response.not_found.length,
				}));
				if (!options.suppressNotFoundErrors) {
					errors.push(msg);
				}
			}

			// Add a small delay between batches to respect rate limits
			if (i + COLLECTION_BATCH_SIZE < identifiers.length) {
				await new Promise(resolve => setTimeout(resolve, 100));
			}
		}
		catch (error) {
			const status = error instanceof ScryfallRequestError ? error.status : null;
			const reason = error instanceof ScryfallRequestError
				? `provider request failed${status === null ? '' : ` (HTTP ${status})`}`
				: 'provider returned an invalid response';
			const errorMsg = `Scryfall batch ${batchIndex}/${totalBatches} failed: ${reason}`;
			console.error(JSON.stringify({
				service: 'scryfall',
				event: 'batch_failed',
				batch: batchIndex,
				totalBatches,
				status,
			}));
			errors.push(errorMsg);
			// Authoritative imports abort on the first provider failure so an outage
			// cannot fan out into hundreds of doomed retries. Best-effort callers may
			// still opt into partial results by leaving stopOnError disabled.
			if (options.stopOnError)
				break;
		}
	}

	return { results, errors };
}

/**
 * Get Scryfall card data for a single card from the lookup map
 * Tries with set code first, then falls back to name only
 */
export function getCardDataFromMap(
	map: Map<string, ScryfallCardData>,
	name: string,
	setCode: string | null,
): ScryfallCardData | null {
	// Try with set code first
	if (setCode) {
		const keyWithSet = createCardKey(name, setCode);
		const dataWithSet = map.get(keyWithSet);
		if (dataWithSet) {
			return dataWithSet;
		}
	}

	// Fall back to name only
	const keyNameOnly = createCardKey(name, null);
	return map.get(keyNameOnly) ?? null;
}
