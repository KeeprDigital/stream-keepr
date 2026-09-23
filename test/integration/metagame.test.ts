import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';

describe('metagame API', () => {
	let eventId: number;
	let playerListId: number;
	let archetypeId1: number;
	let archetypeId2: number;
	let largeScopeEventId: number;
	let largeScopePlayerListId: number;
	let largeScopeArchetypeId: number;
	let deckTestPlayerId: number;

	beforeAll(async () => {
		// Create MTG event
		const event = (await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Metagame Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		})) as any;
		eventId = event.id;

		// Create archetypes
		const arch1 = (await $fetch(`/api/events/${eventId}/archetypes`, {
			method: 'POST',
			body: { name: 'Mono Red', colors: 'R' },
		})) as any;
		archetypeId1 = arch1.id;

		const arch2 = (await $fetch(`/api/events/${eventId}/archetypes`, {
			method: 'POST',
			body: { name: 'Azorius Control', colors: 'WU' },
		})) as any;
		archetypeId2 = arch2.id;

		// Create players and assign archetypes (new approach: archetypeId FK)
		const p1 = (await $fetch(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: {
				name: 'Player 1',
				wins: 5,
				losses: 1,
				position: 1,
				points: 15,
				gameData: { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' },
			},
		})) as any;
		await $fetch(`/api/events/${eventId}/players/${p1.id}`, {
			method: 'PATCH',
			body: { archetypeId: archetypeId1 },
		});

		const p2 = (await $fetch(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: {
				name: 'Player 2',
				wins: 4,
				losses: 2,
				position: 2,
				points: 12,
				gameData: { type: 'mtg', deckName: 'Azorius Control', deckColors: 'WU' },
			},
		})) as any;
		await $fetch(`/api/events/${eventId}/players/${p2.id}`, {
			method: 'PATCH',
			body: { archetypeId: archetypeId2 },
		});

		const p3 = (await $fetch(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: {
				name: 'Player 3',
				wins: 3,
				losses: 3,
				position: 3,
				points: 9,
				gameData: { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' },
			},
		})) as any;
		await $fetch(`/api/events/${eventId}/players/${p3.id}`, {
			method: 'PATCH',
			body: { archetypeId: archetypeId1 },
		});

		// p4 is unclassified (no archetypeId)
		await $fetch(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name: 'Player 4', wins: 2, losses: 4, position: 4, points: 6 },
		});

		// Create a player list with p1 and p2
		const list = (await $fetch(`/api/events/${eventId}/player-lists`, {
			method: 'POST',
			body: { name: 'Test List' },
		})) as any;
		playerListId = list.id;

		await $fetch(`/api/events/${eventId}/player-lists/${playerListId}/members`, {
			method: 'POST',
			body: { playerIds: [p1.id, p2.id] },
		});

		// Create a second event with enough players to exceed the old 50-ID limit.
		const largeScopeEvent = (await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Large Scope Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		})) as any;
		largeScopeEventId = largeScopeEvent.id;

		const largeScopeArchetype = (await $fetch(`/api/events/${largeScopeEventId}/archetypes`, {
			method: 'POST',
			body: { name: 'Domain Ramp', colors: 'WUBRG' },
		})) as any;
		largeScopeArchetypeId = largeScopeArchetype.id;

		const largeScopePlayerIds: number[] = [];
		for (let index = 1; index <= 60; index++) {
			const player = (await $fetch(`/api/events/${largeScopeEventId}/players`, {
				method: 'POST',
				body: {
					name: `Large Scope Player ${index}`,
					archetypeId: largeScopeArchetypeId,
					wins: 1,
					losses: 0,
					position: index,
					points: 3,
					gameData: { type: 'mtg', deckName: 'Domain Ramp', deckColors: 'WUBRG' },
				},
			})) as any;
			largeScopePlayerIds.push(player.id);
		}

		const largeScopeList = (await $fetch(`/api/events/${largeScopeEventId}/player-lists`, {
			method: 'POST',
			body: { name: 'Large Scope List' },
		})) as any;
		largeScopePlayerListId = largeScopeList.id;

		await $fetch(`/api/events/${largeScopeEventId}/player-lists/${largeScopePlayerListId}/members`, {
			method: 'POST',
			body: { playerIds: largeScopePlayerIds },
		});
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}

		try {
			await $fetch(`/api/events/${largeScopeEventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	// ──────────────── Summary ────────────────

	describe('summary endpoint', () => {
		it('returns 200 with correct response shape', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame`)) as any;

			expect(data).toHaveProperty('totalPlayers');
			expect(data).toHaveProperty('classifiedPlayers');
			expect(data).toHaveProperty('totalDecks');
			expect(data).toHaveProperty('totalArchetypes');
			expect(data).toHaveProperty('scopedArchetypeCount');
			expect(data).toHaveProperty('scope');
			expect(data).toHaveProperty('facts');
			expect(data).toHaveProperty('topArchetypes');
			expect(data).toHaveProperty('topCards');
			expect(data.scope).toBe('all');
			expect(data.totalPlayers).toBe(4);
			// 3 classified players (p1, p2, p3) + 1 unclassified (p4)
			expect(data.classifiedPlayers).toBe(3);
			expect(data.totalDecks).toBe(0);
			expect(data.totalArchetypes).toBe(2);
			expect(data.scopedArchetypeCount).toBe(2);
			expect(data.facts).toEqual(expect.arrayContaining([
				expect.objectContaining({ key: 'mostPlayedArchetype', value: 'Mono Red' }),
			]));
		});
	});

	// ──────────────── Archetypes ────────────────

	describe('archetypes endpoint', () => {
		it('returns 200 with correct response shape', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes`)) as any;

			expect(data).toHaveProperty('entries');
			expect(data).toHaveProperty('totalPlayers');
			expect(data).toHaveProperty('classifiedPlayers');
			expect(data).toHaveProperty('scope');
			expect(data.scope).toBe('all');
			expect(data.totalPlayers).toBe(4);
			expect(data.classifiedPlayers).toBe(3);
			expect(data.entries).toBeInstanceOf(Array);
		});

		it('groups players by archetypeId with correct counts', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes`)) as any;

			const monoRed = data.entries.find((e: any) => e.name === 'Mono Red');
			expect(monoRed).toBeDefined();
			expect(monoRed.count).toBe(2);
			expect(monoRed.id).toBe(archetypeId1);

			const azorius = data.entries.find((e: any) => e.name === 'Azorius Control');
			expect(azorius).toBeDefined();
			expect(azorius.count).toBe(1);
		});

		it('computes metaShare correctly', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes`)) as any;

			const monoRed = data.entries.find((e: any) => e.name === 'Mono Red');
			// 2 out of 3 classified = 66.67%
			expect(monoRed.metaShare).toBeCloseTo(66.67, 1);
		});

		it('respects scope=topN', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes?scope=topN&topN=2`)) as any;
			// Top 2 players by position: p1, p2
			expect(data.totalPlayers).toBe(2);
		});

		it('respects scope=playerList', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes?scope=playerList&playerListId=${playerListId}`)) as any;
			expect(data.totalPlayers).toBe(2);
		});

		it('respects scope=minPoints', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes?scope=minPoints&minPoints=12`)) as any;
			// Players with at least 12 points: p1 (15), p2 (12)
			expect(data.scope).toBe('minPoints');
			expect(data.totalPlayers).toBe(2);
		});

		it('returns null conversion rates without a conversion target', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes`)) as any;
			expect(data.entries[0].conversionRate).toBeNull();
		});

		it('computes conversion rate against a topN target', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes?conversionMetric=topN&conversionThreshold=2`)) as any;

			// Mono Red: p1 (position 1) converted, p3 (position 3) not → 50%
			const monoRed = data.entries.find((e: any) => e.name === 'Mono Red');
			expect(monoRed.conversionRate).toBe(50);

			// Azorius: p2 (position 2) converted → 100%
			const azorius = data.entries.find((e: any) => e.name === 'Azorius Control');
			expect(azorius.conversionRate).toBe(100);
		});

		it('computes conversion rate against a minPoints target', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes?conversionMetric=minPoints&conversionThreshold=12`)) as any;

			// Mono Red: p1 (15 points) converted, p3 (9 points) not → 50%
			const monoRed = data.entries.find((e: any) => e.name === 'Mono Red');
			expect(monoRed.conversionRate).toBe(50);
		});

		it('rejects a conversion metric without a threshold', async () => {
			await expect(
				$fetch(`/api/events/${eventId}/metagame/archetypes?conversionMetric=topN`),
			).rejects.toMatchObject({ statusCode: 400 });
		});

		it('rolls archetypes beyond limit into an Other row', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes?limit=1`)) as any;

			expect(data.entries).toHaveLength(2);
			expect(data.entries[0].name).toBe('Mono Red');

			const other = data.entries[1];
			expect(other.id).toBe(-1);
			expect(other.name).toBe('Other');
			expect(other.count).toBe(1);
		});

		it('returns keyCards array for each archetype', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes`)) as any;
			expect(data.entries[0]).toHaveProperty('keyCards');
			expect(data.entries[0].keyCards).toBeInstanceOf(Array);
		});
	});

	// ──────────────── Cards ────────────────

	describe('cards endpoint', () => {
		it('returns 200 with correct response shape', async () => {
			// No deck cards in test data (no Melee sync), so totalDecks=0
			const data = (await $fetch(`/api/events/${eventId}/metagame/cards`)) as any;

			expect(data).toHaveProperty('entries');
			expect(data).toHaveProperty('totalDecks');
			expect(data).toHaveProperty('scope');
			expect(data.totalDecks).toBe(0);
			expect(data.entries).toBeInstanceOf(Array);
		});

		it('respects limit param', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/cards?limit=2`)) as any;
			expect(data.entries.length).toBeLessThanOrEqual(2);
		});
	});

	describe('tokens endpoint', () => {
		it('returns 200 with correct response shape', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/tokens`)) as any;

			expect(data).toHaveProperty('entries');
			expect(data).toHaveProperty('totalDecks');
			expect(data).toHaveProperty('scope');
			expect(data.totalDecks).toBe(0);
			expect(data.entries).toBeInstanceOf(Array);
		});

		it('accepts metagame scope query params', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/tokens?scope=topN&topN=2`)) as any;

			expect(data.scope).toBe('topN');
			expect(data.entries).toBeInstanceOf(Array);
		});
	});

	// ──────────────── Archetype detail ────────────────

	describe('archetype detail endpoint', () => {
		it('returns 200 with full archetype detail', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes/${archetypeId1}`)) as any;

			expect(data.id).toBe(archetypeId1);
			expect(data.name).toBe('Mono Red');
			expect(data.playerCount).toBe(2);
			expect(data.players).toBeInstanceOf(Array);
			expect(data.players).toHaveLength(2);
			expect(data.keyCards).toBeInstanceOf(Array);
			expect(data.cardBreakdown).toBeInstanceOf(Array);
		});

		it('computes conversion against the requested target', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes/${archetypeId1}?conversionMetric=topN&conversionThreshold=2`)) as any;

			// Mono Red: p1 (position 1) converted, p3 (position 3) not
			expect(data.convertedCount).toBe(1);
			expect(data.conversionRate).toBe(50);
		});

		it('returns null conversion stats without a conversion target', async () => {
			const data = (await $fetch(`/api/events/${eventId}/metagame/archetypes/${archetypeId1}`)) as any;

			expect(data.convertedCount).toBeNull();
			expect(data.conversionRate).toBeNull();
		});

		it('supports large archetype populations without failing', async () => {
			const data = (await $fetch(`/api/events/${largeScopeEventId}/metagame/archetypes/${largeScopeArchetypeId}`)) as any;

			expect(data.playerCount).toBe(60);
			expect(data.players).toHaveLength(60);
		});
	});

	describe('large player scopes', () => {
		it('supports topN scopes larger than 50', async () => {
			const data = (await $fetch(`/api/events/${largeScopeEventId}/metagame/archetypes?scope=topN&topN=55`)) as any;

			expect(data.totalPlayers).toBe(55);
			expect(data.classifiedPlayers).toBe(55);
			expect(data.entries[0].count).toBe(55);
		});

		it('supports playerList scopes larger than 50', async () => {
			const data = (await $fetch(`/api/events/${largeScopeEventId}/metagame/archetypes?scope=playerList&playerListId=${largeScopePlayerListId}`)) as any;

			expect(data.totalPlayers).toBe(60);
			expect(data.classifiedPlayers).toBe(60);
			expect(data.entries[0].count).toBe(60);
		});
	});

	// ──────────────── Error cases ────────────────

	// ──────────────── Card detail endpoint ────────────────

	// ──────────────── Player decks endpoint ────────────────

	describe('player decks endpoint', () => {
		async function ensureDeckTestPlayer() {
			if (deckTestPlayerId)
				return deckTestPlayerId;

			const player = (await $fetch(`/api/events/${eventId}/players`, {
				method: 'POST',
				body: {
					name: 'Deck Test Player',
					wins: 1,
					losses: 1,
					position: 5,
					points: 3,
					gameData: { type: 'mtg', deckName: 'Test Deck', deckColors: 'G' },
				},
			})) as any;

			deckTestPlayerId = player.id;
			return deckTestPlayerId;
		}

		it('returns an empty normalized collection for a player without submitted decks', async () => {
			const playerId = await ensureDeckTestPlayer();
			const data = (await $fetch(`/api/events/${eventId}/players/${playerId}/decks`)) as any;

			expect(data).toEqual({ decks: [], selectedDeckId: null });
		});

		it('accepts a real phase selection without inventing a positional deck', async () => {
			const playerId = await ensureDeckTestPlayer();
			const data = (await $fetch(`/api/events/${eventId}/players/${playerId}/decks?phaseId=1`)) as any;

			expect(data).toEqual({ decks: [], selectedDeckId: null });
		});
	});
});
