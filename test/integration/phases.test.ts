import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { $fetch } from './client';
import { $fetchRaw } from './helpers';

describe('phases API', () => {
	let eventId: number;
	let phaseId: number;

	beforeAll(async () => {
		const event = await $fetch('/api/events', {
			method: 'POST',
			body: { name: 'Integration Phases Event', game: 'mtg', featureMatchOrientation: 'horizontal' },
		});
		eventId = event.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('creates a phase and returns 201', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/phases`, {
			method: 'POST',
			body: {
				name: 'Swiss',
				sortOrder: 0,
			},
		});

		expect(res.status).toBe(201);
		expect(res._data).toMatchObject({
			name: 'Swiss',
			sortOrder: 0,
			eventId,
			externalId: null,
			externalSource: 'manual',
			formatExternalId: null,
		});
		expect(res._data.id).toBeTypeOf('number');
		expect(res._data).toHaveProperty('createdAt');
		expect(res._data).toHaveProperty('updatedAt');

		phaseId = res._data.id;
	});

	it('rejects forged Phase provenance on create', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/phases`, {
			method: 'POST',
			body: {
				name: 'Forged Phase',
				sortOrder: 1,
				externalId: 'forged-phase',
				externalSource: 'melee',
				formatExternalId: 'forged-format',
			},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	it('lists phases including the created one', async () => {
		const data = await $fetch(`/api/events/${eventId}/phases`);

		expect(data.phases).toBeInstanceOf(Array);
		expect(data.total).toBeGreaterThanOrEqual(1);

		const found = data.phases.find((p: { id: number }) => p.id === phaseId);
		expect(found).toBeDefined();
		expect(found!.name).toBe('Swiss');
	});

	it('gets a single phase by ID', async () => {
		const phase = await $fetch(`/api/events/${eventId}/phases/${phaseId}`);

		expect(phase.id).toBe(phaseId);
		expect(phase.eventId).toBe(eventId);
		expect(phase.name).toBe('Swiss');
		expect(phase).toHaveProperty('sortOrder');
		expect(phase).toHaveProperty('externalId');
		expect(phase).toHaveProperty('externalSource');
		expect(phase).toHaveProperty('createdAt');
		expect(phase).toHaveProperty('updatedAt');
	});

	it('updates a phase name', async () => {
		const updated = await $fetch(`/api/events/${eventId}/phases/${phaseId}`, {
			method: 'PATCH',
			body: { name: 'Top 8 Draft' },
		});

		expect(updated.id).toBe(phaseId);
		expect(updated.name).toBe('Top 8 Draft');
		expect(updated.externalId).toBeNull();
		expect(updated.externalSource).toBe('manual');
	});

	it('rejects forged Phase provenance on update', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/phases/${phaseId}`, {
			method: 'PATCH',
			body: {
				name: 'Forged Update',
				externalId: 'forged-update',
				externalSource: 'melee',
			},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});

	it('deletes a phase', async () => {
		// Create a throwaway phase for deletion
		const phase = await $fetch(`/api/events/${eventId}/phases`, {
			method: 'POST',
			body: { name: 'Integration Delete Me' },
		});

		const result = await $fetch(`/api/events/${eventId}/phases/${phase.id}`, {
			method: 'DELETE',
		});

		expect(result).toEqual({ success: true });

		// Verify it's gone
		const res = await $fetchRaw(`/api/events/${eventId}/phases/${phase.id}`);
		expect(res.status).toBe(404);
	});

	it('returns 4xx when creating with empty body', async () => {
		const res = await $fetchRaw(`/api/events/${eventId}/phases`, {
			method: 'POST',
			body: {},
		});

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(res.status).toBeLessThan(500);
	});
});
