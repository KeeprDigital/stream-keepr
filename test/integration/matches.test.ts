import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetchRaw } from './helpers';

describe('matches API', () => {
	let eventId: number;
	let phaseId: number;
	let roundId: number;
	let matchId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Matches Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;

		const phase = await $fetch(`/api/events/${eventId}/phases`, {
			method: 'POST',
			body: { name: 'Swiss' },
		});
		phaseId = phase.id;

		const round = await $fetch(`/api/events/${eventId}/rounds`, {
			method: 'POST',
			body: { phaseId, name: 'Round 1', roundNumber: 1 },
		});
		roundId = round.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates a match and returns 201', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 1,
			},
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			roundId,
			eventId,
			tableNumber: 1,
			hasResult: false,
			isBye: false,
			externalId: null,
			externalSource: 'manual',
		});
		expect(res._data.id).toBeTypeOf('number');
		expect(res._data).toHaveProperty('createdAt');
		expect(res._data).toHaveProperty('updatedAt');

		matchId = res._data.id;
	});

	it('rejects forged Match provenance', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				tableNumber: 1,
				externalId: 'forged-match',
				externalSource: 'melee',
			},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	it('rejects forged nested Player provenance', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {
				roundId,
				player1Data: {
					name: 'Forged Player',
					externalId: 'forged-player',
					externalSource: 'melee',
				},
			},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	it('lists matches for the event', async () => {
		const data = await $fetch(`/api/events/${eventId}/matches`);

		expect(data.matches).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		const found = data.matches.find((m: { id: number }) => m.id === matchId);
		expect(found).toBeDefined();
		expect(found!.roundId).toBe(roundId);
	});

	it('lists matches filtered by roundId', async () => {
		const data = await $fetch(`/api/events/${eventId}/matches?roundId=${roundId}`);

		expect(data.matches).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		// All returned matches should belong to the filtered round
		for (const match of data.matches) {
			expect(match.roundId).toBe(roundId);
		}
	});

	it('gets a single match by ID', async () => {
		const match = await $fetch(`/api/events/${eventId}/matches/${matchId}`);

		expect(match.id).toBe(matchId);
		expect(match.eventId).toBe(eventId);
		expect(match.roundId).toBe(roundId);
		expect(match.tableNumber).toBe(1);
		expect(match).toHaveProperty('hasResult');
		expect(match).toHaveProperty('isBye');
		expect(match).toHaveProperty('player1Id');
		expect(match).toHaveProperty('player2Id');
		expect(match).toHaveProperty('player1Data');
		expect(match).toHaveProperty('player2Data');
		expect(match).toHaveProperty('player1GameWins');
		expect(match).toHaveProperty('player2GameWins');
		expect(match).toHaveProperty('gameDraws');
		expect(match).toHaveProperty('resultString');
		expect(match).toHaveProperty('createdAt');
		expect(match).toHaveProperty('updatedAt');
	});

	it('updates a match', async () => {
		const updated = await $fetch(`/api/events/${eventId}/matches/${matchId}`, {
			method: 'PATCH',
			body: { tableNumber: 5, hasResult: true, player1GameWins: 2, player2GameWins: 1 },
		});

		expect(updated.id).toBe(matchId);
		expect(updated.tableNumber).toBe(5);
		expect(updated.hasResult).toBe(true);
		expect(updated.player1GameWins).toBe(2);
		expect(updated.player2GameWins).toBe(1);
	});

	it('deletes a match', async () => {
		const match = await $fetch(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: { roundId, tableNumber: 99 },
		});

		const result = await $fetch(`/api/events/${eventId}/matches/${match.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		const res = await $fetchRaw(`/api/events/${eventId}/matches/${match.id}`);
		expect(res.status).toBe(404);
	});

	it('returns 4xx when creating with empty body', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/matches`, {
			method: 'POST',
			body: {},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});
});
