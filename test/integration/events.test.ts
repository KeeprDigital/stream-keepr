import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetchRaw } from './helpers';

describe('events API', () => {
	let eventId: number;

	beforeAll(async () => {
		// Seed: create an event used by read/update/delete tests
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Seed Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		// Cleanup: best-effort delete — may fail if context is already torn down
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates an event and returns 201', async () => {
		const res = await $fetchRaw('/api/events', {
			method: 'POST',
			body: { name: 'Integration Create Test', game: 'op', featureMatchOrientation: 'horizontal' },
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			name: 'Integration Create Test',
			game: 'op',
			featureMatchDefaultBestOf: 1,
			featureMatchDefaultStartingLife: 0,
			featureMatchDefaultClockDuration: 30,
			featureMatchDefaultCountUpAfterCountdown: false,
			featureMatchDefaultExtraTurnsEnabled: false,
			featureMatchDefaultExtraTurns: 0,
		});
		expect(res._data.id).toBeTypeOf('number');

		// Cleanup
		await $fetch(`/api/events/${res._data.id}`, { method: 'DELETE' });
	});

	it('lists events including the seeded one', async () => {
		const data = await $fetch('/api/events');

		expect(data.events).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		const found = data.events.find((e: { id: number }) => e.id === eventId);
		expect(found).toBeDefined();
		expect(found!.name).toBe('Integration Seed Event');
	});

	it('gets a single event by ID', async () => {
		const event = await $fetch(`/api/events/${eventId}`);

		expect(event.id).toBe(eventId);
		expect(event.name).toBe('Integration Seed Event');
		expect(event.game).toBe('mtg');
		expect(event).toHaveProperty('meleeConfigured');
		expect(event).toHaveProperty('talents');
		expect(event).not.toHaveProperty('meleeSyncLeaseToken');
		expect(event).not.toHaveProperty('meleeSyncLeaseCommand');
		expect(event).not.toHaveProperty('meleeSyncLeaseExpiresAt');
	});

	it('updates an event name', async () => {
		const updated = await $fetch(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { name: 'Integration Updated Event' },
		});

		expect(updated.id).toBe(eventId);
		expect(updated.name).toBe('Integration Updated Event');
		expect(updated.game).toBe('mtg');
	});

	it('rejects immutable and unknown Event update fields', async () => {
		const immutableResponse = await $fetchRaw(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { game: 'op' },
			ignoreResponseError: true,
		});
		const unknownResponse = await $fetchRaw(`/api/events/${eventId}`, {
			method: 'PATCH',
			body: { unexpected: true },
			ignoreResponseError: true,
		});

		expect(immutableResponse.status).toBe(400);
		expect(unknownResponse.status).toBe(400);
		const unchanged = await $fetch(`/api/events/${eventId}`);
		expect(unchanged.game).toBe('mtg');
	});

	it('deletes an event', async () => {
		// Create a throwaway event for deletion
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Delete Me', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});

		const result = await $fetch(`/api/events/${event.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		// Verify it's gone
		const res = await $fetchRaw(`/api/events/${event.id}`);
		expect(res.status).toBe(404);
	});
});
