import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	batchLookupScryfallIds,
	fetchScryfallCardById,
	fetchScryfallCardByName,
	getCardDataFromMap,
} from '~~/server/utils/scryfall';

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

describe('getCardDataFromMap', () => {
	it('returns card data matching name+set key', () => {
		const map = new Map<string, { id: string; manaCost: string | null }>();
		map.set('lightning bolt|m21', { id: 'abc', manaCost: '{R}' });
		const result = getCardDataFromMap(map, 'Lightning Bolt', 'm21');
		expect(result).toEqual({ id: 'abc', manaCost: '{R}' });
	});

	it('uses name-only lookup when setCode is null', () => {
		const map = new Map<string, { id: string; manaCost: string | null }>();
		map.set('shock', { id: 'def', manaCost: '{R}' });
		const result = getCardDataFromMap(map, 'Shock', null);
		expect(result).toEqual({ id: 'def', manaCost: '{R}' });
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
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([]) as any,
		);

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

	it('stores results with both name+set and name-only keys', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'abc', name: 'Lightning Bolt', set: 'm21', oracle_id: 'oracle-1', mana_cost: '{R}' },
			]) as any,
		);

		const result = await batchLookupScryfallIds([
			{ name: 'Lightning Bolt', setCode: 'm21' },
		]);

		expect(result.results.get('lightning bolt|m21')).toMatchObject({ id: 'abc', oracleId: 'oracle-1', manaCost: '{R}' });
		expect(result.results.get('lightning bolt')).toMatchObject({ id: 'abc', oracleId: 'oracle-1', manaCost: '{R}' });
		expect(result.errors).toHaveLength(0);
	});

	it('extracts oracle_id fields', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'abc', name: 'Time Vault', set: 'lea', oracle_id: 'oracle-time-vault' },
			]) as any,
		);

		const result = await batchLookupScryfallIds([{ name: 'Time Vault', setCode: 'lea' }]);

		expect(result.results.get('time vault|lea')?.oracleId).toBe('oracle-time-vault');
	});

	it('handles double-faced card names by splitting on " // "', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'dfc-1', name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', set: 'neo' },
			]) as any,
		);

		const result = await batchLookupScryfallIds([
			{ name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki', setCode: 'neo' },
		]);

		// Full name keys
		expect(result.results.has('fable of the mirror-breaker // reflection of kiki-jiki|neo')).toBe(true);
		// Individual face keys
		expect(result.results.has('fable of the mirror-breaker|neo')).toBe(true);
		expect(result.results.has('reflection of kiki-jiki|neo')).toBe(true);
		// Name-only keys
		expect(result.results.has('fable of the mirror-breaker')).toBe(true);
		expect(result.results.has('reflection of kiki-jiki')).toBe(true);
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
					identifiers: [{ name: 'Shock', set: 'm21' }],
				}),
			}),
		);
	});

	it('cmc is extracted from response', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'abc', name: 'Lightning Bolt', set: 'm21', cmc: 1 },
			]) as any,
		);

		const result = await batchLookupScryfallIds([{ name: 'Lightning Bolt', setCode: 'm21' }]);

		expect(result.results.get('lightning bolt|m21')?.cmc).toBe(1);
	});

	it('color_identity joined to colors string', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'abc', name: 'Detention Sphere', set: 'rtr', color_identity: ['W', 'U'] },
			]) as any,
		);

		const result = await batchLookupScryfallIds([{ name: 'Detention Sphere', setCode: 'rtr' }]);

		expect(result.results.get('detention sphere|rtr')?.colors).toBe('WU');
	});

	it('type_line extracted to typeLine', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'abc', name: 'Serra Angel', set: 'm21', type_line: 'Creature — Angel' },
			]) as any,
		);

		const result = await batchLookupScryfallIds([{ name: 'Serra Angel', setCode: 'm21' }]);

		expect(result.results.get('serra angel|m21')?.typeLine).toBe('Creature — Angel');
	});

	it('card with no cmc in response has cmc=null', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([
				{ id: 'abc', name: 'Plains', set: 'm21' },
			]) as any,
		);

		const result = await batchLookupScryfallIds([{ name: 'Plains', setCode: 'm21' }]);

		expect(result.results.get('plains|m21')?.cmc).toBeNull();
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
		expect(body.identifiers).toEqual([{ name: 'Shock', set: 'm21' }]);
	});

	it('includes status without retaining the untrusted response body when Scryfall rejects a batch', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallErrorResponse(422, '{"details":"Identifiers are invalid"}') as any,
		);

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await batchLookupScryfallIds([{ name: 'Shock', setCode: 'm21' }]);

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

		const result = await batchLookupScryfallIds([{ name: 'Shock', setCode: 'm21' }]);

		expect(result.results.get('shock|m21')?.id).toBe('abc');
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('excludes upstream response details from errors and logs', async () => {
		vi.mocked(fetch).mockResolvedValue(createScryfallErrorResponse(422, 'x'.repeat(10_000)) as any);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await batchLookupScryfallIds([{ name: 'Shock', setCode: 'm21' }]);

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
			json: () => Promise.resolve({ object: 'list', not_found: [], data: [{ name: 'missing identifiers' }] }),
		} as any);
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await batchLookupScryfallIds([{ name: 'Shock', setCode: 'm21' }]);

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
			createScryfallResponse([{
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
			}]) as any,
		);

		const result = await batchLookupScryfallIds([{ name: 'Fire', setCode: 'ema' }]);

		// Should use front face cost, not the combined "{1}{R} // {1}{U}"
		expect(result.results.get('fire // ice|ema')?.manaCost).toBe('{1}{R}');
	});

	it('adventure card: extracts creature face mana_cost from card_faces when top-level is combined', async () => {
		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse([{
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
			}]) as any,
		);

		const result = await batchLookupScryfallIds([{ name: 'Bonecrusher Giant', setCode: 'eld' }]);

		// Should use creature face cost, not the combined "{2}{R} // {1}{R}"
		expect(result.results.get('bonecrusher giant // stomp|eld')?.manaCost).toBe('{2}{R}');
	});

	it('transform card: extracts front face mana_cost from card_faces when top-level is absent', async () => {
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({
				object: 'list',
				not_found: [],
				data: [{
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
				}],
			}),
		} as any);

		const result = await batchLookupScryfallIds([{ name: 'Ajani, Nacatl Pariah', setCode: 'mh3' }]);

		expect(result.results.get('ajani, nacatl pariah|mh3')?.manaCost).toBe('{1}{W}');
		expect(result.results.get('ajani, nacatl pariah|mh3')?.cmc).toBe(2);
	});

	it('adds not_found cards to errors with card names', async () => {
		const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

		vi.mocked(fetch).mockResolvedValue(
			createScryfallResponse(
				[{ id: 'abc', name: 'Shock', set: 'm21' }],
				[{ name: 'Fake Card Name' }],
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
			createScryfallResponse([{
				id: 'dfc-1',
				name: 'Fable of the Mirror-Breaker // Reflection of Kiki-Jiki',
				set: 'neo',
				cmc: 3,
				color_identity: ['R'],
				type_line: 'Enchantment // Enchantment Creature — Reflection',
			}]) as any,
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
