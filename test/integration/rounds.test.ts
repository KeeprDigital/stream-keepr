import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetchRaw } from './helpers';

describe('rounds API', () => {
	let eventId: number;
	let phaseId: number;
	let roundId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Rounds Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;

		const phase = await $fetch(`/api/events/${eventId}/phases`, {
			method: 'POST',
			body: { name: 'Swiss' },
		});
		phaseId = phase.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates a round and returns 201', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/rounds`, {
			method: 'POST',
			body: {
				phaseId,
				name: 'Round 1',
				roundNumber: 1,
			},
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			name: 'Round 1',
			roundNumber: 1,
			phaseId,
			eventId,
			externalId: null,
			externalSource: 'manual',
			lastSyncedAt: null,
		});
		expect(res._data.id).toBeTypeOf('number');
		expect(res._data).toHaveProperty('createdAt');
		expect(res._data).toHaveProperty('updatedAt');

		roundId = res._data.id;
	});

	it('rejects forged Round provenance and server-managed fields', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/rounds`, {
			method: 'POST',
			body: {
				phaseId,
				name: 'Forged Round',
				roundNumber: 2,
				externalId: 'forged-round',
				externalSource: 'melee',
				lastSyncedAt: '2026-01-01T00:00:00.000Z',
			},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	it('lists rounds including the created one', async () => {
		const data = await $fetch(`/api/events/${eventId}/rounds`);

		expect(data.rounds).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		const found = data.rounds.find((r: { id: number }) => r.id === roundId);
		expect(found).toBeDefined();
		expect(found!.name).toBe('Round 1');
	});

	it('updates a round name', async () => {
		const updated = await $fetch(`/api/events/${eventId}/rounds/${roundId}`, {
			method: 'PATCH',
			body: { name: 'Round 1 (Updated)' },
		});

		expect(updated.id).toBe(roundId);
		expect(updated.name).toBe('Round 1 (Updated)');
	});

	it('deletes a round', async () => {
		const round = await $fetch(`/api/events/${eventId}/rounds`, {
			method: 'POST',
			body: { phaseId, name: 'Integration Delete Me', roundNumber: 99 },
		});

		const result = await $fetch(`/api/events/${eventId}/rounds/${round.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		const res = await $fetchRaw(`/api/events/${eventId}/rounds/${round.id}`);
		expect(res.status).toBe(404);
	});

	it('returns 4xx when creating with empty body', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/rounds`, {
			method: 'POST',
			body: {},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	it('enables manual override for a round', async () => {
		const round = await $fetch(`/api/events/${eventId}/rounds`, {
			method: 'POST',
			body: {
				phaseId,
				name: 'Manual Override Round',
				roundNumber: 50,
			},
		});

		const overrideRes = await $fetchRaw(`/api/events/${eventId}/rounds/${round.id}/state/manual-override`, {
			method: 'POST',
		});

		expect(overrideRes.status).toBe(200);
		expect(overrideRes._data.controlMode).toBe('manual_override');
	});
});
