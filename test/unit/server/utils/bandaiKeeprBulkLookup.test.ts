import { beforeEach, describe, expect, it, vi } from 'vitest';
import { lookUpOpCards } from '~~/server/utils/bandaiKeepr';
import { bandaiKeeprCard } from '~~/test/helpers/opCards';

// The bulk lookup port asks bandai-keepr's `POST /cards/collection` by number
// only, at most 1,000 a request. bandai-keepr is faked at `fetch`.

const config = { apiUrl: 'https://op-api.test', apiKey: 'test-key' };

const known = new Map([
	bandaiKeeprCard({
		number: 'OP01-001',
		name: 'Roronoa Zoro',
		category: 'leader',
		colors: ['Red'],
	}),
	bandaiKeeprCard({
		number: 'OP01-025',
		name: 'Roronoa Zoro',
		category: 'character',
		colors: ['Red'],
		cost: 3,
		power: 5000,
		counter: 1000,
	}),
].map(card => [card.number, card]));

const bodies: unknown[] = [];
let answer: (identifiers: { number?: string }[]) => Response;

function collection(identifiers: { number?: string }[]): Response {
	return Response.json({
		results: identifiers.map((identifier, index) => {
			const card = known.get(identifier.number ?? '');
			return card
				? { index, card }
				: {
						index,
						error: { code: 'not_found' },
					};
		}),
	});
}

vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
	const request = new Request(input, init);
	const url = new URL(request.url);
	if (request.method !== 'POST' || url.pathname !== '/cards/collection' || request.headers.get('authorization') !== 'Bearer test-key')
		return Response.json({ error: 'unrouted' }, { status: 500 });
	const body = await request.json() as { identifiers: { number?: string }[] };
	bodies.push(body);
	return answer(body.identifiers);
});

beforeEach(() => {
	bodies.length = 0;
	answer = collection;
});

describe('the bandai-keepr bulk lookup', () => {
	it('answers the cards it knows and the numbers it does not, asking by number only', async () => {
		const answered = await lookUpOpCards(config, ['OP01-001', 'OP99-999', 'OP01-025']);

		expect(answered.cards).toEqual([
			expect.objectContaining({
				number: 'OP01-001',
				name: 'Roronoa Zoro',
				category: 'leader',
				colors: ['Red'],
				imageUrl: 'https://cards-img.keepr.digital/OP01-001.png',
			}),
			expect.objectContaining({
				number: 'OP01-025',
				category: 'character',
				cost: 3,
				power: 5000,
				counter: 1000,
			}),
		]);
		expect(answered.notFound).toEqual(['OP99-999']);
		expect(bodies).toEqual([
			{
				identifiers: [
					{ number: 'OP01-001' },
					{ number: 'OP99-999' },
					{ number: 'OP01-025' },
				],
			},
		]);
	});

	it.each([
		[0, []],
		[
			1000,
			[1000],
		],
		[
			1001,
			[1000, 1],
		],
		[
			2500,
			[1000, 1000, 500],
		],
	])('asks %i numbers in requests of %j', async (count, sizes) => {
		const numbers = Array.from({ length: count }, (_, index) => `OP90-${String(index).padStart(4, '0')}`);

		const answered = await lookUpOpCards(config, numbers);

		expect(bodies.map(body => (body as { identifiers: unknown[] }).identifiers.length)).toEqual(sizes);
		expect(answered.notFound).toEqual(numbers);
	});

	it.each([
		[
			'an HTTP failure',
			() => Response.json({ error: 'down' }, { status: 503 }),
		],
		[
			'an answer missing a result',
			() => Response.json({ results: [] }),
		],
		[
			'an error other than not found',
			(identifiers: { number?: string }[]) => Response.json({
				results: identifiers.map((_, index) => ({
					index,
					error: { code: 'ambiguous_name', candidates: [] },
				})),
			}),
		],
	])('fails on %s', async (_label, respond) => {
		answer = respond;

		await expect(lookUpOpCards(config, ['OP01-001'])).rejects.toMatchObject({ code: 'BANDAI_KEEPR_UPSTREAM_FAILURE' });
	});
});
