import type { CounterTypeConfig } from '../types/game';

export type DeckCounterType = 'poison' | 'energy' | 'storm' | 'experience' | 'rad';

interface ScryfallFaceLike {
	oracle_text?: string | null;
}

interface ScryfallCardLike {
	oracle_text?: string | null;
	keywords?: string[] | null;
	card_faces?: ScryfallFaceLike[] | null;
}

function normalizedOracleText(card: ScryfallCardLike): string {
	return [
		card.oracle_text,
		...(card.card_faces ?? []).map(face => face.oracle_text),
	]
		.filter((text): text is string => typeof text === 'string')
		.join('\n')
		.toLowerCase();
}

function normalizedKeywords(card: ScryfallCardLike): Set<string> {
	return new Set((card.keywords ?? []).map(keyword => keyword.toLowerCase()));
}

export function deriveDeckCounterTypesFromScryfallCard(card: ScryfallCardLike): DeckCounterType[] {
	const text = normalizedOracleText(card);
	const keywords = normalizedKeywords(card);
	const counters = new Set<DeckCounterType>();

	if (text.includes('{e}') || text.includes('energy counter')) {
		counters.add('energy');
	}

	if (
		text.includes('poison counter')
		|| keywords.has('toxic')
		|| keywords.has('infect')
		|| keywords.has('poisonous')
	) {
		counters.add('poison');
	}

	if (keywords.has('storm') || text.includes('storm count')) {
		counters.add('storm');
	}

	if (text.includes('experience counter')) {
		counters.add('experience');
	}

	if (text.includes('rad counter')) {
		counters.add('rad');
	}

	return [...counters];
}

export function uniqueDeckCounterTypes(counterTypes: Iterable<string | null | undefined>): DeckCounterType[] {
	const supported: DeckCounterType[] = ['poison', 'energy', 'storm', 'experience', 'rad'];
	const selected = new Set(counterTypes);
	return supported.filter(type => selected.has(type));
}

export function counterConfigsForDeckCounterTypes(
	counterTypes: Iterable<string | null | undefined>,
	configs: CounterTypeConfig[],
): CounterTypeConfig[] {
	const configByKey = new Map(configs.map(config => [config.key, config]));
	return uniqueDeckCounterTypes(counterTypes)
		.map(type => configByKey.get(type))
		.filter((config): config is CounterTypeConfig => !!config);
}
