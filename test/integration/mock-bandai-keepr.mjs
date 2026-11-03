import process from 'node:process';

/**
 * A deterministic bandai-keepr for the integration servers (ADR-0057).
 *
 * The suite configures bandai-keepr at an origin nobody serves
 * (`integrationServerEnv`), and this answers it: a card number lookup finds
 * the fixture cards below and 404s any other number. Every other origin goes
 * to whatever `fetch` was before.
 */

const bandaiKeeprOrigin = process.env.NUXT_BANDAI_KEEPR_API_URL
	? new URL(process.env.NUXT_BANDAI_KEEPR_API_URL).origin
	: null;

const upstreamFetch = globalThis.fetch;

function card(number, name, category, colors) {
	return {
		number,
		sourcePrintingId: number,
		name,
		category,
		colors,
		cost: category === 'leader'
			? null
			: 2,
		life: category === 'leader'
			? 5
			: null,
		power: 5000,
		counter: category === 'leader'
			? null
			: 1000,
		types: [],
		effect: null,
		trigger: null,
		printings: [
			{
				id: number,
				setId: 'OP-01',
				kind: 'standard',
				rarity: 'C',
			},
		],
	};
}

const cards = new Map([
	card('OP01-001', 'Roronoa Zoro', 'leader', ['Red']),
	card('OP01-016', 'Nami', 'leader', ['Blue']),
	card('OP01-025', 'Roronoa Zoro', 'character', ['Red']),
	card('OP01-040', 'Usopp', 'character', ['Blue']),
].map(entry => [entry.number, entry]));

globalThis.fetch = async (input, init) => {
	const requestUrl = new URL(input instanceof Request
		? input.url
		: String(input));
	if (requestUrl.origin !== bandaiKeeprOrigin)
		return await upstreamFetch(input, init);

	const number = /^\/cards\/([^/]+)$/.exec(requestUrl.pathname)?.[1];
	const found = number
		? cards.get(decodeURIComponent(number))
		: undefined;
	return new Response(JSON.stringify(found ?? { error: 'Card not found' }), {
		status: found
			? 200
			: 404,
		headers: { 'content-type': 'application/json' },
	});
};
