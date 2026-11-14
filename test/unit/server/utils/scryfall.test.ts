import type { ScryfallCardData } from '~~/server/utils/scryfall';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	batchLookupScryfallIds,
	batchLookupScryfallPrintings,
	fetchScryfallCardById,
	fetchScryfallCardByName,
	getCardDataFromMap,
} from '~~/server/utils/scryfall';
import { createScryfallFake, FACE_NAME_COLLISIONS } from '~~/test/helpers/scryfallFake';

vi.stubGlobal('fetch', vi.fn());

// ──────────────── Helpers ────────────────

function createScryfallResponse(cards: Array<{
	id: string;
	name: string;
	set: string;
	oracle_id?: string;
	mana_cost?: string;
	cmc?: number;
	color_identity?: string[];
	type_line?: string;
	card_faces?: Array<{ mana_cost?: string; [key: string]: unknown }>;
}>, notFound: Array<{ name: string }> = []) {
	return {
		ok: true,
		json: () => Promise.resolve({
			object: 'list',
			not_found: notFound,
			data: cards.map((c) => {
				const card: Record<string, unknown> = {
					id: c.id,
					name: c.name,
					set: c.set,
					set_name: c.set,
					mana_cost: c.mana_cost ?? null,
				};
				if (c.cmc !== undefined)
					card.cmc = c.cmc;
				if (c.oracle_id !== undefined)
					card.oracle_id = c.oracle_id;
				if (c.color_identity !== undefined)
					card.color_identity = c.color_identity;
				if (c.type_line !== undefined)
					card.type_line = c.type_line;
				if (c.card_faces !== undefined)
					card.card_faces = c.card_faces;
				return card;
			}),
		}),
	};
}

function createScryfallErrorResponse(status: number, body: string) {
	return {
		ok: false,
		status,
		statusText: '',
		text: () => Promise.resolve(body),
	};
}

// ──────────────── getCardDataFromMap ────────────────

function cardData(overrides: Partial<ScryfallCardData> = {}): ScryfallCardData {
	return {
		name: 'Lightning Bolt',
		setCode: 'm21',
		collectorNumber: '1',
		id: 'abc',
		oracleId: null,
		manaCost: '{R}',
		cmc: 1,
		colors: 'R',
		typeLine: 'Instant',
		deckCounterTypes: [],
		deckTokens: [],
		...overrides,
	};
}

describe('getCardDataFromMap', () => {
	it('returns card data matching name+set key', () => {
		const map = new Map<string, ScryfallCardData>();
		const bolt = cardData();
		map.set('lightning bolt|m21', bolt);
		const result = getCardDataFromMap(map, 'Lightning Bolt', 'm21');
		expect(result).toEqual(bolt);
	});

	it('uses name-only lookup when setCode is null', () => {
		const map = new Map<string, ScryfallCardData>();
		const shock = cardData({ name: 'Shock', id: 'def' });
		map.set('shock', shock);
		const result = getCardDataFromMap(map, 'Shock', null);
		expect(result).toEqual(shock);
	});
});

// ──────────────── batchLookupScryfallPrintings ────────────────

