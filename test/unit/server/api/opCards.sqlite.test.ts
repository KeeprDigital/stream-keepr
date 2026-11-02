import type { H3Event } from 'h3';
import { drizzle } from 'drizzle-orm/d1';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '~~/server/db/schema';
import { stubH3Event } from '~~/test/helpers/h3Event';
import { createSqliteD1Harness } from '~~/test/helpers/sqlite-d1';

// bandai-keepr is faked at the network boundary: `fetch` and the Workers Cache API.

const harness = await createSqliteD1Harness();
const db = drizzle(harness.database, { schema });
vi.doMock('~~/server/db', () => ({ db }));

const API_URL = 'https://op-api.test';
const API_KEY = 'test-key';
const runtimeConfig = { bandaiKeeprApiKey: API_KEY, bandaiKeeprApiUrl: API_URL };
vi.stubGlobal('useRuntimeConfig', () => runtimeConfig);

interface StubEvent { params: Record<string, string>; query?: Record<string, string | string[]> }
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('getValidatedRouterParams', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.params));
vi.stubGlobal('getValidatedQuery', async (event: StubEvent, parse: (value: unknown) => unknown) => parse(event.query ?? {}));
vi.stubGlobal('createError', (input: { statusCode?: number; message?: string }) =>
	Object.assign(new Error(input.message ?? 'error'), input));

const zoro = {
	number: 'OP01-001',
	sourcePrintingId: 'OP01-001',
	name: 'Roronoa Zoro',
	category: 'leader',
	colors: ['Red'],
	cost: null,
	life: 5,
	power: 5000,
	counter: null,
	attributes: ['Slash'],
	types: ['Supernovas', 'Straw Hat Crew'],
	effect: '[DON!! x1] [Your Turn] All of your Characters gain +1000 power.',
	trigger: null,
	blockIcon: '1',
};
function printing(id: string, kind: string, setId = 'OP-01') {
	return {
		...zoro,
		id,
		cardNumber: zoro.number,
		setId,
		kind,
		rarity: 'L',
		sourceText: null,
		imageVersion: '1',
		imageUrl: `${API_URL}/elsewhere/${id}.png`,
	};
}
const zoroDetail = {
	...zoro,
	printings: [
		printing('OP01-001', 'standard'),
		printing('OP01-001_p1', 'alt-art'),
		printing('OP01-001_r1', 'reprint', 'EB-01'),
	],
};

const requests: Request[] = [];
let upstream: (request: Request) => Response = request => Response.json({ error: `unrouted ${request.url}` }, { status: 500 });
vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
	const request = new Request(input, init);
	requests.push(request);
	return upstream(request);
});

function bandaiKeepr(request: Request): Response {
	const url = new URL(request.url);
	if (url.pathname === '/cards') {
		return Response.json({
			items: [zoro],
			total: 1,
			limit: Number(url.searchParams.get('limit') ?? 50),
			offset: 0,
		});
	}
	if (url.pathname === '/cards/OP01-001')
		return Response.json(zoroDetail);
	return Response.json({ error: 'Card not found' }, { status: 404 });
}

/** A Workers Cache that honours the `max-age` a stored response carries, on the faked clock. */
const cached = new Map<string, { response: Response; expires: number }>();
vi.stubGlobal('caches', {
	open: async () => ({
		match: async (key: Request | string) => {
			const entry = cached.get(typeof key === 'string'
				? key
				: key.url);
			return entry && entry.expires > Date.now()
				? entry.response.clone()
				: undefined;
		},
		put: async (key: Request | string, response: Response) => {
			const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1] ?? 0);
			cached.set(typeof key === 'string'
				? key
				: key.url, {
				response: response.clone(),
				expires: Date.now() + maxAge * 1000,
			});
		},
	}),
});

type Handler = (event: H3Event) => Promise<unknown>;
const searchCards = (await import('~~/server/api/events/[id]/op-cards/index.get')).default as unknown as Handler;
const lookupCard = (await import('~~/server/api/events/[id]/op-cards/[number].get')).default as unknown as Handler;

let opEventId: number;
let mtgEventId: number;

function search(query: Record<string, string | string[]> = {}, eventId = opEventId) {
	return searchCards(stubH3Event({
		params: {
			id: String(eventId),
		},
		query,
	}));
}
function lookup(number: string, eventId = opEventId) {
	return lookupCard(stubH3Event({
		params: {
			id: String(eventId),
			number,
		},
	}));
}

beforeAll(async () => {
	const inserted = await db.insert(schema.events)
		.values([
			{ name: 'OP Regional', game: 'op', featureMatchOrientation: 'horizontal' },
			{ name: 'MTG Open', game: 'mtg', featureMatchOrientation: 'horizontal' },
		])
		.returning({ id: schema.events.id });
	opEventId = inserted[0]!.id;
	mtgEventId = inserted[1]!.id;
});

beforeEach(() => {
	vi.useRealTimers();
	runtimeConfig.bandaiKeeprApiKey = API_KEY;
	runtimeConfig.bandaiKeeprApiUrl = API_URL;
	upstream = bandaiKeepr;
	requests.length = 0;
	cached.clear();
});

afterAll(async () => {
	await harness.close();
});

describe('without bandai-keepr configured', () => {
	it.each([
		[
			'no API key',
			{ bandaiKeeprApiKey: '' },
		],
		[
			'no API URL',
			{ bandaiKeeprApiUrl: '' },
		],
		[
			'a blank API key',
			{ bandaiKeeprApiKey: '   ' },
		],
	])('with %s, search and lookup answer card data unavailable and call nothing', async (_case, config) => {
		Object.assign(runtimeConfig, config);

		await expect(search({ q: 'zoro' })).resolves.toEqual({ available: false });
		await expect(lookup('OP01-001')).resolves.toEqual({ available: false });
		expect(requests).toEqual([]);
	});
});

