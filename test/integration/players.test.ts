import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetchRaw } from './helpers';

describe('players API', () => {
	let eventId: number;
	let playerId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Players Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates a player and returns 201', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name: 'Test Player One' },
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			name: 'Test Player One',
			eventId,
		});
		expect(res._data.id).toBeTypeOf('number');
		playerId = res._data.id;
	});

	it('rejects forged Melee Player provenance on create', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: {
				name: 'Forged Melee Player',
				externalId: 'forged-external-id',
				externalSource: 'melee',
			},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);

		// Confirm no player was created under Melee's identity namespace.
		const data = await $fetch(`/api/events/${eventId}/players`);
		const forged = data.players.find((p: { name: string }) => p.name === 'Forged Melee Player');
		expect(forged).toBeUndefined();
	});

	it('lists players for the event', async () => {
		const data = await $fetch(`/api/events/${eventId}/players`);

		expect(data.players).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		const found = data.players.find((p: { id: number }) => p.id === playerId);
		expect(found).toBeDefined();
		expect(found.name).toBe('Test Player One');
	});

	it('gets a single player by ID', async () => {
		const player = await $fetch(`/api/events/${eventId}/players/${playerId}`);

		expect(player.id).toBe(playerId);
		expect(player.name).toBe('Test Player One');
		expect(player.eventId).toBe(eventId);
	});

	it('updates a player name and pronouns', async () => {
		const updated = await $fetch(`/api/events/${eventId}/players/${playerId}`, {
			method: 'PATCH',
			body: { name: 'Updated Player', pronouns: 'they/them' },
		});

		expect(updated.id).toBe(playerId);
		expect(updated.name).toBe('Updated Player');
		expect(updated.pronouns).toBe('they/them');
	});

	it('rejects forged Melee Player provenance on update', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/players/${playerId}`, {
			method: 'PATCH',
			body: {
				name: 'Forged Update',
				externalId: 'forged-external-id',
				externalSource: 'melee',
			},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);

		// Confirm the row is unchanged — no name update and no external identity applied.
		const player = await $fetch(`/api/events/${eventId}/players/${playerId}`);
		expect(player.name).toBe('Updated Player');
		expect(player.externalId).toBeNull();
		expect(player.externalSource).toBeNull();
	});

	it('deletes a player', async () => {
		// Create a throwaway player
		const player = await $fetch(`/api/events/${eventId}/players`, {
			method: 'POST',
			body: { name: 'Delete Me' },
		});

		const result = await $fetch(`/api/events/${eventId}/players/${player.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		// Verify it's gone
		const res = await $fetchRaw(`/api/events/${eventId}/players/${player.id}`);
		expect(res.status).toBe(404);
	});
});