describe('batchLookupScryfallPrintings', () => {
	beforeEach(() => {
		vi.mocked(fetch).mockReset();
	});

	// A Moxfield paste names about a hundred printings: two requests, not a hundred.
	it('asks for exact printings by set and collector number, 75 to a request, and answers each in the order asked', async () => {
		const catalogue = Array.from({ length: 80 }, (_, index) => ({
			id: `printing-${index}`,
			name: `Card ${index}`,
			set: 'ecl',
			collector_number: String(index + 1),
		}));
		vi.mocked(fetch).mockImplementation(createScryfallFake(catalogue).fetch);

		const cards = await batchLookupScryfallPrintings(catalogue.toReversed().map(card => ({
			setCode: card.set,
			collectorNumber: card.collector_number,
		})));

		expect(fetch).toHaveBeenCalledTimes(2);
		const firstBatch = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
		expect(firstBatch.identifiers).toHaveLength(75);
		expect(firstBatch.identifiers[0]).toEqual({ set: 'ecl', collector_number: '80' });
		expect(cards.map(card => card?.id)).toEqual(catalogue.toReversed().map(card => card.id));
	});

	it('answers a printing by its set, in either case, and its collector number, and none for one Scryfall does not know', async () => {
		vi.mocked(fetch).mockImplementation(createScryfallFake([
			{
				id: 'garruks-uprising',
				name: 'Garruk\'s Uprising',
				set: 'plst',
				collector_number: 'M21-186',
			},
		]).fetch);

		const cards = await batchLookupScryfallPrintings([
			{ setCode: 'ECL', collectorNumber: '9999' },
			{ setCode: 'PLST', collectorNumber: 'M21-186' },
		]);

		expect(cards).toEqual([
			null,
			expect.objectContaining({ id: 'garruks-uprising', setCode: 'plst', collectorNumber: 'M21-186' }),
		]);
	});

	it('throws when a request fails, so an outage is never read as a printing that does not exist', async () => {
		vi.useFakeTimers();
		vi.mocked(fetch).mockResolvedValue(createScryfallErrorResponse(503, 'private upstream detail') as any);

		try {
			const lookup = batchLookupScryfallPrintings([
				{ setCode: 'ecl', collectorNumber: '1' },
			]).catch(error => error);
			await vi.runAllTimersAsync();

			expect(await lookup).toMatchObject({ name: 'ScryfallRequestError', retryable: true });
		}
		finally {
			vi.useRealTimers();
		}
	});
});

// ──────────────── batchLookupScryfallIds ────────────────

