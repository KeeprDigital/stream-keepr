/**
 * A Scryfall stand-in for the network boundary, reproducing the name matching
 * observed on the live API (#889): a lone name answers with the card of exactly
 * that name before a card that only carries it as a face, while `/cards/collection`
 * answers a name with an earlier identifier's card when the name is one of its faces.
 */

export interface FakeScryfallCard {
	id: string;
	name: string;
	set: string;
	type_line?: string;
}

function sameName(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function hasFace(card: FakeScryfallCard, name: string): boolean {
	const faces = card.name.split(' // ');
	return faces.length > 1 && faces.some(face => sameName(face, name));
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function toScryfallJson(card: FakeScryfallCard) {
	return {
		id: card.id,
		name: card.name,
		set: card.set,
		collector_number: '1',
		oracle_id: `oracle-${card.id}`,
		mana_cost: null,
		cmc: 1,
		color_identity: [],
		type_line: card.type_line ?? 'Sorcery',
	};
}

export function createScryfallFake(catalogue: readonly FakeScryfallCard[]) {
	const namedLookups: string[] = [];
	const collectionBatches: string[][] = [];

	const inSet = (card: FakeScryfallCard, set: string | null | undefined) =>
		!set || sameName(card.set, set);

	const findByName = (name: string, set?: string | null) =>
		catalogue.find(card => inSet(card, set) && sameName(card.name, name))
		?? catalogue.find(card => inSet(card, set) && hasFace(card, name))
		?? null;

	const collection = (identifiers: Array<{ name: string; set?: string }>) => {
		collectionBatches.push(identifiers.map(identifier => identifier.name));
		const data: FakeScryfallCard[] = [];
		const notFound: Array<{ name: string; set?: string }> = [];
		for (const identifier of identifiers) {
			const card = identifier.name.includes(' // ')
				? null
				: data.find(earlier => inSet(earlier, identifier.set) && hasFace(earlier, identifier.name))
					?? findByName(identifier.name, identifier.set);
			if (card)
				data.push(card);
			else
				notFound.push(identifier);
		}
		return json({
			object: 'list',
			not_found: notFound,
			data: data.map(toScryfallJson),
		});
	};

	const named = (url: URL) => {
		const name = url.searchParams.get('exact') ?? url.searchParams.get('fuzzy') ?? '';
		namedLookups.push(name);
		const card = findByName(name, url.searchParams.get('set'));
		return card
			? json(toScryfallJson(card))
			: json({ object: 'error', status: 404 }, 404);
	};

	const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = new URL(typeof input === 'string' || input instanceof URL
			? input
			: input.url);
		if (url.pathname === '/cards/collection')
			return collection(JSON.parse(String(init?.body)).identifiers);
		if (url.pathname === '/cards/named')
			return named(url);
		throw new Error(`Unexpected Scryfall request: ${url}`);
	};

	return { fetch, namedLookups, collectionBatches };
}

/** Cards a face of which is also a standalone card's name, as on Scryfall. */
export const FACE_NAME_COLLISIONS = {
	schemingSilvertongue: {
		id: 'scheming-silvertongue',
		name: 'Scheming Silvertongue // Sign in Blood',
		set: 'sos',
		type_line: 'Creature — Vampire Warlock // Sorcery — Prepare',
	},
	signInBlood: { id: 'sign-in-blood', name: 'Sign in Blood', set: 'dsc' },
	emeritusOfConflict: {
		id: 'emeritus-of-conflict',
		name: 'Emeritus of Conflict // Lightning Bolt',
		set: 'sos',
		type_line: 'Creature — Human Wizard // Instant — Prepare',
	},
	lightningBolt: {
		id: 'lightning-bolt',
		name: 'Lightning Bolt',
		set: 'msc',
		type_line: 'Instant',
	},
	bindLiberate: { id: 'bind-liberate', name: 'Bind // Liberate', set: 'unk' },
	bind: {
		id: 'bind',
		name: 'Bind',
		set: 'inv',
		type_line: 'Instant',
	},
	delverOfSecrets: {
		id: 'delver-of-secrets',
		name: 'Delver of Secrets // Insectile Aberration',
		set: 'inr',
		type_line: 'Creature — Human Wizard // Creature — Human Insect',
	},
} satisfies Record<string, FakeScryfallCard>;
