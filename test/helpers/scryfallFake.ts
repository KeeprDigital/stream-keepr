/**
 * Scryfall at the network boundary, matching names as the live API does: a lone name
 * prefers the card of exactly that name, but `/cards/collection` answers a name with an
 * earlier identifier's card when the name is one of its faces.
 */

export interface FakeScryfallCard {
	id: string;
	name: string;
	set: string;
	/** `1` where a test does not name it. */
	collector_number?: string;
	type_line?: string;
	/** Colour identity letters, alphabetical as Scryfall lists them; none where a test does not name it. */
	color_identity?: string[];
}

/** What `/cards/collection` is asked for: a name, in a set or not, or one exact printing. */
type FakeIdentifier = { name: string; set?: string } | { set: string; collector_number: string };

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
		collector_number: card.collector_number ?? '1',
		oracle_id: `oracle-${card.id}`,
		mana_cost: null,
		cmc: 1,
		color_identity: card.color_identity ?? [],
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

	const findPrinting = (set: string, collectorNumber: string) =>
		catalogue.find(card => sameName(card.set, set) && sameName(card.collector_number ?? '1', collectorNumber)) ?? null;

	const collection = (identifiers: FakeIdentifier[]) => {
		collectionBatches.push(identifiers.map(identifier => 'name' in identifier
			? identifier.name
			: `${identifier.set}/${identifier.collector_number}`));
		const data: FakeScryfallCard[] = [];
		const notFound: FakeIdentifier[] = [];
		for (const identifier of identifiers) {
			const card = !('name' in identifier)
				? findPrinting(identifier.set, identifier.collector_number)
				: identifier.name.includes(' // ')
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