describe('batchLookupScryfallIds', () => {
	beforeEach(() => {
		vi.mocked(fetch).mockReset();
	});

	it('deduplicates cards by name+set', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'abc', name: 'Lightning Bolt', set: 'm21' },
			]) as any,
		);

		await batchLookupScryfallIds([
			{ name: 'Lightning Bolt', setCode: 'm21' },
			{ name: 'Lightning Bolt', setCode: 'm21' },
		]);

		const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
		expect(body.identifiers).toHaveLength(1);
	});

	it('batches in groups of 75', async () => {
		vi.mocked(fetch).mockImplementation(createScryfallFake([]).fetch);

		const cards = Array.from({ length: 80 }, (_, i) => ({
			name: `Card ${i}`,
			setCode: null,
		}));

		await batchLookupScryfallIds(cards);
		expect(fetch).toHaveBeenCalledTimes(2);

		const firstBatch = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
		const secondBatch = JSON.parse(vi.mocked(fetch).mock.calls[1]![1]!.body as string);
		expect(firstBatch.identifiers).toHaveLength(75);
		expect(secondBatch.identifiers).toHaveLength(5);
	});

	it('maps each card under both its name+set and name-only keys', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{
					id: 'abc',
					name: 'Detention Sphere',
					set: 'rtr',
					oracle_id: 'oracle-1',
					mana_cost: '{1}{W}{U}',
					cmc: 3,
					color_identity: ['W', 'U'],
					type_line: 'Enchantment',
				},
				{ id: 'def', name: 'Plains', set: 'm21' },
			]) as any,
		);

		const result = await batchLookupScryfallIds([
			{ name: 'Detention Sphere', setCode: 'rtr' },
			{ name: 'Plains', setCode: 'm21' },
		]);

		const sphere = {
			id: 'abc',
			oracleId: 'oracle-1',
			manaCost: '{1}{W}{U}',
			cmc: 3,
			colors: 'WU',
			typeLine: 'Enchantment',
		};
		expect(result.results.get('detention sphere|rtr')).toMatchObject(sphere);
		expect(result.results.get('detention sphere')).toMatchObject(sphere);
		expect(result.results.get('plains|m21')?.cmc).toBeNull();
		expect(result.errors).toHaveLength(0);
	});

	it('sends POST request with correct body', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'abc', name: 'Shock', set: 'm21' },
			]) as any,
		);

		await batchLookupScryfallIds([
			{ name: 'Shock', setCode: 'm21' },
		]);

		expect(fetch).toHaveBeenCalledWith(
			'https://api.scryfall.com/cards/collection',
			expect.objectContaining({
				method: 'POST',
				headers: {
					'Accept': 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': 'stream-keepr/1.0',
				},
				body: JSON.stringify({
					identifiers: [
						{ name: 'Shock', set: 'm21' },
					],
				}),
			}),
		);
	});

	it('strips " // back" from DFC/split names sent to Scryfall collection endpoint', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'ajani-1', name: 'Ajani, Nacatl Pariah // Ajani, Nacatl Avenger', set: 'mh3' },
			]) as any,
		);

		await batchLookupScryfallIds([
			{ name: 'Ajani, Nacatl Pariah // Ajani, Nacatl Avenger', setCode: 'mh3' },
		]);

		const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
		// Only the front face name should be sent — Scryfall rejects combined names
		expect(body.identifiers[0].name).toBe('Ajani, Nacatl Pariah');
	});

	it('skips blank card names before sending collection identifiers', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'abc', name: 'Shock', set: 'm21' },
			]) as any,
		);

		await batchLookupScryfallIds([
			{ name: '   ', setCode: null },
			{ name: 'Shock', setCode: 'm21' },
		]);

		const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string);
		expect(body.identifiers).toEqual([
			{ name: 'Shock', set: 'm21' },
		]);
	});

	it('includes status without retaining the untrusted response body when Scryfall rejects a batch', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallErrorResponse(422, '{"details":"Identifiers are invalid"}') as any,
		);

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await batchLookupScryfallIds([
			{ name: 'Shock', setCode: 'm21' },
		]);

		expect(result.errors[0]).toContain('HTTP 422');
		expect(result.errors[0]).not.toContain('Identifiers are invalid');

		consoleSpy.mockRestore();
	});

	it('retries a transient upstream failure before returning data', async () => {
		vi.mocked(fetch)
			.mockResolvedValueOnce(createScryfallErrorResponse(503, 'temporarily unavailable') as any)
			.mockResolvedValueOnce(createScryfallResponse([
				{ id: 'abc', name: 'Shock', set: 'm21' },
			]) as any);

		const result = await batchLookupScryfallIds([
			{ name: 'Shock', setCode: 'm21' },
		]);

		expect(result.results.get('shock|m21')?.id).toBe('abc');
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('excludes upstream response details from errors and logs', async () => {
		vi.mocked(fetch).mockResolvedValue(createScryfallErrorResponse(422, 'x'.repeat(10_000)) as any);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await batchLookupScryfallIds([
			{ name: 'Shock', setCode: 'm21' },
		]);

		expect(result.errors[0]).not.toContain('xxx');
		expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('xxx');
		consoleSpy.mockRestore();
	});

	it('can stop an authoritative import after its first failed batch', async () => {
		vi.mocked(fetch).mockResolvedValue(createScryfallErrorResponse(503, 'unavailable') as any);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const cards = Array.from({ length: 80 }, (_, index) => ({
			name: `Card ${index}`,
			setCode: null,
		}));

		const result = await batchLookupScryfallIds(cards, { stopOnError: true });

		expect(result.errors).toHaveLength(1);
		// One batch with the configured two retries; the second batch is never sent.
		expect(fetch).toHaveBeenCalledTimes(3);
		consoleSpy.mockRestore();
	});

	it('validates individual named-card responses at the external boundary', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ name: 'Missing required identifiers' }),
		} as any);

		await expect(fetchScryfallCardByName({ exact: 'Shock' })).rejects.toMatchObject({
			name: 'ScryfallRequestError',
			code: 'SCRYFALL_UPSTREAM_FAILURE',
			notFound: false,
		});
	});

	it('wraps invalid collection schemas as an upstream failure', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({
				object: 'list',
				not_found: [],
				data: [
					{ name: 'missing identifiers' },
				],
			}),
		} as any);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await batchLookupScryfallIds([
			{ name: 'Shock', setCode: 'm21' },
		]);

		expect(result.results.size).toBe(0);
		expect(result.errors).toEqual([
			expect.stringContaining('provider request failed'),
		]);
		expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain('missing identifiers');
		consoleSpy.mockRestore();
	});

	it('encodes card IDs as one URL path segment', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ id: 'card-id', name: 'Shock', set: 'm21' }),
		} as any);

		await expect(fetchScryfallCardById('../named?fuzzy=secret')).resolves.toMatchObject({ id: 'card-id' });

		expect(fetch).toHaveBeenCalledWith(
			'https://api.scryfall.com/cards/..%2Fnamed%3Ffuzzy%3Dsecret',
			expect.any(Object),
		);
	});

	it('stops oversized successful card responses while streaming the body', async () => {
		vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
			id: 'abc',
			name: 'Shock',
			set: 'm21',
			padding: 'x'.repeat(1024 * 1024),
		}), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));

		await expect(fetchScryfallCardByName({ exact: 'Shock' })).rejects.toThrow('configured size limit');
		expect(fetch).toHaveBeenCalledOnce();
	});

	it('split card: extracts front face mana_cost from card_faces when top-level is combined', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{
					id: 'fire-ice-1',
					name: 'Fire // Ice',
					set: 'ema',
					mana_cost: '{1}{R} // {1}{U}',
					cmc: 4,
					color_identity: ['R', 'U'],
					card_faces: [
						{ mana_cost: '{1}{R}' },
						{ mana_cost: '{1}{U}' },
					],
				},
			]) as any,
		);

		const result = await batchLookupScryfallIds([
			{ name: 'Fire', setCode: 'ema' },
		]);

		// Should use front face cost, not the combined "{1}{R} // {1}{U}"
		expect(result.results.get('fire // ice|ema')?.manaCost).toBe('{1}{R}');
	});

	it('adventure card: extracts creature face mana_cost from card_faces when top-level is combined', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{
					id: 'bonecrusher-1',
					name: 'Bonecrusher Giant // Stomp',
					set: 'eld',
					mana_cost: '{2}{R} // {1}{R}',
					cmc: 3,
					color_identity: ['R'],
					card_faces: [
						{ mana_cost: '{2}{R}' },
						{ mana_cost: '{1}{R}' },
					],
				},
			]) as any,
		);

		const result = await batchLookupScryfallIds([
			{ name: 'Bonecrusher Giant', setCode: 'eld' },
		]);

		// Should use creature face cost, not the combined "{2}{R} // {1}{R}"
		expect(result.results.get('bonecrusher giant // stomp|eld')?.manaCost).toBe('{2}{R}');
	});

	it('transform card: extracts front face mana_cost from card_faces when top-level is absent', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({
				object: 'list',
				not_found: [],
				data: [
					{
						id: 'ajani-1',
						name: 'Ajani, Nacatl Pariah // Ajani, Nacatl Avenger',
						set: 'mh3',
						// No top-level mana_cost — transform layout
						cmc: 2,
						color_identity: ['R', 'W'],
						card_faces: [
							{ mana_cost: '{1}{W}' },
							{ mana_cost: '' }, // back face — planeswalker, no casting cost
						],
					},
				],
			}),
		} as any);

		const result = await batchLookupScryfallIds([
			{ name: 'Ajani, Nacatl Pariah // Ajani, Nacatl Avenger', setCode: 'mh3' },
		]);

		const key = 'ajani, nacatl pariah // ajani, nacatl avenger|mh3';
		expect(result.results.get(key)?.manaCost).toBe('{1}{W}');
		expect(result.results.get(key)?.cmc).toBe(2);
	});

	it('adds not_found cards to errors with card names', async () => {
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse(
				[
					{ id: 'abc', name: 'Shock', set: 'm21' },
				],
				[
					{ name: 'Fake Card Name' },
				],
			) as any,
		);

		const result = await batchLookupScryfallIds([
			{ name: 'Shock', setCode: 'm21' },
			{ name: 'Fake Card Name', setCode: null },
		]);

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('not found');
		expect(result.errors[0]).toContain('Fake Card Name');
		expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify({
			service: 'scryfall',
			event: 'cards_not_found',
			batch: 1,
			totalBatches: 1,
			count: 1,
		}));
		expect(consoleSpy.mock.calls.flat().join(' ')).not.toContain('Fake Card Name');

		consoleSpy.mockRestore();
	});

	it('double-faced card extracts cmc, color_identity, type_line from top-level fields', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{
					id: 'dfc-1',
					name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
					set: 'neo',
					cmc: 3,
					color_identity: ['R'],
					type_line: 'Enchantment // Enchantment Creature — Reflection',
				},
			]) as any,
		);

		const result = await batchLookupScryfallIds([
			{ name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', setCode: 'neo' },
		]);

		const key = 'fable of the mirror-breaker // reflection of kiki-jiki|neo';
		expect(result.results.get(key)?.cmc).toBe(3);
		expect(result.results.get(key)?.colors).toBe('R');
		expect(result.results.get(key)?.typeLine).toBe('Enchantment // Enchantment Creature — Reflection');
	});
});

