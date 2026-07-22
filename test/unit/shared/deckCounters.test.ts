import { describe, expect, it } from 'vitest';
import { deriveDeckCounterTypesFromScryfallCard } from '~~/shared/utils/deckCounters';

describe('deck counter derivation', () => {
	it('detects energy from oracle text', () => {
		expect(deriveDeckCounterTypesFromScryfallCard({
			oracle_text: 'When this enters, you get {E}{E}.',
		})).toEqual(['energy']);
	});

	it('detects poison from poison text and poison keywords', () => {
		expect(deriveDeckCounterTypesFromScryfallCard({
			oracle_text: 'Target player gets a poison counter.',
			keywords: [],
		})).toEqual(['poison']);

		expect(deriveDeckCounterTypesFromScryfallCard({
			oracle_text: null,
			keywords: ['Toxic'],
		})).toEqual(['poison']);
	});

	it('detects storm, experience, and rad counters', () => {
		expect(deriveDeckCounterTypesFromScryfallCard({
			oracle_text: 'You get an experience counter. Each player gets two rad counters.',
			keywords: ['Storm'],
		})).toEqual(['storm', 'experience', 'rad']);
	});

	it('detects counters from card faces', () => {
		expect(deriveDeckCounterTypesFromScryfallCard({
			card_faces: [
				{ oracle_text: 'You get an energy counter.' },
				{ oracle_text: 'Target opponent gets a poison counter.' },
			],
		})).toEqual(['energy', 'poison']);
	});
});
