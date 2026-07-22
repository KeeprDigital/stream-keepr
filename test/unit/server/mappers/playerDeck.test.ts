import { describe, expect, it } from 'vitest';
import { mapPlayerDeckSummary, resolvePlayerDeckDetails } from '~~/server/mappers/playerDeck';

const importedDeck = {
	id: 10,
	eventId: 1,
	playerId: 2,
	externalId: 'deck-10',
	externalSource: 'melee' as const,
	formatExternalId: 'modern',
	name: 'Imported Burn',
	colors: 'R',
	sortOrder: 0,
	isPrimary: true,
	archetypeId: null,
	reviewedAt: null,
	createdAt: new Date('2026-07-15T00:00:00.000Z'),
	updatedAt: new Date('2026-07-15T00:00:00.000Z'),
};

describe('player deck display details', () => {
	it('uses submitted details until the deck is reviewed', () => {
		expect(resolvePlayerDeckDetails(importedDeck, null)).toEqual({
			name: 'Imported Burn',
			colors: 'R',
			submittedName: 'Imported Burn',
			submittedColors: 'R',
		});
	});

	it('uses the reviewed archetype everywhere while preserving submitted details', () => {
		const reviewedDeck = {
			...importedDeck,
			archetypeId: 5,
			reviewedAt: new Date('2026-07-15T01:00:00.000Z'),
		};
		const archetype = { id: 5, name: 'Jeskai Control', colors: 'WUR' };

		expect(mapPlayerDeckSummary(reviewedDeck, archetype)).toMatchObject({
			name: 'Jeskai Control',
			colors: 'WUR',
			submittedName: 'Imported Burn',
			submittedColors: 'R',
			archetypeId: 5,
		});
	});

	it('does not apply stale or mismatched archetype details', () => {
		const reviewedDeck = {
			...importedDeck,
			archetypeId: 5,
			reviewedAt: new Date('2026-07-15T01:00:00.000Z'),
		};

		expect(resolvePlayerDeckDetails(reviewedDeck, { id: 6, name: 'Wrong', colors: 'U' })).toMatchObject({
			name: 'Imported Burn',
			colors: 'R',
		});
	});
});