describe('batchLookupScryfallIds when a card\'s name is another card\'s face', () => {
	const { schemingSilvertongue, signInBlood, emeritusOfConflict, lightningBolt, bindLiberate, bind, delverOfSecrets } = FACE_NAME_COLLISIONS;
	const filler = Array.from({ length: 74 }, (_, index) => ({ name: `Unknown Card ${index}`, setCode: null }));
	const named = (name: string, setCode: string | null = null) => ({ name, setCode });

	// A name answers with the card of exactly that name, whatever order Scryfall saw them in.
	it.each([
		{
			requested: [
				named('Scheming Silvertongue // Sign in Blood'),
				named('Sign in Blood'),
			],
			answers: [schemingSilvertongue, signInBlood],
		},
		{
			requested: [
				named('Sign in Blood'),
				named('Scheming Silvertongue // Sign in Blood'),
			],
			answers: [signInBlood, schemingSilvertongue],
		},
		{
			requested: [
				named('Emeritus of Conflict'),
				named('Lightning Bolt'),
			],
			answers: [emeritusOfConflict, lightningBolt],
		},
		{
			requested: [
				named('Emeritus of Conflict // Lightning Bolt'),
				named('Lightning Bolt'),
				named('Lightning Bolt', 'msc'),
			],
			answers: [emeritusOfConflict, lightningBolt, lightningBolt],
		},
		{
			requested: [
				named('Bind // Liberate'),
				named('Bind'),
			],
			answers: [bindLiberate, bind],
		},
		{
			requested: [
				named('Delver of Secrets'),
				named('Insectile Aberration'),
				named('Delver of Secrets', 'inr'),
			],
			answers: [delverOfSecrets, delverOfSecrets, delverOfSecrets],
		},
	])('answers $requested with their own cards', async ({ requested, answers }) => {
		vi.mocked(fetch).mockImplementation(createScryfallFake(Object.values(FACE_NAME_COLLISIONS)).fetch);

		const { results, errors } = await batchLookupScryfallIds(requested, { suppressNotFoundErrors: true });

		expect(requested.map(request => getCardDataFromMap(results, request.name, request.setCode)?.name)).toEqual(answers.map(card => card.name));
		expect(errors).toEqual([]);
	});

	it('answers a standalone name with its own card when the two-faced card came back in an earlier batch', async () => {
		const scryfall = createScryfallFake(Object.values(FACE_NAME_COLLISIONS));
		vi.mocked(fetch).mockImplementation(scryfall.fetch);

		const { results } = await batchLookupScryfallIds([
			{ name: 'Scheming Silvertongue // Sign in Blood', setCode: null },
			...filler,
			{ name: 'Sign in Blood', setCode: null },
		], { suppressNotFoundErrors: true });

		expect(scryfall.collectionBatches.map(batch => batch.at(-1))).toEqual(['Unknown Card 73', 'Sign in Blood']);
		expect(getCardDataFromMap(results, 'Sign in Blood', null)?.name).toBe('Sign in Blood');
	});

	// Each lookup alone is one more Scryfall request, so only a name the batch
	// answered with another card's name pays for one.
	it('looks a name up alone only when the batch answered it with a card of another name', async () => {
		const scryfall = createScryfallFake(Object.values(FACE_NAME_COLLISIONS));
		vi.mocked(fetch).mockImplementation(scryfall.fetch);

		await batchLookupScryfallIds([
			{ name: 'Scheming Silvertongue // Sign in Blood', setCode: null },
			{ name: 'Sign in Blood', setCode: null },
			{ name: 'Unknown Card', setCode: null },
		], { suppressNotFoundErrors: true });

		expect(scryfall.namedLookups).toEqual(['Sign in Blood']);
	});
});
