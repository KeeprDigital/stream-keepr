import type { z } from 'zod';
import type {
	MeleeEventParsed,
	MeleeMatchParsed,
	MeleePlayerParsed,
	MeleeStandingParsed,
} from '~~/server/schemas/external/melee';
import type { MeleeEndpoint, MeleeServiceOptions } from '~~/server/services/meleeTransport';
import { mapMeleePlayersToDb } from '~~/server/mappers/melee';
import {
	meleeApiResponseSchema,
	meleeEventSchema,
	meleeMatchSchema,
	meleePlayerSchema,
	meleeStandingSchema,
} from '~~/server/schemas/external/melee';
import { createMeleeTransport, MeleeTransportError } from '~~/server/services/meleeTransport';

export type { MeleeServiceOptions } from '~~/server/services/meleeTransport';

const API_URL = 'https://www.melee.gg/api';
const MAX_PAGES = 100;
const DEFAULT_MAX_COLLECTION_ITEMS = 10_000;
const MAX_COLLECTION_ITEMS = 20_000;
// fetchCoreSnapshot reads Players and Standings concurrently and then maps a
// second representation of Players. Keep each retained collection well below
// the Worker's 128 MiB isolate ceiling so two valid responses cannot exhaust it.
const DEFAULT_MAX_COLLECTION_BYTES = 8 * 1024 * 1024;
const MAX_COLLECTION_BYTES = 16 * 1024 * 1024;

function boundedInteger(
	name: string,
	value: number | undefined,
	fallback: number,
	minimum: number,
	maximum: number,
): number {
	const resolved = value ?? fallback;
	if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum)
		throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
	return resolved;
}

interface MeleeCredentials {
	clientId: string;
	clientSecret: string;
	eventId: string;
}

export function meleeService(credentials: MeleeCredentials, options: MeleeServiceOptions = {}) {
	const { fetchValidated: fetchWithAuth } = createMeleeTransport(credentials, options);
	const encodedEventId = encodeURIComponent(credentials.eventId);
	const maxCollectionItems = boundedInteger(
		'maxCollectionItems',
		options.maxCollectionItems,
		DEFAULT_MAX_COLLECTION_ITEMS,
		1,
		MAX_COLLECTION_ITEMS,
	);
	const maxCollectionBytes = boundedInteger(
		'maxCollectionBytes',
		options.maxCollectionBytes,
		DEFAULT_MAX_COLLECTION_BYTES,
		1_024,
		MAX_COLLECTION_BYTES,
	);

	/** Fetches all pages of a paginated endpoint, validating each page. */
	const fetchAllPages = async <S extends z.ZodTypeAny>(
		baseUrl: string,
		itemSchema: S,
		endpoint: MeleeEndpoint,
		pageSize: number = 100,
	): Promise<Array<z.infer<S>>> => {
		const allItems: Array<z.infer<S>> = [];
		let page = 1;
		let hasMore = true;
		let accumulatedBytes = 0;
		let expectedRecordsFiltered: number | null = null;
		let expectedRecordsTotal: number | null = null;
		const pageSchema = meleeApiResponseSchema(itemSchema);
		const paginationError = (reason: string): never => {
			throw new MeleeTransportError(
				`Melee.gg API pagination was inconsistent for ${endpoint}: ${reason}`,
				'schema_validation',
			);
		};

		while (hasMore && page <= MAX_PAGES) {
			const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}page=${page}&pageSize=${pageSize}`;
			const response = await fetchWithAuth(url, pageSchema, { endpoint, page });
			if (response.Page !== page)
				paginationError('unexpected page number');
			if (response.PageSize !== pageSize)
				paginationError('unexpected page size');
			if (response.RecordsFiltered > response.RecordsTotal)
				paginationError('filtered record count exceeded total record count');

			expectedRecordsFiltered ??= response.RecordsFiltered;
			expectedRecordsTotal ??= response.RecordsTotal;
			if (
				response.RecordsFiltered !== expectedRecordsFiltered
				|| response.RecordsTotal !== expectedRecordsTotal
			) {
				paginationError('record counts changed between pages');
			}
			if (response.HasMore && response.Content.length === 0)
				paginationError('an empty page claimed more records');

			const nextItemCount = allItems.length + response.Content.length;
			if (nextItemCount > response.RecordsFiltered)
				paginationError('received more records than declared');
			if (nextItemCount > maxCollectionItems) {
				throw new MeleeTransportError(
					`Melee.gg API collection exceeded ${maxCollectionItems} items for ${endpoint}`,
					'response_size',
				);
			}
			accumulatedBytes += new TextEncoder().encode(JSON.stringify(response.Content)).byteLength;
			if (accumulatedBytes > maxCollectionBytes) {
				throw new MeleeTransportError(
					`Melee.gg API collection exceeded the configured size limit for ${endpoint}`,
					'response_size',
				);
			}
			allItems.push(...response.Content);
			hasMore = response.HasMore;
			if (hasMore && allItems.length >= response.RecordsFiltered)
				paginationError('more pages were declared after all records were received');
			if (!hasMore && allItems.length !== response.RecordsFiltered)
				paginationError('the final page did not contain every declared record');
			page++;
		}

		if (hasMore) {
			throw new MeleeTransportError(
				`Melee.gg API pagination exceeded ${MAX_PAGES} pages for ${endpoint}`,
				'schema_validation',
			);
		}

		return allItems;
	};

	// ── Tournament ──

	const fetchEvent = async (): Promise<MeleeEventParsed> => {
		return await fetchWithAuth(
			`${API_URL}/tournament/${encodedEventId}`,
			meleeEventSchema,
			{ endpoint: 'event' },
		);
	};

	// ── Players ──

	const fetchPlayers = async (): Promise<MeleePlayerParsed[]> => {
		return await fetchAllPages(
			`${API_URL}/player/list/${encodedEventId}`,
			meleePlayerSchema,
			'players',
		);
	};

	// ── Standings ──

	/** Fetches the current/final standings for the event. */
	const fetchCurrentStandings = async (): Promise<MeleeStandingParsed[]> => {
		return await fetchAllPages(
			`${API_URL}/standing/list/current/${encodedEventId}`,
			meleeStandingSchema,
			'current_standings',
		);
	};

	/** Fetches standings as of a specific round (by Melee round ID). */
	const fetchStandingsByRound = async (roundId: number): Promise<MeleeStandingParsed[]> => {
		return await fetchAllPages(
			`${API_URL}/standing/list/round/${roundId}`,
			meleeStandingSchema,
			'round_standings',
		);
	};

	// ── Matches ──

	const fetchMatchesByRound = async (roundId: number): Promise<MeleeMatchParsed[]> => {
		return await fetchAllPages(
			`${API_URL}/match/list/round/${roundId}`,
			meleeMatchSchema,
			'round_matches',
		);
	};

	// ── Composite ──

	const fetchMergedPlayers = async () => {
		const [players, standings] = await Promise.all([
			fetchPlayers(),
			fetchCurrentStandings(),
		]);

		return mapMeleePlayersToDb(players, standings);
	};

	return {
		fetchEvent,
		fetchPlayers,
		fetchCurrentStandings,
		fetchStandingsByRound,
		fetchMatchesByRound,
		fetchMergedPlayers,
	};
}
