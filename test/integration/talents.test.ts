import { $fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetchRaw } from './helpers';

describe('talents API', () => {
	let eventId: number;
	let talentId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Talents Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates a talent and returns 201', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'John Caster' },
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			name: 'John Caster',
			eventId,
		});
		expect(res._data.id).toBeTypeOf('number');
		talentId = res._data.id;
	});

	it('lists talents for the event', async () => {
		const data = await $fetch(`/api/events/${eventId}/talents`);

		expect(data.talents).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		const found = data.talents.find((t: { id: number }) => t.id === talentId);
		expect(found).toBeDefined();
		expect(found!.name).toBe('John Caster');
	});

	it('updates a talent name', async () => {
		const updated = await $fetch(`/api/events/${eventId}/talents/${talentId}`, {
			method: 'PATCH',
			body: { name: 'Jane Commentator' },
		});

		expect(updated.id).toBe(talentId);
		expect(updated.name).toBe('Jane Commentator');
	});

	it('deletes a talent', async () => {
		// Create a throwaway talent
		const talent = await $fetch(`/api/events/${eventId}/talents`, {
			method: 'POST',
			body: { name: 'Delete Me Talent' },
		});

		const result = await $fetch(`/api/events/${eventId}/talents/${talent.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		// Verify it's gone — list should not include it
		const data = await $fetch(`/api/events/${eventId}/talents`);
		const found = data.talents.find((t: { id: number }) => t.id === talent.id);
		expect(found).toBeUndefined();
	});
});