describe('searching cards', () => {
	it('forwards name or text, colour and category with the key, and images each Card by its Printing', async () => {
		const answer = await search({ q: 'zoro', color: 'Red', category: 'leader' });

		expect(answer).toEqual({
			available: true,
			total: 1,
			items: [
				expect.objectContaining({
					number: 'OP01-001',
					name: 'Roronoa Zoro',
					category: 'leader',
					colors: ['Red'],
					printingId: 'OP01-001',
					imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
				}),
			],
		});
		const [request] = requests;
		const url = new URL(request!.url);
		expect(`${url.origin}${url.pathname}`).toBe(`${API_URL}/cards`);
		expect(url.searchParams.get('q')).toBe('zoro');
		expect(url.searchParams.getAll('color')).toEqual(['Red']);
		expect(url.searchParams.get('category')).toBe('leader');
		expect(request!.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
	});

	it.each([
		[
			'a known number',
			{ number: 'op01-001' },
			['OP01-001'],
		],
		[
			'a known number in the category asked for',
			{ number: 'OP01-001', category: 'leader' },
			['OP01-001'],
		],
		[
			'a known number outside the category asked for',
			{ number: 'OP01-001', category: 'event' },
			[],
		],
		[
			'a known number outside the colour asked for',
			{ number: 'OP01-001', color: 'Blue' },
			[],
		],
		[
			'an unknown number',
			{ number: 'OP99-999' },
			[],
		],
	])('by card number answers %s through the number lookup', async (_case, query, numbers) => {
		const answer = await search(query) as { items: Array<{ number: string }>; total: number };

		expect(answer.items.map(card => card.number)).toEqual(numbers);
		expect(answer.total).toBe(numbers.length);
		expect(requests.map(request => new URL(request.url).pathname)).toEqual([`/cards/${query.number.toUpperCase()}`]);
	});

	it.each([
		[
			'an unknown colour',
			{ color: 'red' },
		],
		[
			'an unknown category',
			{ category: 'don' },
		],
		[
			'a malformed card number',
			{ number: 'zoro' },
		],
	])('refuses %s before calling bandai-keepr', async (_case, query) => {
		await expect(search(query)).rejects.toThrow();
		expect(requests).toEqual([]);
	});

	it('answers no cards for text bandai-keepr finds no words in', async () => {
		upstream = () => Response.json({ error: 'Invalid query parameter "q": has no words to search for' }, { status: 400 });

		await expect(search({ q: '!!' })).resolves.toEqual({ available: true, items: [], total: 0 });
	});

	it('is never cached: each search asks bandai-keepr', async () => {
		await search({ q: 'zoro' });
		await search({ q: 'zoro' });

		expect(requests).toHaveLength(2);
	});
});

describe('looking up a card number', () => {
	it('answers the Card with every Printing, imaged at cards-img.keepr.digital/<PrintingId>.png', async () => {
		await expect(lookup('OP01-001')).resolves.toEqual({
			available: true,
			card: expect.objectContaining({
				number: 'OP01-001',
				name: 'Roronoa Zoro',
				imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
				printings: [
					{
						id: 'OP01-001',
						setId: 'OP-01',
						kind: 'standard',
						rarity: 'L',
						imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
					},
					{
						id: 'OP01-001_p1',
						setId: 'OP-01',
						kind: 'alt-art',
						rarity: 'L',
						imageUrl: 'https://cards-img.keepr.digital/OP01-001_p1.png',
					},
					{
						id: 'OP01-001_r1',
						setId: 'EB-01',
						kind: 'reprint',
						rarity: 'L',
						imageUrl: 'https://cards-img.keepr.digital/OP01-001_r1.png',
					},
				],
			}),
		});
	});

	it('answers no card for a number bandai-keepr does not know', async () => {
		await expect(lookup('OP99-999')).resolves.toEqual({ available: true, card: null });
	});

	it('is cached briefly: a repeat within a minute is served from the cache, one ten minutes on asks again', async () => {
		vi.useFakeTimers({
			toFake: ['Date'],
		});
		await lookup('OP01-001');
		vi.advanceTimersByTime(60_000);
		await expect(lookup('OP01-001')).resolves.toMatchObject({
			card: { number: 'OP01-001' },
		});
		expect(requests).toHaveLength(1);

		vi.advanceTimersByTime(10 * 60_000);
		await lookup('OP01-001');
		expect(requests).toHaveLength(2);
		// The cache key carries no credential.
		expect([
			...cached.keys(),
		].join(' ')).not.toContain(API_KEY);
	});
});

describe('when bandai-keepr fails', () => {
	it.each([
		['refuses the key', 401],
		['errors', 500],
	])('a search and a lookup raise its upstream failure when it %s', async (_case, status) => {
		upstream = () => Response.json({ error: 'nope' }, { status });

		await expect(search({ q: 'zoro' })).rejects.toMatchObject({ code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' });
		await expect(lookup('OP01-001')).rejects.toMatchObject({ code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' });
	});

	it('a lookup raises it when the answer is not a Card', async () => {
		upstream = () => Response.json({ number: 'OP01-001' });

		await expect(lookup('OP01-001')).rejects.toMatchObject({ code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' });
	});
});

describe('on an MTG Event', () => {
	it('refuses search and lookup with a 404 and calls nothing', async () => {
		await expect(search({ q: 'zoro' }, mtgEventId)).rejects.toMatchObject({ statusCode: 404 });
		await expect(lookup('OP01-001', mtgEventId)).rejects.toMatchObject({ statusCode: 404 });
		expect(requests).toEqual([]);
	});
});
