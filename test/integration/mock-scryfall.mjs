/**
 * Deterministic Scryfall responses owned by the integration acceptance fixtures.
 *
 * Every request outside the synthetic `it1` and `it2` sets and the named
 * provider-failure sentinel still reaches the real boundary. This keeps the fixture narrow while
 * letting the Broadcast Deck List workflow prove exact-printing persistence and a
 * retryable upstream refusal without depending on mutable third-party catalogue
 * data or deliberately breaking the machine's network.
 */

const upstreamFetch = globalThis.fetch;

const cardsByPrinting = new Map([
	[
		'it1/1',
		{
			id: 'integration-bolt-printing',
			oracle_id: 'integration-bolt-oracle',
			name: 'Integration Bolt',
			set: 'it1',
			collector_number: '1',
			mana_cost: '{R}',
			cmc: 1,
			color_identity: ['R'],
			type_line: 'Instant',
			oracle_text: 'Integration fixture.',
			keywords: [],
		},
	],
	[
		'it1/2',
		{
			id: 'integration-blast-printing',
			oracle_id: 'integration-blast-oracle',
			name: 'Integration Blast',
			set: 'it1',
			collector_number: '2',
			mana_cost: '{U}',
			cmc: 1,
			color_identity: ['U'],
			type_line: 'Instant',
			oracle_text: 'Integration fixture.',
			keywords: [],
		},
	],
	[
		'it1/3',
		{
			id: 'integration-companion-printing',
			oracle_id: 'integration-companion-oracle',
			name: 'Integration Companion',
			set: 'it1',
			collector_number: '3',
			mana_cost: '{2}{G}',
			cmc: 3,
			color_identity: ['G'],
			type_line: 'Legendary Creature — Test Companion',
			oracle_text: 'Companion — Integration fixture.',
			keywords: ['Companion'],
		},
	],
	// A Commander Seat's paste: a Commander holds its printing by a Scryfall id, a UUID.
	[
		'it2/1',
		{
			id: '5e1f0c1a-8f0b-4c36-9d7e-2b6a4d1c0e01',
			oracle_id: '5e1f0c1a-8f0b-4c36-9d7e-2b6a4d1c0f01',
			name: 'Integration Commander',
			set: 'it2',
			collector_number: '1',
			mana_cost: '{G}{U}',
			cmc: 2,
			color_identity: ['G', 'U'],
			type_line: 'Legendary Creature — Test Commander',
			oracle_text: 'Integration fixture.',
			keywords: [],
		},
	],
	[
		'it2/2p',
		{
			id: '5e1f0c1a-8f0b-4c36-9d7e-2b6a4d1c0e02',
			oracle_id: '5e1f0c1a-8f0b-4c36-9d7e-2b6a4d1c0f02',
			name: 'Integration Land',
			set: 'it2',
			collector_number: '2p',
			cmc: 0,
			color_identity: [],
			type_line: 'Land',
			oracle_text: 'Integration fixture.',
			keywords: [],
		},
	],
]);

/** The sets whose every printing is one of the fixtures above. */
const SYNTHETIC_SETS = new Set(['it1', 'it2']);

function jsonResponse(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

globalThis.fetch = async (input, init) => {
	const requestUrl = new URL(input instanceof Request
		? input.url
		: String(input));
	if (requestUrl.origin !== 'https://api.scryfall.com')
		return await upstreamFetch(input, init);

	if (requestUrl.pathname === '/cards/collection') {
		const body = typeof init?.body === 'string'
			? init.body
			: input instanceof Request
				? await input.clone().text()
				: '';
		const identifiers = JSON.parse(body).identifiers ?? [];
		if (identifiers.some(identifier => identifier.name === 'Integration Provider Failure')) {
			return jsonResponse({ object: 'error', details: 'Synthetic retryable refusal' }, 503);
		}
		// Exact printings are asked for in one batch, by set and collector number.
		if (identifiers.length > 0 && identifiers.every(identifier => identifier.collector_number !== undefined && SYNTHETIC_SETS.has(identifier.set))) {
			const answered = identifiers.map(identifier => ({
				identifier,
				card: cardsByPrinting.get(`${identifier.set}/${identifier.collector_number}`),
			}));
			return jsonResponse({
				object: 'list',
				not_found: answered.filter(({ card }) => !card).map(({ identifier }) => identifier),
				data: answered.flatMap(({ card }) => card ?? []),
			});
		}
		return await upstreamFetch(input, init);
	}

	const printingKey = requestUrl.pathname.slice('/cards/'.length);
	const card = cardsByPrinting.get(printingKey);
	return card
		? jsonResponse(card)
		: await upstreamFetch(input, init);
};
