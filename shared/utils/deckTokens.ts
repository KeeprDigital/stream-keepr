export interface DeckTokenRequirement {
	id: string;
	scryfallId: string | null;
	name: string;
	typeLine: string | null;
	uri: string | null;
}

interface ScryfallPartLike {
	id?: string | null;
	component?: string | null;
	name?: string | null;
	type_line?: string | null;
	uri?: string | null;
}

interface ScryfallCardLike {
	all_parts?: ScryfallPartLike[] | null;
}

export function deriveDeckTokensFromScryfallCard(card: ScryfallCardLike): DeckTokenRequirement[] {
	const tokens = new Map<string, DeckTokenRequirement>();

	for (const part of card.all_parts ?? []) {
		if (part.component !== 'token' || !part.name?.trim()) {
			continue;
		}

		const name = part.name.trim();
		const id = part.id?.trim() || name.toLowerCase();
		tokens.set(id, {
			id,
			scryfallId: part.id?.trim() || null,
			name,
			typeLine: part.type_line?.trim() || null,
			uri: part.uri?.trim() || null,
		});
	}

	return [...tokens.values()];
}

export function uniqueDeckTokens(tokens: Iterable<DeckTokenRequirement | null | undefined>): DeckTokenRequirement[] {
	const byName = new Map<string, DeckTokenRequirement>();

	for (const token of tokens) {
		if (!token?.name.trim()) {
			continue;
		}

		const key = token.name.trim().toLowerCase();
		if (!byName.has(key)) {
			byName.set(key, {
				id: token.id,
				scryfallId: token.scryfallId,
				name: token.name.trim(),
				typeLine: token.typeLine,
				uri: token.uri,
			});
		}
	}

	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
